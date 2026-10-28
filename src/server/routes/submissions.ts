import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { contests, submissions } from '../db/schema';
import { idParam, notFound, parse } from '../lib/errors';
import { requireUser } from '../auth/guards';
import { queuePosition, toSubmissionDTO } from '../services/submissions';
import { isContestStaff, visibilityFor } from '../services/contest-state';

export async function submissionRoutes(app: FastifyInstance) {
  const { db } = app.services;

  /** One submission, for its author or the contest's staff, with reveal rules applied. */
  app.get('/api/submissions/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const [sub] = await db.select().from(submissions).where(eq(submissions.id, id));
    if (!sub) throw notFound('Submission not found.');
    if (sub.userId !== user.id) {
      const [contest] = sub.contestId != null ? await db.select().from(contests).where(eq(contests.id, sub.contestId)) : [];
      const staffOfContest = contest ? isContestStaff(user, contest) : user.role === 'admin';
      if (!staffOfContest) throw notFound('Submission not found.');
    }
    return toSubmissionDTO(sub, await visibilityFor(db, user, sub, req.receivedAt), await queuePosition(db, sub));
  });
}
