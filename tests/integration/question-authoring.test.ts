import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';

let ctx: TestContext;
let author: TestClient;
let otherCreator: TestClient;
let participant: TestClient;

beforeAll(async () => {
  ctx = await createTestContext();
  await createUser(ctx.db, 'author', 'creator');
  await createUser(ctx.db, 'other', 'creator');
  await createUser(ctx.db, 'player');
  author = new TestClient(ctx.app);
  otherCreator = new TestClient(ctx.app);
  participant = new TestClient(ctx.app);
  await author.login('author');
  await otherCreator.login('other');
  await participant.login('player');
});

afterAll(async () => {
  await ctx.close();
});

async function newQuestion(title = 'Sum of two numbers') {
  const res = await author.post('/api/manage/questions', { title });
  expect(res.status).toBe(200);
  return res.body.id as number;
}

describe('question form', () => {
  it('creates a draft with a slug and default languages', async () => {
    const id = await newQuestion('Sum of Two Numbers!');
    const q = (await author.get(`/api/manage/questions/${id}`)).body;
    expect(q).toMatchObject({ slug: 'sum-of-two-numbers', status: 'draft', checker: { type: 'trim' }, validationState: 'missing' });
    expect(q.allowedLanguages).toEqual(expect.arrayContaining(['cpp', 'python']));
  });

  it('autosaves partial updates and validates each field', async () => {
    const id = await newQuestion('Patch me');
    const ok = await author.patch(`/api/manage/questions/${id}`, {
      statement: 'Add $a$ and $b$.',
      constraints: ['1 \\le a, b \\le 10^9'],
      samples: [{ input: '1 2\n', output: '3\n', explanation: '1 + 2 = 3' }],
      timeLimitMs: 1000,
      languageLimits: { python: { time: 3 } },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ statement: 'Add $a$ and $b$.', timeLimitMs: 1000, languageLimits: { python: { time: 3 } } });

    const bad = await author.patch(`/api/manage/questions/${id}`, { timeLimitMs: 5, allowedLanguages: [] });
    expect(bad.status).toBe(400);
    const paths = bad.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['timeLimitMs', 'allowedLanguages']));
  });

  it('rejects a slug that another question uses', async () => {
    await newQuestion('Taken slug');
    const id = await newQuestion('Second');
    const res = await author.patch(`/api/manage/questions/${id}`, { slug: 'taken-slug' });
    expect(res.status).toBe(409);
    expect(res.body.error.details[0]).toMatchObject({ path: 'slug' });
  });

  it('only lets the author (or an admin) edit', async () => {
    const id = await newQuestion('Private draft');
    expect((await otherCreator.get(`/api/manage/questions/${id}`)).status).toBe(403);
    expect((await otherCreator.patch(`/api/manage/questions/${id}`, { title: 'hijack' })).status).toBe(403);
    expect((await participant.get('/api/manage/questions')).status).toBe(403);
    const list = (await otherCreator.get('/api/manage/questions')).body.questions;
    expect(list.find((q: { id: number }) => q.id === id)).toBeUndefined();
  });
});

describe('test case table', () => {
  it('adds, edits, duplicates, reorders and deletes tests', async () => {
    const id = await newQuestion('Table');
    const base = `/api/manage/questions/${id}/tests`;
    const added = await author.post(base, { tests: [{ input: '1 1\n', expectedOutput: '2\n' }, { input: '2 2\n', expectedOutput: '4\n', hidden: false }, {}] });
    expect(added.status).toBe(200);
    const [a, b, c] = added.body.tests;
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
    expect(a.hidden).toBe(true);
    expect(c).toMatchObject({ input: '', expectedOutput: '' });

    const patched = await author.patch(`${base}/${c.id}`, { input: '5 5\n', label: 'edge', points: 2 });
    expect(patched.body).toMatchObject({ input: '5 5\n', label: 'edge', points: 2 });

    const dup = await author.post(`${base}/${a.id}/duplicate`);
    expect(dup.body).toMatchObject({ input: '1 1\n', position: 1 });

    let list = (await author.get(base)).body.tests;
    expect(list.map((t: { id: number }) => t.id)).toEqual([a.id, dup.body.id, b.id, c.id]);

    await author.put(`${base}/order`, { ids: [c.id, b.id, a.id, dup.body.id] });
    list = (await author.get(base)).body.tests;
    expect(list.map((t: { id: number }) => t.id)).toEqual([c.id, b.id, a.id, dup.body.id]);

    expect((await author.put(`${base}/order`, { ids: [c.id, b.id] })).status).toBe(400);

    await author.del(`${base}/${dup.body.id}`);
    expect((await author.get(base)).body.tests).toHaveLength(3);
    expect((await otherCreator.get(base)).status).toBe(403);
  });

  it('sends large tests as previews with a raw download', async () => {
    const id = await newQuestion('Big data');
    const big = 'x'.repeat(300_000);
    const res = await author.post(`/api/manage/questions/${id}/tests`, { tests: [{ input: big, expectedOutput: '1\n' }] });
    const t = res.body.tests[0];
    expect(t.truncated).toBe(true);
    expect(t.inputSize).toBe(300_000);
    expect(t.input.length).toBeLessThan(10_000);
    const raw = await author.get(`/api/manage/questions/${id}/tests/${t.id}/raw?part=input`);
    expect(raw.body).toHaveLength(300_000);
  });
});

