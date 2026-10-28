import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { contestFinalEnd, contestPhase } from '../../shared/timing';
import type { ContestSummaryDTO } from '../../shared/api';
import { contestQuestions, contests, participants } from '../db/schema';

export async function contestRoutes(app: FastifyInstance) {
  const { db, clock } = app.services;

  /** Contests shown on the landing page: public ones plus any the user has joined. */
  app.get('/api/contests', async (req): Promise<{ contests: ContestSummaryDTO[] }> => {
    const user = req.user;
    const now = clock.now();
    const joinedIds = user
      ? (await db.select({ id: participants.contestId }).from(participants).where(eq(participants.userId, user.id))).map((r) => r.id)
      : [];
    if (user?.isGuest) {
      // Guests only ever see the contest they joined.
      joinedIds.splice(0, joinedIds.length, ...(user.guestContestId ? [user.guestContestId] : []));
    }
    const visible = user?.isGuest
      ? inArray(contests.id, joinedIds.length ? joinedIds : [-1])
      : or(eq(contests.visibility, 'public'), joinedIds.length ? inArray(contests.id, joinedIds) : sql`false`);
    const rows = await db
      .select({
        contest: contests,
        questionCount: sql<number>`(select count(*)::int from ${contestQuestions} where ${contestQuestions.contestId} = ${contests.id})`,
      })
      .from(contests)
      .where(and(eq(contests.status, 'published'), visible))
      .orderBy(asc(contests.startsAt));
    const mine = user
      ? await db.select().from(participants).where(eq(participants.userId, user.id))
      : [];
    const byContest = new Map(mine.map((p) => [p.contestId, p]));
    return {
      contests: rows.map(({ contest: c, questionCount }) => {
        const p = byContest.get(c.id);
        return {
          id: c.id,
          name: c.name,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
          finalEndsAt: contestFinalEnd(c).toISOString(),
          timingMode: c.timingMode,
          durationMinutes: c.durationMinutes,
          defaultQuestionMinutes: c.defaultQuestionMinutes,
          viewOnce: c.viewOnce,
          sequential: c.sequential,
          visibility: c.visibility,
          phase: contestPhase(c, now),
          questionCount,
          registered: !!p,
          enteredAt: p?.enteredAt?.toISOString() ?? null,
          finishedAt: p?.finishedAt?.toISOString() ?? null,
        };
      }),
    };
  });
}
