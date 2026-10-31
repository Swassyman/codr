import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { createServices } from '../../src/server/bootstrap';
import { buildApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { questions } from '../../src/server/db/schema';
import { saveImported } from '../../src/server/importers/registry';
import { normalizeRow, type LeetCodeRow } from '../../src/server/importers/leetcode-dataset';
import { PistonRunner } from '../../src/server/runner/piston';

// A function-style (LeetCode) question from import to verdict, on the real
// runner: the imported question, its generated starter code, submissions in
// several languages, and validation of the imported reference solution.
const RUNNER_URL = process.env.RUNNER_URL ?? 'http://localhost:2000';
const live = await fetch(`${RUNNER_URL}/api/v2/runtimes`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);

const row: LeetCodeRow = {
  task_id: 'two-sum',
  question_id: 1,
  difficulty: 'Easy',
  tags: ['Array', 'Hash Table'],
  problem_description: [
    'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
    '',
    'Example 1:',
    '',
    'Input: nums = [2,7,11,15], target = 9',
    'Output: [0,1]',
    '',
    'Constraints:',
    '',
    '2 <= nums.length <= 104',
  ].join('\n'),
  starter_code: 'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        ',
  completion: 'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n',
  input_output: [
    { input: 'nums = [3,3], target = 6', output: '[0, 1]' },
    { input: 'nums = [1,5,9,14], target = 23', output: '[2, 3]' },
    { input: 'nums = [1,2], target = 99', output: 'None' },
  ],
};

const SOLUTIONS = {
  python: '        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n        return None',
  cpp: '        unordered_map<int,int> m; for (int i = 0; i < (int)nums.size(); i++) { auto it = m.find(target - nums[i]); if (it != m.end()) return {it->second, i}; m[nums[i]] = i; } return {};',
  java: '        Map<Integer,Integer> m = new HashMap<>(); for (int i = 0; i < nums.length; i++) { Integer j = m.get(target - nums[i]); if (j != null) return new int[]{j, i}; m.put(nums[i], i); } return null;',
};

const fill = (starter: string, body: string) => starter.replace(/^[ ]+\n/m, `${body}\n`);

describe.runIf(live)('function-style questions on the real runner', () => {
  let ctx: TestContext;
  let services: ReturnType<typeof createServices>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let creator: TestClient;
  let student: TestClient;
  let questionId: number;
  let slug: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    const config = loadConfig({ NODE_ENV: 'test', RUNNER_CONCURRENCY: '4', SUBMIT_RATE_PER_MINUTE: '1000', RUN_RATE_PER_MINUTE: '1000' });
    services = createServices({ config, db: ctx.db, runner: new PistonRunner(RUNNER_URL), clock: ctx.clock, log: pino({ level: 'silent' }) });
    app = await buildApp(services);
    const author = await createUser(ctx.db, 'fncreator', 'creator');
    await createUser(ctx.db, 'fnstudent');
    creator = new TestClient(app);
    await creator.login('fncreator');
    student = new TestClient(app);
    await student.login('fnstudent');

    const saved = await saveImported(ctx.db, 'leetcode-dataset', normalizeRow(row), author.id, ctx.clock.now());
    questionId = saved.id;
    const [q] = await ctx.db.update(questions).set({ status: 'published', practice: true }).where(eq(questions.id, questionId)).returning();
    slug = q!.slug;
  });

  afterAll(async () => {
    await app?.close();
    await services?.worker.stop();
    await ctx?.close();
  });

  const send = async (language: string, code: string) => {
    const res = await student.post(`/api/practice/questions/${slug}/submit`, { language, code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await services.worker.drain(240_000);
    return (await student.get(`/api/submissions/${res.body.id}`)).body;
  };

  it('offers generated method stubs in the languages the wrappers drive, and nothing else', async () => {
    const res = await student.get(`/api/practice/questions/${slug}`);
    expect(res.status).toBe(200);
    expect([...res.body.languages].sort()).toEqual(['cpp', 'java', 'javascript', 'python', 'typescript']);
    expect(Object.keys(res.body.starterCode).sort()).toEqual(['cpp', 'java', 'javascript', 'python', 'typescript']);
    expect(res.body.starterCode.python).toContain('def twoSum(self, nums: List[int], target: int) -> List[int]:');
    expect(res.body.starterCode.cpp).toContain('vector<int> twoSum(vector<int>& nums, int target)');
    expect(res.body.starterCode.java).toContain('public int[] twoSum(int[] nums, int target)');
    expect(res.body.samples[0]).toMatchObject({ input: '[2,7,11,15]\n9\n', output: '[0,1]\n' });
  });

  it('judges submissions in several languages, and rejects languages without wrappers', async () => {
    const starters = (await student.get(`/api/practice/questions/${slug}`)).body.starterCode;
    for (const language of ['python', 'cpp', 'java'] as const) {
      const sub = await send(language, fill(starters[language], SOLUTIONS[language]));
      expect({ language, verdict: sub.verdict, compile: sub.compileOutput }, language).toMatchObject({ language, verdict: 'AC', compile: null });
    }
    const wrong = await send('python', fill(starters.python, '        return [0, 0]'));
    expect(wrong.verdict).toBe('WA');
    expect(wrong.results.find((r: { verdict: string }) => r.verdict === 'WA').message).toMatch(/returned value differs/);

    const res = await student.post(`/api/practice/questions/${slug}/submit`, { language: 'c', code: 'int main(){}' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('language_not_allowed');
  });

  it('runs the examples through the wrapper', async () => {
    const starters = (await student.get(`/api/practice/questions/${slug}`)).body.starterCode;
    const res = await student.post(`/api/practice/questions/${slug}/run`, { mode: 'samples', language: 'java', code: fill(starters.java, SOLUTIONS.java) });
    expect(res.status).toBe(200);
    await services.worker.drain(240_000);
    const run = (await student.get(`/api/runs/${res.body.id}`)).body;
    expect(run.status).toBe('done');
    expect(run.results.map((r: { verdict: string }) => r.verdict)).toEqual(['AC']);
  });

  it('validates the imported reference solution', async () => {
    const res = await creator.post(`/api/manage/questions/${questionId}/validate`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await services.worker.drain(240_000);
    const [q] = await ctx.db.select().from(questions).where(eq(questions.id, questionId));
    expect(q!.validation).toMatchObject({ ok: true, language: 'python' });
    expect(q!.validation!.cases.every((c) => c.verdict === 'AC')).toBe(true);
    expect(q!.validation!.cases.length).toBe(3); // 1 example + 2 tests (the no-answer test is dropped on import)
  });
});
