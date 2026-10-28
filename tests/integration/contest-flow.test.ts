import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { createContest, createQuestion } from '../helpers/fixtures';
import { submissions } from '../../src/server/db/schema';

let ctx: TestContext;
let creator: TestClient;
let creatorId: number;
let n = 0;

beforeAll(async () => {
  ctx = await createTestContext();
  creatorId = (await createUser(ctx.db, 'creator', 'creator')).id;
  creator = new TestClient(ctx.app);
  await creator.login('creator');
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(() => {
  ctx.clock.set('2030-01-15T10:00:00Z');
});

/** A fresh signed-in participant (each test gets its own to keep state separate). */
async function participant() {
  const name = `p${++n}`;
  await createUser(ctx.db, name);
  const client = new TestClient(ctx.app);
  await client.login(name);
  return { client, name };
}

async function joinAndEnter(client: TestClient, contestId: number) {
  expect((await client.post(`/api/contests/${contestId}/register`)).status).toBe(200);
  const entered = await client.post(`/api/contests/${contestId}/enter`);
  expect(entered.status).toBe(200);
  return entered.body.state;
}

const open = (c: TestClient, contestId: number, qid: number) => c.post(`/api/contests/${contestId}/questions/${qid}/open`);
const submit = (c: TestClient, contestId: number, qid: number, code = '// fake:sum', headers: Record<string, string> = {}) =>
  c.post(`/api/contests/${contestId}/questions/${qid}/submit`, { language: 'cpp', code }, headers);
const draft = (c: TestClient, contestId: number, qid: number, code: string) => c.put(`/api/contests/${contestId}/questions/${qid}/draft`, { language: 'cpp', code });

describe('view-once contest', () => {
  it('locks a question permanently once the participant moves on', async () => {
    const [q1, q2, q3] = [await createQuestion(ctx.db), await createQuestion(ctx.db), await createQuestion(ctx.db)];
    const contest = await createContest(ctx.db, [q1.id, q2.id, q3.id], { viewOnce: true });
    const { client, name } = await participant();
    await joinAndEnter(client, contest.id);

    const first = await open(client, contest.id, q1.id);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ letter: 'A', title: q1.title, statement: expect.any(String) });

    // Refreshing the same question is not "navigating away".
    expect((await open(client, contest.id, q1.id)).status).toBe(200);
    expect((await submit(client, contest.id, q1.id)).status).toBe(200);

    // Opening B leaves A for good.
    expect((await open(client, contest.id, q2.id)).status).toBe(200);
    const again = await open(client, contest.id, q1.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('question_left');
    expect(JSON.stringify(again.body)).not.toContain(q1.statement);

    // No submissions, runs or draft saves for the left question.
    expect((await submit(client, contest.id, q1.id)).body.error.code).toBe('question_left');
    expect((await draft(client, contest.id, q1.id, 'x')).body.error.code).toBe('question_left');
    const run = await client.post(`/api/contests/${contest.id}/questions/${q1.id}/run`, { mode: 'samples', language: 'cpp', code: '// fake:sum' });
    expect(run.body.error.code).toBe('question_left');

    // A second device (new session for the same account) cannot get back in either.
    const otherDevice = new TestClient(ctx.app);
    await otherDevice.login(name);
    expect((await open(otherDevice, contest.id, q1.id)).body.error.code).toBe('question_left');
    expect((await open(otherDevice, contest.id, q2.id)).status).toBe(200);

    const state = (await client.get(`/api/contests/${contest.id}/state`)).body;
    expect(state.questions.map((q: { state: string }) => q.state)).toEqual(['locked', 'open', 'available']);
    expect(state.current).toBe(q2.id);
  });

  it('locks the current question when the participant leaves through the app', async () => {
    const [q1, q2] = [await createQuestion(ctx.db), await createQuestion(ctx.db)];
    const contest = await createContest(ctx.db, [q1.id, q2.id], { viewOnce: true });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await open(client, contest.id, q1.id);
    expect((await client.post(`/api/contests/${contest.id}/questions/${q1.id}/leave`)).status).toBe(200);
    expect((await open(client, contest.id, q1.id)).body.error.code).toBe('question_left');
  });

  it('serialises concurrent opens from two tabs', async () => {
    const [q1, q2, q3] = [await createQuestion(ctx.db), await createQuestion(ctx.db), await createQuestion(ctx.db)];
    const contest = await createContest(ctx.db, [q1.id, q2.id, q3.id], { viewOnce: true });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await Promise.all([open(client, contest.id, q1.id), open(client, contest.id, q2.id), open(client, contest.id, q3.id)]);
    const state = (await client.get(`/api/contests/${contest.id}/state`)).body;
    // Exactly one question can remain open.
    expect(state.questions.filter((q: { state: string }) => q.state === 'open')).toHaveLength(1);
  });
});

describe('sequential contest', () => {
  it('refuses skipping ahead', async () => {
    const [q1, q2] = [await createQuestion(ctx.db), await createQuestion(ctx.db)];
    const contest = await createContest(ctx.db, [q1.id, q2.id], { sequential: true });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    expect((await open(client, contest.id, q2.id)).body.error.code).toBe('sequential');
    await open(client, contest.id, q1.id);
    expect((await open(client, contest.id, q2.id)).status).toBe(200);
    expect((await open(client, contest.id, q1.id)).status).toBe(200);
  });
});

describe('per-question timer', () => {
  it('auto-submits the code at expiry and then locks the question', async () => {
    const [q1, q2] = [await createQuestion(ctx.db), await createQuestion(ctx.db)];
    const contest = await createContest(ctx.db, [q1.id, q2.id], { timingMode: 'per_question', defaultQuestionMinutes: 10 });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);

    const opened = await open(client, contest.id, q1.id);
    expect(opened.body.deadline).toBe('2030-01-15T10:10:00.000Z');

    ctx.clock.set('2030-01-15T10:09:59Z');
    expect((await draft(client, contest.id, q1.id, '// fake:sum')).status).toBe(200);

    ctx.clock.set('2030-01-15T10:10:00Z');
    expect((await draft(client, contest.id, q1.id, '// fake:wa')).body.error.code).toBe('question_expired');
    expect((await submit(client, contest.id, q1.id)).body.error.code).toBe('question_expired');

    expect(await ctx.services.scheduler.tick()).toBe(1);
    expect(await ctx.services.scheduler.tick()).toBe(0); // processed once
    await ctx.services.worker.drain();
    const list = (await client.get(`/api/contests/${contest.id}/questions/${q1.id}/submissions`)).body.submissions;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ isAuto: true, verdict: 'AC', receivedAt: '2030-01-15T10:10:00.000Z' });

    // The next question has its own fresh timer.
    expect((await open(client, contest.id, q2.id)).body.deadline).toBe('2030-01-15T10:20:00.000Z');
  });

  it('does not auto-submit code that was already submitted, or after leaving in view-once mode', async () => {
    const [q1, q2] = [await createQuestion(ctx.db), await createQuestion(ctx.db)];
    const contest = await createContest(ctx.db, [q1.id, q2.id], { timingMode: 'per_question', defaultQuestionMinutes: 5, viewOnce: true });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await open(client, contest.id, q1.id);
    await draft(client, contest.id, q1.id, '// fake:sum');
    await submit(client, contest.id, q1.id, '// fake:sum');
    await open(client, contest.id, q2.id); // leaves q1
    await draft(client, contest.id, q2.id, '// fake:sum');
    ctx.clock.set('2030-01-15T10:30:00Z');
    await ctx.services.scheduler.tick();
    await ctx.services.worker.drain();
    const rows = await ctx.db.select().from(submissions).where(eq(submissions.contestId, contest.id));
    expect(rows.filter((s) => s.isAuto).map((s) => s.questionId)).toEqual([q2.id]);
  });
});

