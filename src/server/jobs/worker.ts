import { eq, sql } from 'drizzle-orm';
import { runs, submissions } from '../db/schema';
import type { JobContext } from './context';
import { judgeSubmission } from './judge';
import { processRun } from './runs';

/**
 * Claims queued jobs from Postgres (FOR UPDATE SKIP LOCKED) and processes them
 * in the background. Runs are claimed before submissions because someone is
 * usually waiting on them interactively.
 */
export class JobWorker {
  private active = 0;
  private claiming = false;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly ctx: JobContext,
    private readonly maxJobs: number,
  ) {}

  /** Jobs left "running" by a crash are put back in the queue. Single web process assumed. */
  async recover() {
    await this.ctx.db.execute(sql`UPDATE runs SET status = 'queued', started_at = NULL WHERE status = 'running'`);
    await this.ctx.db.execute(sql`UPDATE submissions SET status = 'queued', started_at = NULL WHERE status = 'running'`);
  }

  start(intervalMs = 1000) {
    this.stopped = false;
    this.timer = setInterval(() => void this.kick(), intervalMs);
    void this.kick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.inFlight]);
  }

  /** Stop claiming new jobs (in-flight jobs finish). */
  pause() {
    this.stopped = true;
  }

  resume() {
    this.stopped = false;
    void this.kick();
  }

  /** Wake the worker right away (called after a job is enqueued). */
  notify() {
    void this.kick();
  }

  private async claimRun() {
    const now = this.ctx.clock.now();
    const res = await this.ctx.db.execute<{ id: number }>(sql`
      UPDATE runs SET status = 'running', started_at = ${now}
      WHERE id = (SELECT id FROM runs WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    const id = res.rows[0]?.id;
    if (id == null) return null;
    const [run] = await this.ctx.db.select().from(runs).where(eq(runs.id, id));
    return run ?? null;
  }

  private async claimSubmission() {
    const now = this.ctx.clock.now();
    const res = await this.ctx.db.execute<{ id: number }>(sql`
      UPDATE submissions SET status = 'running', started_at = ${now}
      WHERE id = (SELECT id FROM submissions WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    const id = res.rows[0]?.id;
    if (id == null) return null;
    const [sub] = await this.ctx.db.select().from(submissions).where(eq(submissions.id, id));
    return sub ?? null;
  }

  private track(job: Promise<void>) {
    this.active++;
    const tracked = job
      .catch((err) => this.ctx.log.error({ err }, 'job failed'))
      .finally(() => {
        this.active--;
        this.inFlight.delete(tracked);
        if (!this.stopped) void this.kick();
      });
    this.inFlight.add(tracked);
  }

  async kick() {
    if (this.claiming || this.stopped) return;
    this.claiming = true;
    try {
      while (this.active < this.maxJobs && !this.stopped) {
        const run = await this.claimRun();
        if (run) {
          this.track(processRun(this.ctx, run));
          continue;
        }
        const sub = await this.claimSubmission();
        if (sub) {
          this.track(judgeSubmission(this.ctx, sub));
          continue;
        }
        break;
      }
    } catch (err) {
      this.ctx.log.error({ err }, 'job claim failed');
    } finally {
      this.claiming = false;
    }
  }

  /** Test helper: process until the queue is empty and nothing is in flight. */
  async drain(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.kick();
      await Promise.allSettled([...this.inFlight]);
      const res = await this.ctx.db.execute<{ n: number }>(sql`
        SELECT ((SELECT count(*) FROM runs WHERE status IN ('queued', 'running'))
              + (SELECT count(*) FROM submissions WHERE status IN ('queued', 'running')))::int AS n`);
      if ((res.rows[0]?.n ?? 0) === 0 && this.active === 0) return;
      if (Date.now() > deadline) throw new Error('drain timed out');
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}
