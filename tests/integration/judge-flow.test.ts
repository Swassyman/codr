import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { createQuestion } from '../helpers/fixtures';
import { createServices } from '../../src/server/bootstrap';
import { buildApp } from '../../src/server/app';
import { PistonRunner } from '../../src/server/runner/piston';
import { loadConfig } from '../../src/server/config';
import { contestQuestions, contests } from '../../src/server/db/schema';
import pino from 'pino';

let ctx: TestContext;
let alice: TestClient;

beforeAll(async () => {
  ctx = await createTestContext();
  await createUser(ctx.db, 'alice');
  alice = new TestClient(ctx.app);
  await alice.login('alice');
});

afterAll(async () => {
  await ctx.close();
});

async function submit(client: TestClient, slug: string, code: string, key?: string) {
  const res = await client.post(`/api/practice/questions/${slug}/submit`, { language: 'cpp', code }, key ? { 'idempotency-key': key } : {});
  expect(res.status).toBe(200);
  return res.body.id as number;
}

async function judged(client: TestClient, id: number) {
  await ctx.services.worker.drain();
  const res = await client.get(`/api/submissions/${id}`);
  expect(res.status).toBe(200);
  return res.body;
}

describe('submit → judge → verdict', () => {
  it('accepts a correct program: examples first, then every test', async () => {
    const q = await createQuestion(ctx.db);
    const s = await judged(alice, await submit(alice, q.slug, '// fake:sum'));
    expect(s).toMatchObject({ status: 'done', verdict: 'AC', score: 100, maxScore: 100, passed: 3, total: 3, withheld: false });
    expect(s.results.map((r: { label: string; verdict: string }) => [r.label, r.verdict])).toEqual([
      ['Example 1', 'AC'],
      ['Test 1', 'AC'],
      ['Test 2', 'AC'],
    ]);
    expect(s.results[0].points).toBe(0);
  });

  it('reports the first failing case for a wrong answer', async () => {
    const q = await createQuestion(ctx.db);
    const s = await judged(alice, await submit(alice, q.slug, '// fake:wa'));
    expect(s.verdict).toBe('WA');
    expect(s.score).toBe(0);
    expect(s.results[1].message).toBeUndefined(); // hidden test: no checker message
  });

  it('gives weighted partial credit', async () => {
    const q = await createQuestion(ctx.db, {
      tests: [
        { input: '1 2\n', output: '3\n', points: 1 },
        { input: '2 2\n', output: '5\n', points: 3 }, // the sum program prints 4 here
      ],
    });
    const s = await judged(alice, await submit(alice, q.slug, '// fake:sum'));
    expect(s.verdict).toBe('WA');
    expect(s.score).toBe(25);
    expect(s.results.slice(1).map((r: { points: number; maxPoints: number }) => [r.points, r.maxPoints])).toEqual([
      [25, 25],
      [0, 75],
    ]);
  });

  it('scores groups only when every test in the group passes', async () => {
    const q = await createQuestion(ctx.db, {
      scoringMode: 'groups',
      tests: [
        { input: '1 1\n', output: '2\n', group: 'small' },
        { input: '1 2\n', output: '0\n', group: 'small' },
        { input: '3 4\n', output: '7\n', group: 'large', points: 2 },
      ],
    });
    const s = await judged(alice, await submit(alice, q.slug, '// fake:sum'));
    expect(s.score).toBe(50);
  });

  it('marks every case skipped on a compilation error', async () => {
    const q = await createQuestion(ctx.db);
    const s = await judged(alice, await submit(alice, q.slug, '// fake:ce'));
    expect(s.verdict).toBe('CE');
    expect(s.compileOutput).toContain('error');
    expect(s.results.every((r: { verdict: string }) => r.verdict === 'SK')).toBe(true);
  });

  it('reports time limits', async () => {
    const q = await createQuestion(ctx.db);
    const s = await judged(alice, await submit(alice, q.slug, '// fake:tle'));
    expect(s.verdict).toBe('TLE');
  });

  it('never returns hidden test data', async () => {
    const q = await createQuestion(ctx.db, { tests: [{ input: 'SECRET-INPUT-7781\n', output: 'SECRET-OUTPUT-7781\n' }] });
    const id = await submit(alice, q.slug, '// fake:echo');
    const s = await judged(alice, id);
    const list = await alice.get(`/api/practice/questions/${q.slug}/submissions`);
    const page = await alice.get(`/api/practice/questions/${q.slug}`);
    for (const body of [s, list.body, page.body]) {
      expect(JSON.stringify(body)).not.toContain('SECRET-');
    }
  });

  it('turns a double-click into a single submission', async () => {
    const q = await createQuestion(ctx.db);
    const key = 'click-0001-abcdef';
    const [a, b] = await Promise.all([submit(alice, q.slug, '// fake:sum', key), submit(alice, q.slug, '// fake:sum', key)]);
    expect(a).toBe(b);
    await ctx.services.worker.drain();
    const list = await alice.get(`/api/practice/questions/${q.slug}/submissions`);
    expect(list.body.submissions).toHaveLength(1);
  });

  it('shows queued submissions with their position while the runner is busy', async () => {
    const q = await createQuestion(ctx.db);
    ctx.services.worker.pause();
    try {
      const first = await submit(alice, q.slug, '// fake:sum');
      const second = await submit(alice, q.slug, '// fake:sum');
      expect((await alice.get(`/api/submissions/${first}`)).body).toMatchObject({ status: 'queued', queuePosition: 1 });
      expect((await alice.get(`/api/submissions/${second}`)).body).toMatchObject({ status: 'queued', queuePosition: 2 });
      ctx.services.worker.resume();
      expect((await judged(alice, second)).verdict).toBe('AC');
    } finally {
      ctx.services.worker.resume();
    }
  });

  it("does not show other people's submissions", async () => {
    const q = await createQuestion(ctx.db);
    const id = await submit(alice, q.slug, '// fake:sum');
    await createUser(ctx.db, 'mallory');
    const mallory = new TestClient(ctx.app);
    await mallory.login('mallory');
    expect((await mallory.get(`/api/submissions/${id}`)).status).toBe(404);
  });
});

