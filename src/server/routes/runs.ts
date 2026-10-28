import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { scratchRunSchema } from '../../shared/schemas';
import { runs } from '../db/schema';
import { idParam, notFound, parse } from '../lib/errors';
import { requireStaff, requireUser } from '../auth/guards';

export async function runRoutes(app: FastifyInstance) {
  const { db, worker } = app.services;

  /** Staff scratch run (runner check, trying out a reference solution). */
  app.post(
    '/api/runs',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireStaff(req);
      const body = parse(scratchRunSchema, req.body);
      const [run] = await db
        .insert(runs)
        .values({ userId: user.id, kind: 'custom', language: body.language, code: body.code, input: body.input, createdAt: req.receivedAt })
        .returning({ id: runs.id, status: runs.status });
      worker.notify();
      return run;
    },
  );

  app.get('/api/runs/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(idParam, req.params);
    const [run] = await db
      .select({
        id: runs.id,
        kind: runs.kind,
        language: runs.language,
        status: runs.status,
        results: runs.results,
        error: runs.error,
        createdAt: runs.createdAt,
        finishedAt: runs.finishedAt,
      })
      .from(runs)
      .where(and(eq(runs.id, id), eq(runs.userId, user.id)));
    if (!run) throw notFound('Run not found.');
    let queuePosition: number | null = null;
    if (run.status === 'queued') {
      const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM runs WHERE status = 'queued' AND id < ${id}`);
      queuePosition = (res.rows[0]?.n ?? 0) + 1;
    }
    return { ...run, queuePosition };
  });
}
