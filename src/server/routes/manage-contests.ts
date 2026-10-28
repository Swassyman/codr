import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { addParticipantSchema, contestPatchSchema, contestQuestionsSchema } from '../../shared/schemas';
import { contestPhase } from '../../shared/timing';
import { questionLetter } from '../../shared/letters';
import type { ContestEditorDTO, ContestListItemDTO, ContestResultsDTO } from '../../shared/api';
import type { DB } from '../db';
import {
  contestQuestions,
  contests,
  integrityEvents,
  participantQuestions,
  participants,
  questions,
  submissions,
  testCases,
  users,
  type Contest,
} from '../db/schema';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../lib/errors';
import { requireStaff } from '../auth/guards';
import type { SessionUser } from '../auth/sessions';
import { isContestStaff } from '../services/contest-state';
import { LOCKED_AFTER_START, computeStandings, contestProblems, hasStarted, integrityCounts, uniqueJoinCode } from '../services/contests';
import { FULL_VISIBILITY, toSubmissionDTO } from '../services/submissions';

async function loadManagedContest(db: DB, user: SessionUser, id: number) {
  const [contest] = await db.select().from(contests).where(eq(contests.id, id));
  if (!contest) throw notFound('Contest not found.');
  if (!isContestStaff(user, contest)) throw forbidden('not_owner', 'Only the creator or an admin can manage this contest.');
  return contest;
}

async function editorDTO(db: DB, contest: Contest, now: Date): Promise<ContestEditorDTO> {
  const items = await db
    .select({
      questionId: contestQuestions.questionId,
      points: contestQuestions.points,
      durationMinutes: contestQuestions.durationMinutes,
      title: questions.title,
      slug: questions.slug,
      status: questions.status,
      questionPoints: questions.points,
      testCount: sql<number>`(select count(*)::int from ${testCases} where ${testCases.questionId} = ${questions.id})`,
    })
    .from(contestQuestions)
    .innerJoin(questions, eq(questions.id, contestQuestions.questionId))
    .where(eq(contestQuestions.contestId, contest.id))
    .orderBy(asc(contestQuestions.position));
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(participants).where(eq(participants.contestId, contest.id));
  return {
    id: contest.id,
    name: contest.name,
    description: contest.description,
    startsAt: contest.startsAt.toISOString(),
    endsAt: contest.endsAt.toISOString(),
    visibility: contest.visibility,
    allowGuests: contest.allowGuests,
    registrationOpen: contest.registrationOpen,
    allowedLanguages: contest.allowedLanguages,
    timingMode: contest.timingMode,
    durationMinutes: contest.durationMinutes,
    defaultQuestionMinutes: contest.defaultQuestionMinutes,
    viewOnce: contest.viewOnce,
    sequential: contest.sequential,
    maxSubmissionsPerQuestion: contest.maxSubmissionsPerQuestion,
    maxRunsPerMinute: contest.maxRunsPerMinute,
    revealHidden: contest.revealHidden,
    verdictDetail: contest.verdictDetail,
    scoring: contest.scoring,
    penaltyMinutes: contest.penaltyMinutes,
    leaderboardEnabled: contest.leaderboardEnabled,
    leaderboardFreezeMinutes: contest.leaderboardFreezeMinutes,
    recordIntegrity: contest.recordIntegrity,
    joinCode: contest.joinCode,
    status: contest.status,
    started: hasStarted(contest, now),
    participantCount: count?.n ?? 0,
    questions: items,
    problems: await contestProblems(db, contest),
  };
}