describe('practice workspace', () => {
  it('saves drafts per language and returns them with the question', async () => {
    const q = await createQuestion(ctx.db);
    await alice.put(`/api/practice/questions/${q.slug}/draft`, { language: 'python', code: 'print(1)' });
    await alice.put(`/api/practice/questions/${q.slug}/draft`, { language: 'python', code: 'print(2)' });
    await alice.put(`/api/practice/questions/${q.slug}/draft`, { language: 'cpp', code: 'int main(){}' });
    const page = await alice.get(`/api/practice/questions/${q.slug}`);
    const drafts = Object.fromEntries(page.body.drafts.map((d: { language: string; code: string }) => [d.language, d.code]));
    expect(drafts).toEqual({ python: 'print(2)', cpp: 'int main(){}' });
  });

  it('runs the examples and custom input', async () => {
    const q = await createQuestion(ctx.db, { samples: [{ input: '1 2\n', output: '3\n' }, { input: '5 5\n', output: '11\n' }] });
    const samples = await alice.post(`/api/practice/questions/${q.slug}/run`, { mode: 'samples', language: 'python', code: '# fake:sum' });
    const custom = await alice.post(`/api/practice/questions/${q.slug}/run`, { mode: 'custom', language: 'python', code: '# fake:sum', input: '7 8' });
    await ctx.services.worker.drain();
    const s = (await alice.get(`/api/runs/${samples.body.id}`)).body;
    expect(s.results.map((r: { verdict: string }) => r.verdict)).toEqual(['AC', 'WA']);
    const c = (await alice.get(`/api/runs/${custom.body.id}`)).body;
    expect(c.results[0].execution.stdout).toBe('15\n');
    expect(c.results[0].expected).toBeNull();
  });

  it('rejects languages the question does not allow', async () => {
    const q = await createQuestion(ctx.db);
    const res = await alice.post(`/api/practice/questions/${q.slug}/submit`, { language: 'rust', code: 'fn main(){}' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('language_not_allowed');
  });

  it('hides questions that are drafts, not for practice, or in an unfinished contest', async () => {
    const draft = await createQuestion(ctx.db, { status: 'draft' });
    const notPractice = await createQuestion(ctx.db, { practice: false });
    const inContest = await createQuestion(ctx.db);
    const [c] = await ctx.db
      .insert(contests)
      .values({ name: 'Live', startsAt: new Date('2030-01-15T09:00:00Z'), endsAt: new Date('2030-01-15T12:00:00Z'), joinCode: 'LIVE-0001', status: 'published' })
      .returning();
    await ctx.db.insert(contestQuestions).values({ contestId: c!.id, questionId: inContest.id, position: 0 });

    const list = (await alice.get('/api/practice/questions')).body.questions.map((q: { id: number }) => q.id);
    for (const q of [draft, notPractice, inContest]) {
      expect(list).not.toContain(q.id);
      expect((await alice.get(`/api/practice/questions/${q.slug}`)).status).toBe(404);
    }
    // Once the contest is over the question becomes practice material.
    ctx.clock.set('2030-01-15T12:00:01Z');
    expect((await alice.get(`/api/practice/questions/${inContest.slug}`)).status).toBe(200);
    ctx.clock.set('2030-01-15T10:00:00Z');
  });
});

// The same flow against the real sandbox, when Piston is reachable.
const RUNNER_URL = process.env.RUNNER_URL ?? 'http://localhost:2000';
const live = await fetch(`${RUNNER_URL}/api/v2/runtimes`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);

describe.runIf(live)('submit → judge → verdict on the real runner', () => {
  it('judges C++ and Python submissions end to end', async () => {
    const config = loadConfig({ NODE_ENV: 'test', RUNNER_CONCURRENCY: '4', SUBMIT_RATE_PER_MINUTE: '1000' });
    const services = createServices({ config, db: ctx.db, runner: new PistonRunner(RUNNER_URL), clock: ctx.clock, log: pino({ level: 'silent' }) });
    const app = await buildApp(services);
    const client = new TestClient(app);
    await client.login('alice');
    const q = await createQuestion(ctx.db, { tests: [{ input: '2000000000 2000000000\n', output: '4000000000\n' }, { input: '-7 3\n', output: '-4\n' }] });

    const send = async (language: string, code: string) => {
      const res = await client.post(`/api/practice/questions/${q.slug}/submit`, { language, code });
      expect(res.status).toBe(200);
      await services.worker.drain();
      return (await client.get(`/api/submissions/${res.body.id}`)).body;
    };

    const ac = await send('cpp', '#include <cstdio>\nint main(){ long long a,b; scanf("%lld %lld",&a,&b); printf("%lld\\n",a+b); }');
    expect(ac.verdict).toBe('AC');
    expect(ac.timeMs).toBeGreaterThanOrEqual(0);

    const overflow = await send('cpp', '#include <cstdio>\nint main(){ int a,b; scanf("%d %d",&a,&b); printf("%d\\n",a+b); }');
    expect(overflow.verdict).toBe('WA');

    const py = await send('python', 'a, b = map(int, input().split())\nprint(a + b)');
    expect(py.verdict).toBe('AC');

    const ce = await send('cpp', 'int main( { }');
    expect(ce.verdict).toBe('CE');
    expect(ce.compileOutput).toMatch(/main\.cpp/);

    await app.close();
    await services.worker.stop();
  });
});
