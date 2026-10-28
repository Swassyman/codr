import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import pino from 'pino';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { needsSeed, queueSeedValidation, seedDemo } from '../../src/server/seed';
import { SEED_QUESTIONS } from '../../src/server/seed/data';
import { contests, questions, testCases } from '../../src/server/db/schema';
import { createServices } from '../../src/server/bootstrap';
import { loadConfig } from '../../src/server/config';
import { PistonRunner } from '../../src/server/runner/piston';

let ctx: TestContext;
let adminId: number;

beforeAll(async () => {
  ctx = await createTestContext();
  adminId = (await createUser(ctx.db, 'seedadmin', 'admin')).id;
});

afterAll(async () => {
  await ctx.close();
});

describe('demo seed', () => {
  it('creates five published practice questions and one contest per timing mode, once', async () => {
    expect(await needsSeed(ctx.db)).toBe(true);
    await seedDemo(ctx.db, adminId, ctx.clock.now());
    await seedDemo(ctx.db, adminId, ctx.clock.now());
    const qs = await ctx.db.select().from(questions);
    expect(qs).toHaveLength(5);
    expect(qs.every((q) => q.status === 'published' && q.practice && q.referenceSolution)).toBe(true);
    for (const q of qs) {
      const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(testCases).where(eq(testCases.questionId, q.id));
      expect(row!.n).toBeGreaterThanOrEqual(5);
    }
    const cs = await ctx.db.select().from(contests);
    expect(cs.map((c) => c.timingMode).sort()).toEqual(['fixed_window', 'per_question', 'personal_window']);
    expect(cs.every((c) => c.status === 'published' && c.endsAt > ctx.clock.now())).toBe(true);
    expect(await needsSeed(ctx.db)).toBe(false);
  });

  it('leaves practice questions available while the demo contests run', async () => {
    const player = await createUser(ctx.db, 'player');
    const client = new TestClient(ctx.app);
    await client.login(player.username);
    const slugs = (await client.get('/api/practice/questions')).body.questions.map((q: { slug: string }) => q.slug).sort();
    expect(slugs).toEqual(['making-change', 'shortest-delivery-route']);
  });

  it('produces expected outputs that match the samples', () => {
    for (const q of SEED_QUESTIONS) {
      for (const s of q.samples) {
        if (q.checker.type === 'float') expect(Math.abs(Number(q.solve(s.input)) - Number(s.output))).toBeLessThan(1e-6);
        else expect(q.solve(s.input)).toBe(s.output);
      }
    }
  });
});

const RUNNER_URL = process.env.RUNNER_URL ?? 'http://localhost:2000';
const live = await fetch(`${RUNNER_URL}/api/v2/runtimes`, { signal: AbortSignal.timeout(1500) })
  .then(async (r) => r.ok && ((await r.json()) as { language: string }[]).some((rt) => rt.language === 'python'))
  .catch(() => false);

describe.runIf(live)('seed questions on the real runner', () => {
  it('validate: every Python reference solution passes every case', async () => {
    const config = loadConfig({ NODE_ENV: 'test', RUNNER_CONCURRENCY: '4' });
    const services = createServices({ config, db: ctx.db, runner: new PistonRunner(RUNNER_URL), clock: ctx.clock, log: pino({ level: 'silent' }) });
    expect(await queueSeedValidation(ctx.db, adminId, ctx.clock.now())).toBe(5);
    await services.worker.drain(240_000);
    const qs = await ctx.db.select({ slug: questions.slug, validation: questions.validation }).from(questions);
    for (const q of qs) {
      const failed = q.validation?.cases.filter((c) => c.verdict !== 'AC') ?? [];
      expect({ slug: q.slug, ok: q.validation?.ok, failed }).toEqual({ slug: q.slug, ok: true, failed: [] });
    }
    await services.worker.stop();
  }, 300_000);
});