export async function manageContestRoutes(app: FastifyInstance) {
  const { db, worker } = app.services;

  app.get('/api/manage/contests', async (req): Promise<{ contests: ContestListItemDTO[] }> => {
    const user = requireStaff(req);
    const rows = await db
      .select({
        c: contests,
        questionCount: sql<number>`(select count(*)::int from ${contestQuestions} where ${contestQuestions.contestId} = ${contests.id})`,
        participantCount: sql<number>`(select count(*)::int from ${participants} where ${participants.contestId} = ${contests.id})`,
      })
      .from(contests)
      .where(user.role === 'admin' ? undefined : eq(contests.createdBy, user.id))
      .orderBy(desc(contests.startsAt));
    return {
      contests: rows.map(({ c, questionCount, participantCount }) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        startsAt: c.startsAt.toISOString(),
        endsAt: c.endsAt.toISOString(),
        timingMode: c.timingMode,
        phase: contestPhase(c, req.receivedAt),
        questionCount,
        participantCount,
      })),
    };
  });

  app.post('/api/manage/contests', async (req) => {
    const user = requireStaff(req);
    // Default: tomorrow, on the hour, for two hours.
    const start = new Date(req.receivedAt.getTime() + 24 * 3600_000);
    start.setUTCMinutes(0, 0, 0);
    const [created] = await db
      .insert(contests)
      .values({
        name: 'Untitled contest',
        startsAt: start,
        endsAt: new Date(start.getTime() + 2 * 3600_000),
        joinCode: await uniqueJoinCode(db),
        durationMinutes: 90,
        defaultQuestionMinutes: 30,
        createdBy: user.id,
        createdAt: req.receivedAt,
        updatedAt: req.receivedAt,
      })
      .returning({ id: contests.id });
    return { id: created!.id };
  });

  app.get('/api/manage/contests/:id', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    return editorDTO(db, await loadManagedContest(db, user, id), req.receivedAt);
  });

  app.patch('/api/manage/contests/:id', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const patch = parse(contestPatchSchema, req.body);
    const contest = await loadManagedContest(db, user, id);
    if (hasStarted(contest, req.receivedAt)) {
      const touched = LOCKED_AFTER_START.filter((k) => {
        if (!(k in patch)) return false;
        if (k === 'startsAt') return new Date(patch.startsAt!).getTime() !== contest.startsAt.getTime();
        return patch[k] !== contest[k];
      });
      if (touched.length) {
        throw conflict('contest_started', 'The contest has started, so its timing rules can no longer change. You can still extend the end time.', touched.map((path) => ({ path, message: 'Locked after the start.' })));
      }
    }
    const { startsAt, endsAt, ...rest } = patch;
    const [updated] = await db
      .update(contests)
      .set({
        ...rest,
        ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
        ...(endsAt ? { endsAt: new Date(endsAt) } : {}),
        updatedAt: req.receivedAt,
      })
      .where(eq(contests.id, id))
      .returning();
    return editorDTO(db, updated!, req.receivedAt);
  });

  app.delete('/api/manage/contests/:id', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    await loadManagedContest(db, user, id);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(participants).where(eq(participants.contestId, id));
    if ((count?.n ?? 0) > 0) throw conflict('has_participants', 'People have joined this contest, so it cannot be deleted. Unpublish it instead.');
    await db.delete(contests).where(eq(contests.id, id));
    return { ok: true };
  });

  /** Replaces the ordered question list (with per-question points and minutes). */
  app.put('/api/manage/contests/:id/questions', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const { items } = parse(contestQuestionsSchema, req.body);
    const contest = await loadManagedContest(db, user, id);
    const ids = items.map((i) => i.questionId);
    if (new Set(ids).size !== ids.length) throw badRequest('duplicate_question', 'Each question can appear only once.');
    if (ids.length) {
      const usable = await db
        .select({ id: questions.id })
        .from(questions)
        .where(and(inArray(questions.id, ids), user.role === 'admin' ? undefined : or(eq(questions.status, 'published'), eq(questions.authorId, user.id))));
      if (usable.length !== ids.length) throw badRequest('unknown_question', 'Some questions do not exist or are not available to you.');
    }
    if (hasStarted(contest, req.receivedAt)) {
      const current = await db.select().from(contestQuestions).where(eq(contestQuestions.contestId, id)).orderBy(asc(contestQuestions.position));
      const sameSet = current.length === ids.length && current.every((c, i) => c.questionId === ids[i] && c.durationMinutes === items[i]!.durationMinutes);
      if (!sameSet) throw conflict('contest_started', 'The contest has started, so its questions and their timers can no longer change. Points can still be adjusted.');
    }
    await db.transaction(async (tx) => {
      await tx.delete(contestQuestions).where(eq(contestQuestions.contestId, id));
      if (items.length) {
        await tx.insert(contestQuestions).values(items.map((item, position) => ({ contestId: id, questionId: item.questionId, position, points: item.points, durationMinutes: item.durationMinutes })));
      }
      await tx.update(contests).set({ updatedAt: req.receivedAt }).where(eq(contests.id, id));
    });
    return editorDTO(db, contest, req.receivedAt);
  });

  app.post('/api/manage/contests/:id/publish', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const contest = await loadManagedContest(db, user, id);
    const problems = await contestProblems(db, contest);
    if (problems.length) throw badRequest('not_ready', 'Finish these before publishing.', problems);
    await db.update(contests).set({ status: 'published', updatedAt: req.receivedAt }).where(eq(contests.id, id));
    return { ok: true };
  });

  app.post('/api/manage/contests/:id/unpublish', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const contest = await loadManagedContest(db, user, id);
    const [entered] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(participants)
      .where(and(eq(participants.contestId, id), sql`${participants.enteredAt} IS NOT NULL`));
    if (hasStarted(contest, req.receivedAt) && (entered?.n ?? 0) > 0) {
      throw conflict('in_progress', 'Participants have already started. The contest stays published.');
    }
    await db.update(contests).set({ status: 'draft', updatedAt: req.receivedAt }).where(eq(contests.id, id));
    return { ok: true };
  });

  app.post('/api/manage/contests/:id/join-code', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    await loadManagedContest(db, user, id);
    const joinCode = await uniqueJoinCode(db);
    await db.update(contests).set({ joinCode, updatedAt: req.receivedAt }).where(eq(contests.id, id));
    return { joinCode };
  });

  // ------------------------------------------------------------ Participants

  app.post('/api/manage/contests/:id/participants', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const { username } = parse(addParticipantSchema, req.body);
    await loadManagedContest(db, user, id);
    const [target] = await db.select().from(users).where(and(sql`lower(${users.username}) = lower(${username})`, eq(users.isGuest, false)));
    if (!target) throw badRequest('unknown_user', 'No account has that username.', [{ path: 'username', message: 'No account has that username.' }]);
    await db.insert(participants).values({ contestId: id, userId: target.id, joinedAt: req.receivedAt }).onConflictDoNothing();
    return { ok: true };
  });

  app.delete('/api/manage/contests/:id/participants/:pid', async (req) => {
    const user = requireStaff(req);
    const { id, pid } = parse(z.object({ id: z.coerce.number().int(), pid: z.coerce.number().int() }), req.params);
    await loadManagedContest(db, user, id);
    const [p] = await db.select().from(participants).where(and(eq(participants.id, pid), eq(participants.contestId, id)));
    if (!p) throw notFound('Participant not found.');
    if (p.enteredAt) throw conflict('already_started', 'This participant has started the contest and cannot be removed.');
    await db.delete(participants).where(eq(participants.id, pid));
    return { ok: true };
  });

  // ------------------------------------------------------------ Results

  app.get('/api/manage/contests/:id/results', async (req): Promise<ContestResultsDTO> => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const contest = await loadManagedContest(db, user, id);
    const standings = await computeStandings(db, contest, null);
    const people = await db.select().from(participants).where(eq(participants.contestId, id));
    const byParticipant = new Map(people.map((p) => [p.id, p]));
    const views = people.length
      ? await db.select().from(participantQuestions).where(inArray(participantQuestions.participantId, people.map((p) => p.id)))
      : [];
    const integrity = await integrityCounts(db, id);
    const items = await db
      .select({ questionId: contestQuestions.questionId, title: questions.title, points: contestQuestions.points, questionPoints: questions.points })
      .from(contestQuestions)
      .innerJoin(questions, eq(questions.id, contestQuestions.questionId))
      .where(eq(contestQuestions.contestId, id))
      .orderBy(asc(contestQuestions.position));
    return {
      contest: { id: contest.id, name: contest.name, timingMode: contest.timingMode, recordIntegrity: contest.recordIntegrity, penaltyMinutes: contest.penaltyMinutes },
      questions: items.map((q, i) => ({ questionId: q.questionId, letter: questionLetter(i), title: q.title, maxScore: q.points ?? q.questionPoints })),
      participants: standings.map((row) => {
        const p = byParticipant.get(row.participantId)!;
        return {
          ...row,
          enteredAt: p.enteredAt?.toISOString() ?? null,
          finishedAt: p.finishedAt?.toISOString() ?? null,
          integrity: integrity.get(row.userId) ?? { blurs: 0, pastes: 0, pastedChars: 0 },
          views: views
            .filter((v) => v.participantId === p.id)
            .map((v) => ({ questionId: v.questionId, firstViewedAt: v.firstViewedAt.toISOString(), leftAt: v.leftAt?.toISOString() ?? null })),
        };
      }),
    };
  });

  app.get('/api/manage/contests/:id/submissions', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const query = parse(z.object({ userId: z.coerce.number().int().optional() }), req.query);
    await loadManagedContest(db, user, id);
    const rows = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.contestId, id), query.userId ? eq(submissions.userId, query.userId) : undefined))
      .orderBy(desc(submissions.id))
      .limit(500);
    return { submissions: rows.map((s) => ({ ...toSubmissionDTO(s, { ...FULL_VISIBILITY, includeCode: false }), userId: s.userId })) };
  });

  app.get('/api/manage/contests/:id/integrity', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const { userId } = parse(z.object({ userId: z.coerce.number().int() }), req.query);
    await loadManagedContest(db, user, id);
    const rows = await db
      .select()
      .from(integrityEvents)
      .where(and(eq(integrityEvents.contestId, id), eq(integrityEvents.userId, userId)))
      .orderBy(asc(integrityEvents.createdAt))
      .limit(2000);
    return {
      events: rows.map((e) => ({ type: e.type, questionId: e.questionId, at: e.createdAt.toISOString(), chars: (e.detail as { chars?: number }).chars ?? null })),
    };
  });

  /** Judge a submission again (e.g. after fixing a test or a runner hiccup). */
  app.post('/api/manage/submissions/:id/rejudge', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const [sub] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!sub) throw notFound('Submission not found.');
    if (sub.contestId != null) await loadManagedContest(db, user, sub.contestId);
    else if (user.role !== 'admin') throw forbidden();
    await db
      .update(submissions)
      .set({ status: 'queued', verdict: null, score: null, fraction: null, passed: 0, total: 0, results: [], compileOutput: null, timeMs: null, memoryKb: null, startedAt: null, judgedAt: null })
      .where(eq(submissions.id, id));
    worker.notify();
    return { ok: true };
  });
}
