import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  LOCK_MESSAGES,
  canEnter,
  contestFinalEnd,
  contestPhase,
  openEffects,
  participantDeadline,
  participationLock,
  participationOver,
  questionAccess,
  type AccessDecision,
  type LockReason,
} from '../../shared/timing';
import { questionLetter } from '../../shared/letters';
import { draftSchema, idempotencyKeySchema, integrityBatchSchema, joinSchema, solveRunSchema, submitSchema } from '../../shared/schemas';
import type { ContestLobbyDTO, ContestQuestionDTO, ContestStateDTO, LeaderboardDTO, QuestionNavState } from '../../shared/api';
import type { DB, Tx } from '../db';
import {
  contestQuestions,
  contests,
  integrityEvents,
  participantQuestions,
  participants,
  questions,
  runs,
  submissions,
  users,
} from '../db/schema';
import { HttpError, badRequest, conflict, forbidden, notFound, parse, tooMany, unauthorized } from '../lib/errors';
import { requireUser } from '../auth/guards';
import { SESSION_COOKIE, createSession, randomToken, type SessionUser } from '../auth/sessions';
import { isContestStaff, loadContestState, timingOf, visibilityFor } from '../services/contest-state';
import { activeFreeze, computeStandings, normalizeJoinCode } from '../services/contests';
import { createSubmission, loadDrafts, queuePosition, saveDraft, toSubmissionDTO } from '../services/submissions';
import { allowedLanguages, assertLanguage, toWorkspace, userKey } from '../services/workspace';

const contestParams = z.object({ id: z.coerce.number().int().positive() });
const questionParams = z.object({ id: z.coerce.number().int().positive(), qid: z.coerce.number().int().positive() });

type State = NonNullable<Awaited<ReturnType<typeof loadContestState>>>;

/** A refusal based on time or lock rules: 409 with the reason as the code. */
function locked(decision: Pick<AccessDecision, 'reason' | 'deadline'>): HttpError {
  const reason = (decision.reason ?? 'contest_ended') as LockReason;
  return conflict(reason, LOCK_MESSAGES[reason], { deadline: decision.deadline?.toISOString() ?? null });
}