describe('reference solution tools', () => {
  it('generates expected outputs for review, then applies the chosen ones', async () => {
    const id = await newQuestion('Generated');
    const added = await author.post(`/api/manage/questions/${id}/tests`, { tests: [{ input: '1 2\n' }, { input: '40 2\n' }, { input: '-5 5\n', expectedOutput: '0\n' }] });
    const ids = added.body.tests.map((t: { id: number }) => t.id);

    const gen = await author.post(`/api/manage/questions/${id}/generate`, { language: 'cpp', code: '// fake:sum' });
    expect(gen.status).toBe(200);
    await ctx.services.worker.drain();
    const run = (await author.get(`/api/runs/${gen.body.runId}`)).body;
    expect(run.kind).toBe('generate');
    expect(run.results.map((r: { execution: { stdout: string } }) => r.execution.stdout)).toEqual(['3\n', '42\n', '0\n']);

    // Nothing is saved until the author applies outputs.
    expect((await author.get(`/api/manage/questions/${id}/tests`)).body.tests[0].expectedOutput).toBe('');
    await author.post(`/api/manage/questions/${id}/tests/outputs`, {
      outputs: run.results.slice(0, 2).map((r: { testId: number; execution: { stdout: string } }) => ({ testId: r.testId, expectedOutput: r.execution.stdout })),
    });
    const tests = (await author.get(`/api/manage/questions/${id}/tests`)).body.tests;
    expect(tests.map((t: { expectedOutput: string }) => t.expectedOutput)).toEqual(['3\n', '42\n', '0\n']);
    expect(tests.map((t: { id: number }) => t.id)).toEqual(ids);

    // The generator remembered the reference solution.
    const q = (await author.get(`/api/manage/questions/${id}`)).body;
    expect(q.referenceSolution).toEqual({ language: 'cpp', code: '// fake:sum' });
  });

  it('validates against samples and tests, and goes stale when tests change', async () => {
    const id = await newQuestion('Validated');
    await author.patch(`/api/manage/questions/${id}`, { samples: [{ input: '1 2\n', output: '3\n' }] });
    await author.post(`/api/manage/questions/${id}/tests`, { tests: [{ input: '2 2\n', expectedOutput: '4\n' }] });

    const v = await author.post(`/api/manage/questions/${id}/validate`, { language: 'python', code: '# fake:sum' });
    expect(v.status).toBe(200);
    await ctx.services.worker.drain();
    let q = (await author.get(`/api/manage/questions/${id}`)).body;
    expect(q.validationState).toBe('passed');
    expect(q.validation.cases.map((c: { sample: boolean; verdict: string }) => [c.sample, c.verdict])).toEqual([
      [true, 'AC'],
      [false, 'AC'],
    ]);

    ctx.clock.advance(1000);
    await author.post(`/api/manage/questions/${id}/tests`, { tests: [{ input: '1 1\n', expectedOutput: '3\n' }] });
    q = (await author.get(`/api/manage/questions/${id}`)).body;
    expect(q.validationState).toBe('stale');

    await author.post(`/api/manage/questions/${id}/validate`);
    await ctx.services.worker.drain();
    q = (await author.get(`/api/manage/questions/${id}`)).body;
    expect(q.validationState).toBe('failed');
    expect(q.validation.cases.at(-1).verdict).toBe('WA');
  });
});

describe('publishing', () => {
  it('requires the essentials, then asks to acknowledge missing validation', async () => {
    const id = await newQuestion('Publish me');
    const notReady = await author.post(`/api/manage/questions/${id}/publish`);
    expect(notReady.status).toBe(400);
    expect(notReady.body.error.code).toBe('not_ready');
    expect(notReady.body.error.details.map((d: { path: string }) => d.path)).toEqual(['statement', 'tests']);

    await author.patch(`/api/manage/questions/${id}`, { statement: 'Print the sum.' });
    await author.post(`/api/manage/questions/${id}/tests`, { tests: [{ input: '1 1\n', expectedOutput: '2\n' }] });
    const needsValidation = await author.post(`/api/manage/questions/${id}/publish`);
    expect(needsValidation.status).toBe(409);
    expect(needsValidation.body.error.code).toBe('validation_needed');

    const forced = await author.post(`/api/manage/questions/${id}/publish`, { acknowledgeValidation: true });
    expect(forced.status).toBe(200);
    expect((await author.get(`/api/manage/questions/${id}`)).body.status).toBe('published');

    // Other creators can now see it in the bank and preview it, but still not edit it.
    const list = (await otherCreator.get('/api/manage/questions')).body.questions;
    expect(list.find((q: { id: number }) => q.id === id)).toMatchObject({ canEdit: false });
    const preview = await otherCreator.get(`/api/manage/questions/${id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body).not.toHaveProperty('referenceSolution');
  });

  it('publishes without prompting once validation passes', async () => {
    const id = await newQuestion('Clean publish');
    await author.patch(`/api/manage/questions/${id}`, { statement: 'Sum.' });
    await author.post(`/api/manage/questions/${id}/tests`, { tests: [{ input: '3 4\n', expectedOutput: '7\n' }] });
    await author.post(`/api/manage/questions/${id}/validate`, { language: 'cpp', code: '// fake:sum' });
    await ctx.services.worker.drain();
    expect((await author.post(`/api/manage/questions/${id}/publish`)).status).toBe(200);
  });
});