describe('whole-contest fixed window', () => {
  it('accepts work until the end and rejects late submissions cleanly', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id]);
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await open(client, contest.id, q.id);
    ctx.clock.set('2030-01-15T11:59:59.999Z');
    expect((await submit(client, contest.id, q.id)).status).toBe(200);
    ctx.clock.set('2030-01-15T12:00:00Z');
    const late = await submit(client, contest.id, q.id);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({ code: 'contest_ended', details: { deadline: '2030-01-15T12:00:00.000Z' } });
  });

  it('cannot be entered before the start or after the end', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { startsAt: new Date('2030-01-15T11:00:00Z') });
    const { client } = await participant();
    await client.post(`/api/contests/${contest.id}/register`);
    expect((await client.post(`/api/contests/${contest.id}/enter`)).body.error.code).toBe('not_started');
    ctx.clock.set('2030-01-15T12:00:00Z');
    expect((await client.post(`/api/contests/${contest.id}/enter`)).body.error.code).toBe('contest_ended');
  });
});

describe('whole-contest personal window', () => {
  it('runs each participant’s clock from their own entry, with a hard entry cutoff', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { timingMode: 'personal_window', durationMinutes: 30 });
    const early = await participant();
    const late = await participant();

    ctx.clock.set('2030-01-15T10:00:00Z');
    const s1 = await joinAndEnter(early.client, contest.id);
    expect(s1.participantDeadline).toBe('2030-01-15T10:30:00.000Z');

    ctx.clock.set('2030-01-15T11:50:00Z');
    const s2 = await joinAndEnter(late.client, contest.id);
    expect(s2.participantDeadline).toBe('2030-01-15T12:20:00.000Z');
    await open(late.client, contest.id, q.id);

    // Past the cutoff the late starter keeps working; the early one is done.
    ctx.clock.set('2030-01-15T12:10:00Z');
    expect((await submit(late.client, contest.id, q.id)).status).toBe(200);
    expect((await early.client.post(`/api/contests/${contest.id}/questions/${q.id}/open`)).body.error.code).toBe('time_up');

    const tooLate = await participant();
    await tooLate.client.post(`/api/contests/${contest.id}/register`).catch(() => null);
    expect((await tooLate.client.post(`/api/contests/${contest.id}/enter`)).status).toBeGreaterThanOrEqual(400);
  });

  it('keeps the same deadline after the browser is closed and reopened', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { timingMode: 'personal_window', durationMinutes: 45 });
    const { client, name } = await participant();
    await joinAndEnter(client, contest.id);
    ctx.clock.set('2030-01-15T10:20:00Z');
    const reopened = new TestClient(ctx.app);
    await reopened.login(name);
    const state = (await reopened.get(`/api/contests/${contest.id}/state`)).body;
    expect(state.participantDeadline).toBe('2030-01-15T10:45:00.000Z');
    // Entering again does not restart the clock.
    expect((await reopened.post(`/api/contests/${contest.id}/enter`)).body.state.participantDeadline).toBe('2030-01-15T10:45:00.000Z');
  });
});

