import { eq } from 'drizzle-orm';
import pino, { type Logger } from 'pino';
import type { Config } from './config';
import type { Clock } from './clock';
import type { DB } from './db';
import { users } from './db/schema';
import { hashPassword } from './auth/password';
import { EventBus } from './events';
import { ExecutionPool } from './jobs/pool';
import { JobWorker } from './jobs/worker';
import type { Runner } from './runner/types';
import type { PistonSetup } from './runner/setup';
import type { Services } from './app';
import { ExpiryScheduler } from './services/scheduler';

export function createLogger(config: Config): Logger {
  if (config.NODE_ENV === 'test') return pino({ level: 'silent' });
  if (config.NODE_ENV === 'development') {
    return pino({ level: config.LOG_LEVEL, transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } });
  }
  return pino({ level: config.LOG_LEVEL });
}

export function createServices(opts: {
  config: Config;
  db: DB;
  runner: Runner;
  clock: Clock;
  log: Logger;
  setup?: PistonSetup | null;
}): Services {
  const events = new EventBus();
  const pool = new ExecutionPool(opts.config.RUNNER_CONCURRENCY);
  const worker = new JobWorker(
    { db: opts.db, runner: opts.runner, pool, clock: opts.clock, events, log: opts.log },
    Math.max(2, opts.config.RUNNER_CONCURRENCY),
  );
  const scheduler = new ExpiryScheduler({ db: opts.db, clock: opts.clock, events, worker, log: opts.log });
  return { ...opts, setup: opts.setup ?? null, events, pool, worker, scheduler };
}

/** Creates the first admin account from the environment when none exists. */
export async function ensureAdmin(db: DB, config: Config, log: Logger) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (existing) return false;
  await db.insert(users).values({
    username: config.ADMIN_USERNAME,
    email: config.ADMIN_EMAIL.toLowerCase(),
    displayName: 'Administrator',
    passwordHash: await hashPassword(config.ADMIN_PASSWORD),
    role: 'admin',
  });
  log.warn({ username: config.ADMIN_USERNAME }, 'created admin account from ADMIN_USERNAME / ADMIN_PASSWORD; change the password after signing in');
  return true;
}
