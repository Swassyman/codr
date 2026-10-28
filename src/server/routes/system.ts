import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { LANGUAGES } from '../../shared/languages';
import { requireRole, requireUser } from '../auth/guards';

export async function systemRoutes(app: FastifyInstance) {
  const { db, runner, clock, events, pool, setup } = app.services;

  app.get('/api/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true, serverTime: clock.now().toISOString() };
  });

  /** Languages the runner can execute right now. */
  app.get('/api/runtimes', async (req) => {
    requireUser(req);
    try {
      const runtimes = await runner.runtimes();
      return {
        reachable: true,
        languages: runtimes.map((rt) => ({ id: rt.language, label: LANGUAGES[rt.language].label, version: rt.version })),
      };
    } catch {
      return { reachable: false, languages: [] };
    }
  });

  app.get('/api/admin/runner', async (req) => {
    requireRole(req, 'admin');
    let runtimes: Awaited<ReturnType<typeof runner.runtimes>> = [];
    let reachable = true;
    let error: string | null = null;
    try {
      runtimes = await runner.runtimes();
    } catch (err) {
      reachable = false;
      error = (err as Error).message;
    }
    const queue = await db.execute<{ runs: number; submissions: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM runs WHERE status IN ('queued', 'running')) AS runs,
        (SELECT count(*)::int FROM submissions WHERE status IN ('queued', 'running')) AS submissions`);
    return {
      engine: runner.engine,
      reachable,
      error,
      runtimes,
      setup: setup?.status ?? null,
      queue: queue.rows[0],
      pool: pool.stats,
    };
  });

  /**
   * Server-sent events: job status updates and periodic server time so the
   * client clock can resync. Browsers reconnect automatically.
   */
  app.get('/api/events', async (req, reply) => {
    const user = requireUser(req);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    res.write('retry: 2000\n\n');
    send('time', { serverTime: clock.now().toISOString() });
    const unsubscribe = events.subscribe(user.id, (event) => send(event.type, { ...event, serverTime: clock.now().toISOString() }));
    const ticker = setInterval(() => send('time', { serverTime: clock.now().toISOString() }), 10_000);
    req.raw.on('close', () => {
      clearInterval(ticker);
      unsubscribe();
    });
  });
}