describe('contest limits and visibility rules', () => {
  it('limits submissions per question (auto-submits do not count)', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { maxSubmissionsPerQuestion: 2 });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await open(client, contest.id, q.id);
    expect((await submit(client, contest.id, q.id)).status).toBe(200);
    expect((await submit(client, contest.id, q.id)).status).toBe(200);
    const third = await submit(client, contest.id, q.id);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('submission_limit');
  });

  it('treats a retried submit (same idempotency key) as the same submission, even at the limit', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { maxSubmissionsPerQuestion: 1 });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await open(client, contest.id, q.id);
    const key = { 'idempotency-key': 'retry-key-123456' };
    const [a, b] = await Promise.all([submit(client, contest.id, q.id, '// fake:sum', key), submit(client, contest.id, q.id, '// fake:sum', key)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.id).toBe(b.body.id);
  });

  it('limits runs per minute using server time', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { maxRunsPerMinute: 2 });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await open(client, contest.id, q.id);
    const run = () => client.post(`/api/contests/${contest.id}/questions/${q.id}/run`, { mode: 'custom', language: 'cpp', code: '// fake:sum', input: '1 2' });
    expect((await run()).status).toBe(200);
    expect((await run()).status).toBe(200);
    expect((await run()).body.error.code).toBe('run_limit');
    ctx.clock.advance(61_000);
    expect((await run()).status).toBe(200);
  });

  it('withholds hidden-test results until the contest is over for the participant', async () => {
    const q = await createQuestion(ctx.db, { tests: [{ input: '1 1\n', output: '2\n', hidden: false }, { input: '2 2\n', output: '5\n', hidden: true }] });
    const contest = await createContest(ctx.db, [q.id], { revealHidden: 'after' });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await open(client, contest.id, q.id);
    const { id } = (await submit(client, contest.id, q.id)).body;
    await ctx.services.worker.drain();

    const during = (await client.get(`/api/submissions/${id}`)).body;
    expect(during).toMatchObject({ withheld: true, score: null, verdict: 'AC' });
    expect(during.results.every((r: { hidden: boolean }) => !r.hidden)).toBe(true);

    ctx.clock.set('2030-01-15T12:00:00Z');
    const after = (await client.get(`/api/submissions/${id}`)).body;
    expect(after).toMatchObject({ withheld: false, verdict: 'WA', score: 50 });
  });

  it('shows only pass counts when the contest hides per-test detail', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { verdictDetail: 'summary' });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    await open(client, contest.id, q.id);
    const { id } = (await submit(client, contest.id, q.id)).body;
    await ctx.services.worker.drain();
    const s = (await client.get(`/api/submissions/${id}`)).body;
    expect(s.results).toBeNull();
    expect(s).toMatchObject({ verdict: 'AC', passed: 3, total: 3 });
  });

  it('applies the contest-wide language override', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { allowedLanguages: ['python'] });
    const { client } = await participant();
    await joinAndEnter(client, contest.id);
    expect((await open(client, contest.id, q.id)).body.languages).toEqual(['python']);
    expect((await submit(client, contest.id, q.id)).body.error.code).toBe('language_not_allowed');
  });

  it('hides invite-only contests from people who have not joined', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { visibility: 'invite' });
    const { client } = await participant();
    expect((await client.get(`/api/contests/${contest.id}`)).status).toBe(404);
    expect((await client.post('/api/contests/join', { code: contest.joinCode.toLowerCase().replace('-', ' ') })).status).toBe(200);
    expect((await client.get(`/api/contests/${contest.id}`)).status).toBe(200);
  });
});

