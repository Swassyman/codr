import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { createContest, createQuestion, setQuestion } from '../helpers/fixtures';
import { participants } from '../../src/server/db/schema';

// The practice bank over a contest's life, with the fake clock moved through
// it. Nothing is written when a contest ends: every answer is computed at
// request time.

let ctx: TestContext;
let alice: TestClient;
let aliceId: number;
let admin: TestClient;

beforeAll(async () => {
  ctx = await createTestContext();
  aliceId = (await createUser(ctx.db, 'alice')).id;
  await createUser(ctx.db, 'boss', 'admin');
  alice = new TestClient(ctx.app);
  await alice.login('alice');
  admin = new TestClient(ctx.app);
  await admin.login('boss');
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(() => {
  ctx.clock.set('2030-01-15T08:00:00Z');
});

const listed = async () => (await alice.get('/api/practice/questions')).body.questions as { id: number; slug: string; fromContests: { id: number; name: string }[] }[];
const ids = async () => (await listed()).map((q) => q.id);
const opens = async (slug: string) => (await alice.get(`/api/practice/questions/${slug}`)).status;

describe('practice visibility across a contest', () => {
  it('hides contest questions before and during the contest, and lists all of them after it', async () => {
    const flagged = await createQuestion(ctx.db, { practice: true });
    const unflagged = await createQuestion(ctx.db, { practice: false });
    // 09:00 to 12:00 by default.
    const contest = await createContest(ctx.db, [flagged.id, unflagged.id], { name: 'Winter Round' });

    // Before: upcoming, so neither appears and neither can be opened, run or submitted.
    expect(await ids()).not.toContain(flagged.id);
    expect(await ids()).not.toContain(unflagged.id);
    for (const q of [flagged, unflagged]) {
      expect(await opens(q.slug)).toBe(404);
      expect((await alice.post(`/api/practice/questions/${q.slug}/submit`, { language: 'cpp', code: '// fake:sum' })).status).toBe(404);
      expect((await alice.post(`/api/practice/questions/${q.slug}/run`, { mode: 'samples', language: 'cpp', code: '// fake:sum' })).status).toBe(404);
    }

    // During.
    ctx.clock.set('2030-01-15T10:00:00Z');
    expect(await ids()).not.toContain(flagged.id);
    expect(await ids()).not.toContain(unflagged.id);
    ctx.clock.set('2030-01-15T11:59:59.999Z');
    expect(await opens(unflagged.slug)).toBe(404);

    // After: both, practice flag or not, tagged with the contest.
    ctx.clock.set('2030-01-15T12:00:00Z');
    const after = await listed();
    for (const q of [flagged, unflagged]) {
      const item = after.find((x) => x.id === q.id);
      expect(item?.fromContests).toEqual([{ id: contest.id, name: 'Winter Round' }]);
      const page = await alice.get(`/api/practice/questions/${q.slug}`);
      expect(page.status).toBe(200);
      expect(page.body.fromContests).toEqual([{ id: contest.id, name: 'Winter Round' }]);
    }
    const sub = await alice.post(`/api/practice/questions/${unflagged.slug}/submit`, { language: 'cpp', code: '// fake:sum' });
    expect(sub.status).toBe(200);
    await ctx.services.worker.drain();
    expect((await alice.get(`/api/submissions/${sub.body.id}`)).body.verdict).toBe('AC');
  });

  it('waits until every published contest containing the question has finished', async () => {
    const q = await createQuestion(ctx.db, { practice: false });
    await createContest(ctx.db, [q.id], { startsAt: new Date('2030-01-14T09:00:00Z'), endsAt: new Date('2030-01-14T12:00:00Z') });
    await createContest(ctx.db, [q.id], { startsAt: new Date('2030-01-16T09:00:00Z'), endsAt: new Date('2030-01-16T12:00:00Z') });
    // One finished yesterday, one is tomorrow: still hidden.
    expect(await ids()).not.toContain(q.id);
    ctx.clock.set('2030-01-16T12:00:00Z');
    expect(await ids()).toContain(q.id);
    expect((await listed()).find((x) => x.id === q.id)?.fromContests).toHaveLength(2);
  });

  it('keeps personal-window questions hidden until the last possible window closes', async () => {
    const q = await createQuestion(ctx.db, { practice: false });
    // Entry closes at 12:00, so someone entering at 11:59 works until 13:29.
    await createContest(ctx.db, [q.id], { timingMode: 'personal_window', durationMinutes: 90 });
    ctx.clock.set('2030-01-15T12:30:00Z');
    expect(await ids()).not.toContain(q.id);
    ctx.clock.set('2030-01-15T13:30:00Z');
    expect(await ids()).toContain(q.id);
  });

  it('is not unlocked by participants finishing early', async () => {
    const q = await createQuestion(ctx.db, { practice: false });
    const c = await createContest(ctx.db, [q.id]);
    ctx.clock.set('2030-01-15T10:00:00Z');
    await alice.post(`/api/contests/${c.id}/register`);
    await alice.post(`/api/contests/${c.id}/enter`);
    expect((await alice.post(`/api/contests/${c.id}/finish`)).status).toBe(200);
    expect(await ids()).not.toContain(q.id);
    expect(await opens(q.slug)).toBe(404);
  });

  it('ignores draft contests: they neither hide practice questions nor unlock others', async () => {
    const practiceQ = await createQuestion(ctx.db, { practice: true });
    const plainQ = await createQuestion(ctx.db, { practice: false });
    await createContest(ctx.db, [practiceQ.id], { status: 'draft' });
    await createContest(ctx.db, [plainQ.id], { status: 'draft', endsAt: new Date('2030-01-15T07:00:00Z'), startsAt: new Date('2030-01-15T06:00:00Z') });
    expect(await ids()).toContain(practiceQ.id);
    expect(await ids()).not.toContain(plainQ.id);
  });

  it('never lists draft questions or questions kept out of practice', async () => {
    const hidden = await createQuestion(ctx.db, { practice: true, practiceHidden: true });
    const hiddenFromContest = await createQuestion(ctx.db, { practice: false, practiceHidden: true });
    await createContest(ctx.db, [hiddenFromContest.id], { startsAt: new Date('2030-01-14T09:00:00Z'), endsAt: new Date('2030-01-14T12:00:00Z') });
    const draft = await createQuestion(ctx.db, { practice: true, status: 'draft' });
    for (const q of [hidden, hiddenFromContest, draft]) {
      expect(await ids()).not.toContain(q.id);
      expect(await opens(q.slug)).toBe(404);
    }
    // Clearing the override brings it back.
    await setQuestion(ctx.db, hiddenFromContest.id, { practiceHidden: false });
    expect(await ids()).toContain(hiddenFromContest.id);
  });

  it('lets staff set the override from the question editor', async () => {
    const q = await createQuestion(ctx.db, { practice: true });
    expect(await ids()).toContain(q.id);
    const patched = await admin.patch(`/api/manage/questions/${q.id}`, { practiceHidden: true });
    expect(patched.status).toBe(200);
    expect(patched.body.practiceHidden).toBe(true);
    expect(await ids()).not.toContain(q.id);
    const list = (await admin.get('/api/manage/questions')).body.questions.find((x: { id: number }) => x.id === q.id);
    expect(list.practiceHidden).toBe(true);
  });

  it('names only contests the participant may know about', async () => {
    const q = await createQuestion(ctx.db, { practice: false });
    const window = { startsAt: new Date('2030-01-14T09:00:00Z'), endsAt: new Date('2030-01-14T12:00:00Z') };
    const pub = await createContest(ctx.db, [q.id], { ...window, name: 'Open Cup' });
    await createContest(ctx.db, [q.id], { ...window, name: 'Secret Selection', visibility: 'private' });
    const joined = await createContest(ctx.db, [q.id], { ...window, name: 'Club Night', visibility: 'invite' });
    await ctx.db.insert(participants).values({ contestId: joined.id, userId: aliceId, joinedAt: window.startsAt });

    const item = (await listed()).find((x) => x.id === q.id);
    expect(item?.fromContests.map((c) => c.id).sort()).toEqual([pub.id, joined.id].sort());
    expect(JSON.stringify(await alice.get(`/api/practice/questions/${q.slug}`))).not.toContain('Secret Selection');
  });
});
