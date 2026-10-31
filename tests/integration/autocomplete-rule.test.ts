import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { createContest, createQuestion } from '../helpers/fixtures';
import { contests } from '../../src/server/db/schema';

let ctx: TestContext;
let creator: TestClient;
let creatorId: number;
let n = 0;

beforeAll(async () => {
  ctx = await createTestContext();
  creatorId = (await createUser(ctx.db, 'maker', 'creator')).id;
  creator = new TestClient(ctx.app);
  await creator.login('maker');
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(() => {
  ctx.clock.set('2030-01-15T10:00:00Z');
});

async function participant() {
  const name = `ac${++n}`;
  await createUser(ctx.db, name);
  const client = new TestClient(ctx.app);
  await client.login(name);
  return client;
}

describe('contest autocomplete rule', () => {
  it('defaults to user_choice, which is what existing contests migrate to', async () => {
    const q = await createQuestion(ctx.db);
    const c = await createContest(ctx.db, [q.id]);
    const [row] = await ctx.db.select().from(contests).where(eq(contests.id, c.id));
    expect(row!.autocomplete).toBe('user_choice');
    const created = await creator.post('/api/manage/contests');
    expect((await creator.get(`/api/manage/contests/${created.body.id}`)).body.autocomplete).toBe('user_choice');
  });

  it('is set in the contest editor and validated', async () => {
    const { body } = await creator.post('/api/manage/contests');
    const patched = await creator.patch(`/api/manage/contests/${body.id}`, { autocomplete: 'off' });
    expect(patched.status).toBe(200);
    expect(patched.body.autocomplete).toBe('off');
    const bad = await creator.patch(`/api/manage/contests/${body.id}`, { autocomplete: 'sometimes' });
    expect(bad.status).toBe(400);
    expect((await creator.get(`/api/manage/contests/${body.id}`)).body.autocomplete).toBe('off');
  });

  it('cannot change once the contest has started', async () => {
    const q = await createQuestion(ctx.db);
    const c = await createContest(ctx.db, [q.id], { createdBy: creatorId, autocomplete: 'off' });
    const res = await creator.patch(`/api/manage/contests/${c.id}`, { autocomplete: 'on' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('contest_started');
    expect(res.body.error.details).toEqual([{ path: 'autocomplete', message: 'Locked after the start.' }]);
    // Sending the unchanged value is fine (the editor saves whole forms).
    expect((await creator.patch(`/api/manage/contests/${c.id}`, { autocomplete: 'off' })).status).toBe(200);
  });

  it.each([
    ['off', false],
    ['on', true],
    ['user_choice', null],
  ] as const)('exposes rule %s in the lobby and as the effective policy when a question opens', async (rule, forced) => {
    const q = await createQuestion(ctx.db);
    const c = await createContest(ctx.db, [q.id], { autocomplete: rule });
    const client = await participant();
    expect((await client.get(`/api/contests/${c.id}`)).body.autocomplete).toBe(rule);
    await client.post(`/api/contests/${c.id}/register`);
    await client.post(`/api/contests/${c.id}/enter`);
    const opened = await client.post(`/api/contests/${c.id}/questions/${q.id}/open`);
    expect(opened.status).toBe(200);
    expect(opened.body.autocomplete).toEqual({ rule, forced });
  });

  it('has no client-side override: request fields cannot change what the server decides', async () => {
    const q = await createQuestion(ctx.db);
    const c = await createContest(ctx.db, [q.id], { autocomplete: 'off' });
    const client = await participant();
    await client.post(`/api/contests/${c.id}/register`);
    await client.post(`/api/contests/${c.id}/enter`);
    const opened = await client.request('POST', `/api/contests/${c.id}/questions/${q.id}/open?autocomplete=on`, { autocomplete: 'on', forced: true });
    expect(opened.body.autocomplete).toEqual({ rule: 'off', forced: false });
  });

  it('leaves practice to the participant', async () => {
    const q = await createQuestion(ctx.db, { practice: true });
    const client = await participant();
    const page = await client.get(`/api/practice/questions/${q.slug}`);
    expect(page.status).toBe(200);
    expect(page.body.autocomplete).toEqual({ rule: 'user_choice', forced: null });
  });
});