describe('guests', () => {
  it('join with a code and a name, and stay inside their contest', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { visibility: 'invite', allowGuests: true });
    const other = await createContest(ctx.db, [q.id]);
    const guest = new TestClient(ctx.app);
    expect((await guest.post('/api/contests/join', { code: contest.joinCode })).status).toBe(400);
    const joined = await guest.post('/api/contests/join', { code: contest.joinCode, displayName: 'Visitor' });
    expect(joined.body).toEqual({ contestId: contest.id });
    const me = (await guest.get('/api/auth/me')).body.user;
    expect(me).toMatchObject({ isGuest: true, displayName: 'Visitor', guestContestId: contest.id });

    expect((await guest.post(`/api/contests/${contest.id}/enter`)).status).toBe(200);
    expect((await open(guest, contest.id, q.id)).status).toBe(200);
    expect((await guest.get(`/api/contests/${other.id}`)).status).toBe(404);
    expect((await guest.get('/api/practice/questions')).status).toBe(403);
  });

  it('are refused when the contest requires accounts', async () => {
    const q = await createQuestion(ctx.db);
    const contest = await createContest(ctx.db, [q.id], { visibility: 'invite' });
    const res = await new TestClient(ctx.app).post('/api/contests/join', { code: contest.joinCode, displayName: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('integrity events', () => {
  it('are stored with server time only when the contest records them', async () => {
    const q = await createQuestion(ctx.db);
    const recorded = await createContest(ctx.db, [q.id], { recordIntegrity: true, createdBy: null });
    const { client } = await participant();
    await joinAndEnter(client, recorded.id);
    const res = await client.post(`/api/contests/${recorded.id}/integrity`, {
      events: [
        { type: 'blur', at: '2030-01-15T09:00:00Z' },
        { type: 'paste', at: '2030-01-15T10:00:01Z', questionId: q.id, chars: 120 },
      ],
    });
    expect(res.body.recorded).toBe(2);

    const silent = await createContest(ctx.db, [q.id]);
    await joinAndEnter(client, silent.id);
    expect((await client.post(`/api/contests/${silent.id}/integrity`, { events: [{ type: 'blur', at: '2030-01-15T10:00:00Z' }] })).body.recorded).toBe(0);
  });
});

describe('contest builder', () => {
  it('builds, validates and publishes a contest, then locks its timing rules once it starts', async () => {
    const q = await createQuestion(ctx.db);
    const draftQ = await createQuestion(ctx.db, { status: 'draft', authorId: creatorId });
    const { id } = (await creator.post('/api/manage/contests')).body;
    const base = `/api/manage/contests/${id}`;

    await creator.patch(base, { name: 'Friday round', startsAt: '2030-01-15T10:30:00Z', endsAt: '2030-01-15T10:00:00Z', timingMode: 'personal_window', durationMinutes: null });
    const notReady = await creator.post(`${base}/publish`);
    expect(notReady.status).toBe(400);
    expect(notReady.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['endsAt', 'durationMinutes', 'questions']));

    expect((await creator.put(`${base}/questions`, { items: [{ questionId: q.id, points: 50, durationMinutes: null }, { questionId: draftQ.id, points: null, durationMinutes: null }] })).status).toBe(200);
    await creator.patch(base, { endsAt: '2030-01-15T13:00:00Z', durationMinutes: 60 });
    expect((await creator.post(`${base}/publish`)).body.error.details[0].message).toMatch(/Publish these questions/);

    await creator.put(`${base}/questions`, { items: [{ questionId: q.id, points: 50, durationMinutes: null }] });
    expect((await creator.post(`${base}/publish`)).status).toBe(200);

    ctx.clock.set('2030-01-15T10:31:00Z');
    const locked = await creator.patch(base, { viewOnce: true });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('contest_started');
    expect((await creator.patch(base, { endsAt: '2030-01-15T14:00:00Z' })).status).toBe(200);
    expect((await creator.put(`${base}/questions`, { items: [] })).status).toBe(409);

    const { client } = await participant();
    expect((await client.get(base)).status).toBe(403);
  });

  it('reports results with per-question scores and integrity counts', async () => {
    const [q1, q2] = [await createQuestion(ctx.db), await createQuestion(ctx.db)];
    const contest = await createContest(ctx.db, [q1.id, q2.id], { recordIntegrity: true, createdBy: creatorId, penaltyMinutes: 20 });
    const a = await participant();
    const b = await participant();
    for (const p of [a, b]) {
      await joinAndEnter(p.client, contest.id);
      await open(p.client, contest.id, q1.id);
    }
    ctx.clock.set('2030-01-15T10:10:00Z');
    await submit(a.client, contest.id, q1.id, '// fake:wa');
    ctx.clock.set('2030-01-15T10:20:00Z');
    await submit(a.client, contest.id, q1.id, '// fake:sum');
    await submit(b.client, contest.id, q1.id, '// fake:sum');
    await a.client.post(`/api/contests/${contest.id}/integrity`, { events: [{ type: 'blur', at: '2030-01-15T10:05:00Z' }] });
    await ctx.services.worker.drain();

    const results = (await creator.get(`/api/manage/contests/${contest.id}/results`)).body;
    expect(results.questions.map((q: { letter: string }) => q.letter)).toEqual(['A', 'B']);
    const [first, second] = results.participants;
    expect(first.displayName).toBe(b.name); // same score, less penalty (no wrong attempt)
    expect(first).toMatchObject({ rank: 1, score: 100, penalty: 80 });
    expect(second).toMatchObject({ rank: 2, score: 100, penalty: 100 });
    expect(second.integrity.blurs).toBe(1);
  });
});

describe('leaderboard', () => {
  it('is off unless enabled, and frozen for participants near the end', async () => {
    const q = await createQuestion(ctx.db);
    const off = await createContest(ctx.db, [q.id]);
    const { client } = await participant();
    await joinAndEnter(client, off.id);
    expect((await client.get(`/api/contests/${off.id}/leaderboard`)).status).toBe(404);

    const on = await createContest(ctx.db, [q.id], { leaderboardEnabled: true, leaderboardFreezeMinutes: 60 });
    await joinAndEnter(client, on.id);
    await open(client, on.id, q.id);
    await submit(client, on.id, q.id);
    ctx.clock.set('2030-01-15T11:30:00Z');
    await submit(client, on.id, q.id, '// fake:wa');
    await ctx.services.worker.drain();
    const board = (await client.get(`/api/contests/${on.id}/leaderboard`)).body;
    expect(board.frozenAt).toBe('2030-01-15T11:00:00.000Z');
    expect(board.rows[0]).toMatchObject({ score: 100 });
    expect(board.rows[0].questions[0].attempts).toBe(1); // the post-freeze attempt is hidden
  });
});
