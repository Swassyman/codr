import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { contestFinalEnd, type ContestTiming } from '../../shared/timing';
import type { DbOrTx } from '../db';
import { contestQuestions, contests, participants, questions, type Question } from '../db/schema';

// Which questions the practice bank shows. Decided at query time from the
// contests' schedules, so nothing changes in the database when a contest ends
// and there is no scheduler to depend on.
//
// A published question that is not hidden from practice is listed when no
// published contest containing it is unfinished, and either it is marked for
// practice or at least one published contest containing it has finished.
// Draft contests count for neither: they cannot be taken, so they neither hide
// a question nor make it practice material.
//
// "Finished" is the moment nobody can work any more (contestFinalEnd): the end
// in fixed-window and per-question modes, the entry cutoff plus the window in
// personal-window mode. Participants who finish early do not end the contest.

export interface PracticeContestRef extends Pick<ContestTiming, 'endsAt' | 'timingMode' | 'durationMinutes'> {
  status: 'draft' | 'published';
}

/** The rule as a pure function; `practiceVisibleSql` is the same rule for queries. */
export function isPracticeVisible(
  q: Pick<Question, 'status' | 'practice' | 'practiceHidden'>,
  containing: PracticeContestRef[],
  now: Date,
): boolean {
  if (q.status !== 'published' || q.practiceHidden) return false;
  const published = containing.filter((c) => c.status === 'published');
  const finished = (c: PracticeContestRef) => contestFinalEnd(c).getTime() <= now.getTime();
  if (published.some((c) => !finished(c))) return false;
  return q.practice || published.length > 0;
}

/** SQL twin of contestFinalEnd for the contests table. */
const finalEnd = sql`(CASE WHEN ${contests.timingMode} = 'personal_window'
  THEN ${contests.endsAt} + make_interval(mins => coalesce(${contests.durationMinutes}, 0))
  ELSE ${contests.endsAt} END)`;

const publishedContaining = sql`SELECT 1 FROM ${contestQuestions} JOIN ${contests} ON ${contests.id} = ${contestQuestions.contestId}
  WHERE ${contestQuestions.questionId} = ${questions.id} AND ${contests.status} = 'published'`;

export const practiceVisibleSql = (now: Date) => sql`(
  ${questions.status} = 'published' AND ${questions.practiceHidden} = false
  AND NOT EXISTS (${publishedContaining} AND ${finalEnd} > ${now})
  AND (${questions.practice} = true OR EXISTS (${publishedContaining} AND ${finalEnd} <= ${now}))
)`;

/**
 * Finished contests each question came from, newest first, for the "from"
 * tag. Only contests the user may know about: public ones and ones they joined.
 */
export async function fromContests(db: DbOrTx, questionIds: number[], userId: number, now: Date) {
  const byQuestion = new Map<number, { id: number; name: string }[]>();
  if (questionIds.length === 0) return byQuestion;
  const rows = await db
    .select({ questionId: contestQuestions.questionId, id: contests.id, name: contests.name })
    .from(contestQuestions)
    .innerJoin(contests, eq(contests.id, contestQuestions.contestId))
    .where(
      and(
        inArray(contestQuestions.questionId, questionIds),
        eq(contests.status, 'published'),
        sql`${finalEnd} <= ${now}`,
        or(
          eq(contests.visibility, 'public'),
          sql`EXISTS (SELECT 1 FROM ${participants} WHERE ${participants.contestId} = ${contests.id} AND ${participants.userId} = ${userId})`,
        ),
      ),
    )
    .orderBy(desc(contests.endsAt));
  for (const r of rows) {
    const list = byQuestion.get(r.questionId) ?? [];
    list.push({ id: r.id, name: r.name });
    byQuestion.set(r.questionId, list);
  }
  return byQuestion;
}
