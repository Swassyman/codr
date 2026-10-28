import { and, asc, eq } from 'drizzle-orm';
import type { ContestTiming, QuestionSlot } from '../../shared/timing';
import { participationOver } from '../../shared/timing';
import type { SessionUser } from '../auth/sessions';
import type { DbOrTx } from '../db';
import { contestQuestions, contests, participantQuestions, participants, type Contest, type Submission } from '../db/schema';
import { FULL_VISIBILITY, type Visibility } from './submissions';

export function timingOf(c: Contest): ContestTiming {
  return {
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    timingMode: c.timingMode,
    durationMinutes: c.durationMinutes,
    defaultQuestionMinutes: c.defaultQuestionMinutes,
    viewOnce: c.viewOnce,
    sequential: c.sequential,
  };
}

/** The contest, this user's participation, and per-question view state, in contest order. */
export async function loadContestState(db: DbOrTx, contestId: number, userId: number) {
  const [contest] = await db.select().from(contests).where(eq(contests.id, contestId));
  if (!contest) return null;
  const [participant] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.contestId, contestId), eq(participants.userId, userId)));
  const items = await db.select().from(contestQuestions).where(eq(contestQuestions.contestId, contestId)).orderBy(asc(contestQuestions.position));
  const views = participant ? await db.select().from(participantQuestions).where(eq(participantQuestions.participantId, participant.id)) : [];
  const byQuestion = new Map(views.map((v) => [v.questionId, v]));
  const slots: QuestionSlot[] = items.map((cq, position) => ({
    questionId: cq.questionId,
    position,
    durationMinutes: cq.durationMinutes,
    firstViewedAt: byQuestion.get(cq.questionId)?.firstViewedAt ?? null,
    leftAt: byQuestion.get(cq.questionId)?.leftAt ?? null,
  }));
  return { contest, participant: participant ?? null, items, slots, views };
}

export const isContestStaff = (user: SessionUser, contest: Pick<Contest, 'createdBy'>) => user.role === 'admin' || contest.createdBy === user.id;

/** How much of a submission its owner may see right now. */
export async function visibilityFor(db: DbOrTx, user: SessionUser, sub: Submission, now: Date): Promise<Visibility> {
  if (sub.contestId == null) return FULL_VISIBILITY;
  const state = await loadContestState(db, sub.contestId, sub.userId);
  if (!state) return FULL_VISIBILITY;
  if (isContestStaff(user, state.contest)) return FULL_VISIBILITY;
  const revealHidden =
    state.contest.revealHidden === 'during' ||
    participationOver(timingOf(state.contest), state.participant, state.slots, now);
  return { detail: state.contest.verdictDetail, revealHidden, includeCode: true };
}