export async function contestPlayRoutes(app: FastifyInstance) {
  const { db, runner, worker, events, config } = app.services;

  /** Loads the contest if this user may see it; 404 otherwise (does not leak invite-only contests). */
  async function visibleState(user: SessionUser | null, contestId: number, conn: DB | Tx = db): Promise<State> {
    const state = user ? await loadContestState(conn, contestId, user.id) : await loadContestState(conn, contestId, -1);
    if (!state) throw notFound('Contest not found.');
    const staff = user ? isContestStaff(user, state.contest) : false;
    if (user?.isGuest && user.guestContestId !== contestId) throw notFound('Contest not found.');
    if (staff) return state;
    if (state.contest.status !== 'published') throw notFound('Contest not found.');
    if (state.contest.visibility !== 'public' && !state.participant) throw notFound('Contest not found.');
    return state;
  }

  function requireParticipant(state: State) {
    if (!state.participant) throw forbidden('not_participant', 'Join this contest first.');
    return state.participant;
  }

  /** Re-reads state inside a transaction with the participant row locked. */
  async function lockedState(tx: Tx, user: SessionUser, contestId: number) {
    const [row] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(and(eq(participants.contestId, contestId), eq(participants.userId, user.id)))
      .for('update');
    if (!row) throw forbidden('not_participant', 'Join this contest first.');
    const state = await loadContestState(tx, contestId, user.id);
    return state!;
  }

  async function userSubmissionStats(contestId: number, userId: number) {
    const rows = await db
      .select({
        questionId: submissions.questionId,
        attempts: sql<number>`count(*) filter (where ${submissions.verdict} is distinct from 'CE')::int`,
        manual: sql<number>`count(*) filter (where not ${submissions.isAuto})::int`,
        best: sql<number | null>`max(${submissions.score})`,
      })
      .from(submissions)
      .where(and(eq(submissions.contestId, contestId), eq(submissions.userId, userId)))
      .groupBy(submissions.questionId);
    return new Map(rows.map((r) => [r.questionId, r]));
  }

  async function buildState(state: State, user: SessionUser, now: Date): Promise<ContestStateDTO> {
    const timing = timingOf(state.contest);
    const titles = await db
      .select({ id: questions.id, title: questions.title, points: questions.points })
      .from(questions)
      .innerJoin(contestQuestions, eq(contestQuestions.questionId, questions.id))
      .where(eq(contestQuestions.contestId, state.contest.id));
    const byId = new Map(titles.map((t) => [t.id, t]));
    const stats = await userSubmissionStats(state.contest.id, user.id);
    const over = participationOver(timing, state.participant, state.slots, now);
    const showScores = state.contest.revealHidden === 'during' || over;
    const lock = participationLock(timing, state.participant, now);
    let current: number | null = null;
    const list = state.slots.map((slot, i) => {
      const item = state.items[i]!;
      const decision = questionAccess({ contest: timing, participant: state.participant, slots: state.slots, questionId: slot.questionId, now, action: 'open' });
      let nav: QuestionNavState;
      if (decision.ok) nav = slot.firstViewedAt ? 'open' : 'available';
      else nav = decision.reason === 'sequential' || decision.reason === 'not_started' || decision.reason === 'not_entered' ? 'waiting' : 'locked';
      if (state.contest.viewOnce && nav === 'open') current = slot.questionId;
      const s = stats.get(slot.questionId);
      return {
        questionId: slot.questionId,
        letter: questionLetter(i),
        title: byId.get(slot.questionId)?.title ?? '',
        points: item.points ?? byId.get(slot.questionId)?.points ?? 0,
        state: nav,
        reason: decision.reason ? LOCK_MESSAGES[decision.reason] : null,
        reasonCode: decision.reason,
        deadline: decision.deadline?.toISOString() ?? null,
        durationMinutes: state.contest.timingMode === 'per_question' ? (slot.durationMinutes ?? state.contest.defaultQuestionMinutes) : null,
        firstViewedAt: slot.firstViewedAt?.toISOString() ?? null,
        leftAt: slot.leftAt?.toISOString() ?? null,
        bestScore: showScores && s ? (s.best ?? 0) : null,
        attempts: s?.attempts ?? 0,
        submissionsUsed: s?.manual ?? 0,
      };
    });
    return {
      serverTime: now.toISOString(),
      entered: !!state.participant?.enteredAt,
      finished: !!state.participant?.finishedAt,
      over,
      lock: lock ? { code: lock, message: LOCK_MESSAGES[lock] } : null,
      participantDeadline: participantDeadline(timing, state.participant)?.toISOString() ?? null,
      current,
      questions: list,
    };
  }

  function lobby(state: State, user: SessionUser | null, now: Date): ContestLobbyDTO {
    const c = state.contest;
    const timing = timingOf(c);
    const p = state.participant;
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      finalEndsAt: contestFinalEnd(timing).toISOString(),
      visibility: c.visibility,
      registrationOpen: c.registrationOpen,
      phase: contestPhase(c, now),
      questionCount: state.items.length,
      serverTime: now.toISOString(),
      isStaff: user ? isContestStaff(user, c) : false,
      canRegister: !!user && !user.isGuest && !p && c.visibility === 'public' && c.registrationOpen && c.status === 'published' && now < c.endsAt,
      participant: p
        ? {
            enteredAt: p.enteredAt?.toISOString() ?? null,
            finishedAt: p.finishedAt?.toISOString() ?? null,
            deadline: participantDeadline(timing, p)?.toISOString() ?? null,
          }
        : null,
      timingMode: c.timingMode,
      durationMinutes: c.durationMinutes,
      defaultQuestionMinutes: c.defaultQuestionMinutes,
      viewOnce: c.viewOnce,
      sequential: c.sequential,
      maxSubmissionsPerQuestion: c.maxSubmissionsPerQuestion,
      maxRunsPerMinute: c.maxRunsPerMinute,
      revealHidden: c.revealHidden,
      verdictDetail: c.verdictDetail,
      scoring: c.scoring,
      penaltyMinutes: c.penaltyMinutes,
      recordIntegrity: c.recordIntegrity,
      leaderboardEnabled: c.leaderboardEnabled && config.FEATURE_LEADERBOARD_UI,
    };
  }

  const notifyChange = (user: SessionUser, contestId: number, reason: string, questionId?: number) =>
    events.publish(user.id, { type: 'contest', contestId, reason, questionId });

  // ------------------------------------------------------------ Joining

  app.get('/api/contests/:id', async (req) => {
    const { id } = parse(contestParams, req.params);
    const state = await visibleState(req.user, id);
    return lobby(state, req.user, req.receivedAt);
  });

  app.post('/api/contests/:id/register', async (req) => {
    const user = requireUser(req);
    const { id } = parse(contestParams, req.params);
    const state = await visibleState(user, id);
    const c = state.contest;
    if (user.isGuest) throw forbidden('guest', 'Guests join with a code.');
    if (c.visibility !== 'public') throw forbidden('invite_only', 'This contest needs a join code.');
    if (!c.registrationOpen) throw forbidden('registration_closed', 'Registration for this contest is closed.');
    if (req.receivedAt >= c.endsAt) throw conflict('contest_ended', 'This contest is no longer open for registration.');
    await db.insert(participants).values({ contestId: id, userId: user.id, joinedAt: req.receivedAt }).onConflictDoNothing();
    return { ok: true };
  });

  /** Join with a code. Signed-out visitors become guests when the contest allows it. */
  const joinKey = (req: FastifyRequest) => `${req.ip}:${req.user?.id ?? String((req.body as { displayName?: unknown } | undefined)?.displayName ?? '').slice(0, 80)}`;
  app.post('/api/contests/join', { config: { rateLimit: { max: 10, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: joinKey } } }, async (req, reply: FastifyReply) => {
    const body = parse(joinSchema, req.body);
    const code = normalizeJoinCode(body.code);
    const [c] = await db.select().from(contests).where(and(eq(contests.joinCode, code), eq(contests.status, 'published')));
    if (!c || c.visibility === 'private') throw badRequest('bad_code', 'That code does not match an open contest.', [{ path: 'code', message: 'Check the code and try again.' }]);
    if (req.receivedAt >= contestFinalEnd(timingOf(c))) throw conflict('contest_ended', 'This contest has ended.');

    let user = req.user;
    if (user?.isGuest && user.guestContestId !== c.id) {
      throw forbidden('guest_other_contest', 'This guest session belongs to another contest. Sign out first.');
    }
    if (user) {
      const [existing] = await db.select({ id: participants.id }).from(participants).where(and(eq(participants.contestId, c.id), eq(participants.userId, user.id)));
      if (!existing) {
        if (!c.registrationOpen) throw forbidden('registration_closed', 'Registration for this contest is closed.');
        await db.insert(participants).values({ contestId: c.id, userId: user.id, joinedAt: req.receivedAt }).onConflictDoNothing();
      }
      return { contestId: c.id };
    }

    if (!c.allowGuests) throw unauthorized('Sign in to join this contest. It does not accept guests.');
    if (!c.registrationOpen) throw forbidden('registration_closed', 'Registration for this contest is closed.');
    if (!body.displayName) throw badRequest('validation_failed', 'Enter your name.', [{ path: 'displayName', message: 'Enter your name.' }]);
    const guest = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ username: `guest-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`, displayName: body.displayName!, role: 'participant', isGuest: true, guestContestId: c.id })
        .returning({ id: users.id });
      await tx.insert(participants).values({ contestId: c.id, userId: u!.id, joinedAt: req.receivedAt });
      return u!;
    });
    // The guest session lasts until a week after the contest's last possible end.
    const ttl = contestFinalEnd(timingOf(c)).getTime() + 7 * 24 * 3600_000 - req.receivedAt.getTime();
    const session = await createSession(db, guest.id, req.receivedAt, ttl);
    reply.setCookie(SESSION_COOKIE, session.token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.COOKIE_SECURE, expires: session.expiresAt });
    return { contestId: c.id };
  });

  // ------------------------------------------------------------ Taking part

  app.post('/api/contests/:id/enter', async (req) => {
    const user = requireUser(req);
    const { id } = parse(contestParams, req.params);
    await visibleState(user, id);
    const result = await db.transaction(async (tx) => {
      const state = await lockedState(tx, user, id);
      const p = state.participant!;
      const decision = canEnter(timingOf(state.contest), p, req.receivedAt);
      if (!decision.ok) throw locked({ reason: decision.reason, deadline: null });
      if (!p.enteredAt) {
        // The server's arrival time starts the clock (personal windows count from here).
        await tx.update(participants).set({ enteredAt: req.receivedAt }).where(eq(participants.id, p.id));
      }
      return true;
    });
    notifyChange(user, id, 'entered');
    const state = await visibleState(user, id);
    return { ok: result, state: await buildState(state, user, req.receivedAt) };
  });

  app.get('/api/contests/:id/state', async (req) => {
    const user = requireUser(req);
    const { id } = parse(contestParams, req.params);
    const state = await visibleState(user, id);
    requireParticipant(state);
    return buildState(state, user, req.receivedAt);
  });

  /**
   * Opening is the only way to see a statement. It records the first view
   * (starting a per-question timer) and, in view-once mode, permanently locks
   * whichever question the participant is leaving.
   */
  app.post('/api/contests/:id/questions/:qid/open', async (req): Promise<ContestQuestionDTO> => {
    const user = requireUser(req);
    const { id, qid } = parse(questionParams, req.params);
    await visibleState(user, id);
    const opened = await db.transaction(async (tx) => {
      const state = await lockedState(tx, user, id);
      const index = state.slots.findIndex((s) => s.questionId === qid);
      if (index < 0) throw notFound('That question is not part of this contest.');
      const timing = timingOf(state.contest);
      const decision = questionAccess({ contest: timing, participant: state.participant, slots: state.slots, questionId: qid, now: req.receivedAt, action: 'open' });
      if (!decision.ok) throw locked(decision);
      const effects = openEffects(timing, state.slots, qid);
      const p = state.participant!;
      if (effects.leave.length) {
        for (const left of effects.leave) {
          await tx
            .update(participantQuestions)
            .set({ leftAt: req.receivedAt })
            .where(and(eq(participantQuestions.participantId, p.id), eq(participantQuestions.questionId, left), sql`${participantQuestions.leftAt} IS NULL`));
        }
      }
      if (effects.firstView) {
        await tx.insert(participantQuestions).values({ participantId: p.id, questionId: qid, firstViewedAt: req.receivedAt }).onConflictDoNothing();
      }
      return { state, index, deadline: decision.deadline, left: effects.leave };
    });
    if (opened.left.length) notifyChange(user, id, 'question_left');
    const [q] = await db.select().from(questions).where(eq(questions.id, qid));
    const item = opened.state.items[opened.index]!;
    const stats = (await userSubmissionStats(id, user.id)).get(qid);
    return {
      ...toWorkspace(q!, allowedLanguages(q!, opened.state.contest.allowedLanguages), await loadDrafts(db, user.id, id, qid), item.points ?? q!.points),
      letter: questionLetter(opened.index),
      deadline: opened.deadline?.toISOString() ?? null,
      maxSubmissions: opened.state.contest.maxSubmissionsPerQuestion,
      submissionsUsed: stats?.manual ?? 0,
    };
  });

  /** View-once: leaving through the app (e.g. back to the overview) locks the question. */
  app.post('/api/contests/:id/questions/:qid/leave', async (req) => {
    const user = requireUser(req);
    const { id, qid } = parse(questionParams, req.params);
    await visibleState(user, id);
    await db.transaction(async (tx) => {
      const state = await lockedState(tx, user, id);
      if (!state.contest.viewOnce) return;
      await tx
        .update(participantQuestions)
        .set({ leftAt: req.receivedAt })
        .where(and(eq(participantQuestions.participantId, state.participant!.id), eq(participantQuestions.questionId, qid), sql`${participantQuestions.leftAt} IS NULL`));
    });
    notifyChange(user, id, 'question_left', qid);
    return { ok: true };
  });

  /** Checks that work on this question is still allowed at the request's arrival time. */
  async function assertWork(req: FastifyRequest, user: SessionUser, contestId: number, qid: number, conn: DB | Tx = db) {
    const state = conn === db ? await visibleState(user, contestId) : await lockedState(conn as Tx, user, contestId);
    requireParticipant(state);
    if (!state.slots.some((s) => s.questionId === qid)) throw notFound('That question is not part of this contest.');
    const decision = questionAccess({ contest: timingOf(state.contest), participant: state.participant, slots: state.slots, questionId: qid, now: req.receivedAt, action: 'work' });
    if (!decision.ok) throw locked(decision);
    return state;
  }

  app.put('/api/contests/:id/questions/:qid/draft', { config: { rateLimit: { max: 240, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    const user = requireUser(req);
    const { id, qid } = parse(questionParams, req.params);
    const body = parse(draftSchema, req.body);
    await assertWork(req, user, id, qid);
    await saveDraft(db, { userId: user.id, contestId: id, questionId: qid, language: body.language, code: body.code, now: req.receivedAt });
    return { savedAt: req.receivedAt.toISOString() };
  });

  app.post('/api/contests/:id/questions/:qid/run', { config: { rateLimit: { max: config.RUN_RATE_PER_MINUTE, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    const user = requireUser(req);
    const { id, qid } = parse(questionParams, req.params);
    const body = parse(solveRunSchema, req.body);
    const state = await assertWork(req, user, id, qid);
    const [q] = await db.select().from(questions).where(eq(questions.id, qid));
    await assertLanguage(runner, allowedLanguages(q!, state.contest.allowedLanguages), body.language);
    if (body.mode === 'samples' && q!.samples.length === 0) throw badRequest('no_samples', 'This question has no examples. Run it with custom input instead.');
    if (state.contest.maxRunsPerMinute) {
      const since = new Date(req.receivedAt.getTime() - 60_000);
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(runs)
        .where(and(eq(runs.userId, user.id), eq(runs.contestId, id), gt(runs.createdAt, since)));
      if ((row?.n ?? 0) >= state.contest.maxRunsPerMinute) {
        throw tooMany('run_limit', `This contest allows ${state.contest.maxRunsPerMinute} runs per minute. Wait a moment and run again.`);
      }
    }
    const [run] = await db
      .insert(runs)
      .values({ userId: user.id, contestId: id, questionId: qid, kind: body.mode, language: body.language, code: body.code, input: body.mode === 'custom' ? body.input : null, createdAt: req.receivedAt })
      .returning({ id: runs.id, status: runs.status });
    worker.notify();
    return run;
  });

  /** The arrival time decides: a submission that reached the server before the deadline counts. */
  app.post('/api/contests/:id/questions/:qid/submit', { config: { rateLimit: { max: config.SUBMIT_RATE_PER_MINUTE, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    const user = requireUser(req);
    const { id, qid } = parse(questionParams, req.params);
    const body = parse(submitSchema, req.body);
    const key = parse(idempotencyKeySchema, req.headers['idempotency-key']);
    await visibleState(user, id);
    const created = await db.transaction(async (tx) => {
      const state = await assertWork(req, user, id, qid, tx);
      const [q] = await tx.select().from(questions).where(eq(questions.id, qid));
      await assertLanguage(runner, allowedLanguages(q!, state.contest.allowedLanguages), body.language);
      if (key) {
        const [dup] = await tx.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.userId, user.id), eq(submissions.idempotencyKey, key)));
        if (dup) return { id: dup.id, duplicate: true };
      }
      const max = state.contest.maxSubmissionsPerQuestion;
      if (max) {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(submissions)
          .where(and(eq(submissions.userId, user.id), eq(submissions.contestId, id), eq(submissions.questionId, qid), eq(submissions.isAuto, false)));
        if ((row?.n ?? 0) >= max) throw tooMany('submission_limit', `You have used all ${max} submissions for this question.`);
      }
      const sub = await createSubmission(tx, { userId: user.id, contestId: id, questionId: qid, language: body.language, code: body.code, receivedAt: req.receivedAt, idempotencyKey: key ?? null });
      await saveDraft(tx, { userId: user.id, contestId: id, questionId: qid, language: body.language, code: body.code, now: req.receivedAt });
      return sub;
    });
    worker.notify();
    return created;
  });

  app.get('/api/contests/:id/questions/:qid/submissions', async (req) => {
    const user = requireUser(req);
    const { id, qid } = parse(questionParams, req.params);
    const state = await visibleState(user, id);
    requireParticipant(state);
    const rows = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.userId, user.id), eq(submissions.contestId, id), eq(submissions.questionId, qid)))
      .orderBy(desc(submissions.id))
      .limit(100);
    const visibility = rows[0] ? await visibilityFor(db, user, rows[0], req.receivedAt) : null;
    return {
      submissions: await Promise.all(rows.map(async (s) => toSubmissionDTO(s, { ...visibility!, includeCode: false }, await queuePosition(db, s)))),
    };
  });

  app.post('/api/contests/:id/finish', async (req) => {
    const user = requireUser(req);
    const { id } = parse(contestParams, req.params);
    await visibleState(user, id);
    await db.transaction(async (tx) => {
      const state = await lockedState(tx, user, id);
      const p = state.participant!;
      if (!p.enteredAt) throw conflict('not_entered', LOCK_MESSAGES.not_entered);
      if (!p.finishedAt) await tx.update(participants).set({ finishedAt: req.receivedAt }).where(eq(participants.id, p.id));
    });
    notifyChange(user, id, 'finished');
    return { ok: true };
  });

  /** Tab switches and pastes, recorded for organizers when the contest enables it. */
  app.post('/api/contests/:id/integrity', { config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    const user = requireUser(req);
    const { id } = parse(contestParams, req.params);
    const { events: batch } = parse(integrityBatchSchema, req.body);
    const state = await visibleState(user, id);
    requireParticipant(state);
    if (!state.contest.recordIntegrity) return { recorded: 0 };
    const known = new Set(state.slots.map((s) => s.questionId));
    await db.insert(integrityEvents).values(
      batch.map((e) => ({
        contestId: id,
        userId: user.id,
        questionId: e.questionId && known.has(e.questionId) ? e.questionId : null,
        type: e.type,
        detail: e.chars != null ? { chars: e.chars } : {},
        clientTime: new Date(e.at),
        createdAt: req.receivedAt,
      })),
    );
    return { recorded: batch.length };
  });

  /** Optional leaderboard (off by default); frozen for participants near the end. */
  app.get('/api/contests/:id/leaderboard', async (req): Promise<LeaderboardDTO> => {
    const user = requireUser(req);
    const { id } = parse(contestParams, req.params);
    const state = await visibleState(user, id);
    const staff = isContestStaff(user, state.contest);
    if (!state.contest.leaderboardEnabled) throw notFound('This contest has no leaderboard.');
    if (!staff) requireParticipant(state);
    const frozenAt = staff ? null : activeFreeze(state.contest, req.receivedAt);
    const rows = await computeStandings(db, state.contest, frozenAt);
    const items = await db
      .select({ questionId: contestQuestions.questionId, title: questions.title })
      .from(contestQuestions)
      .innerJoin(questions, eq(questions.id, contestQuestions.questionId))
      .where(eq(contestQuestions.contestId, id))
      .orderBy(asc(contestQuestions.position));
    return {
      frozenAt: frozenAt?.toISOString() ?? null,
      questions: items.map((q, i) => ({ questionId: q.questionId, letter: questionLetter(i), title: q.title })),
      rows,
    };
  });
}
