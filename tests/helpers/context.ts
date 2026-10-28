import pg from 'pg';
import pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/server/config';
import { FakeClock, type Clock } from '../../src/server/clock';
import { createDb, runMigrations, type DB } from '../../src/server/db';
import { buildApp, type Services } from '../../src/server/app';
import { createServices } from '../../src/server/bootstrap';
import { hashPassword } from '../../src/server/auth/password';
import { users } from '../../src/server/db/schema';
import type { Role } from '../../src/shared/types';
import type { Runner } from '../../src/server/runner/types';
import { FakeRunner } from './fake-runner';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://codr:codr@localhost:55432/codr_test';

async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await client.end();
  }
}

export interface TestContext {
  app: FastifyInstance;
  services: Services;
  db: DB;
  clock: FakeClock;
  runner: Runner;
  close(): Promise<void>;
}

/** Fresh schema, real Postgres, in-process app. Each test file gets its own. */
export async function createTestContext(opts: { runner?: Runner; clock?: FakeClock } = {}): Promise<TestContext> {
  await ensureDatabase(TEST_DATABASE_URL);
  const { db, pool } = createDb(TEST_DATABASE_URL);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await runMigrations(db);
  const clock = opts.clock ?? new FakeClock('2030-01-15T10:00:00Z');
  const runner = opts.runner ?? new FakeRunner();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    RUNNER_CONCURRENCY: '4',
    SUBMIT_RATE_PER_MINUTE: '1000',
    RUN_RATE_PER_MINUTE: '1000',
    LOGIN_RATE_PER_MINUTE: '1000',
  });
  const services = createServices({ config, db, runner, clock: clock as Clock, log: pino({ level: 'silent' }) });
  const app = await buildApp(services);
  await app.ready();
  return {
    app,
    services,
    db,
    clock,
    runner,
    async close() {
      await app.close();
      await services.worker.stop();
      await pool.end();
    },
  };
}

let cachedHash: Promise<string> | null = null;

/** Inserts a user directly (password "password123"). */
export async function createUser(db: DB, username: string, role: Role = 'participant') {
  cachedHash ??= hashPassword('password123');
  const [user] = await db
    .insert(users)
    .values({ username, displayName: username, role, passwordHash: await cachedHash, email: `${username}@example.test` })
    .returning();
  return user!;
}

interface Response<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

/** Minimal browser stand-in: keeps cookies and sends the CSRF header. */
export class TestClient {
  cookies: Record<string, string> = {};

  constructor(private readonly app: FastifyInstance) {}

  async request<T = any>(method: string, url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Response<T>> {
    if (!this.cookies.codr_csrf && method !== 'GET') await this.request('GET', '/api/auth/me');
    const cookie = Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      payload: payload as never,
      headers: { cookie, 'x-csrf-token': this.cookies.codr_csrf ?? '', ...headers },
    });
    for (const c of res.cookies as { name: string; value: string; expires?: Date }[]) {
      if (!c.value || (c.expires && c.expires.getTime() < Date.now())) delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    let body: unknown = null;
    try {
      body = res.json();
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body: body as T, headers: res.headers };
  }

  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, payload: unknown = {}, headers?: Record<string, string>) {
    return this.request<T>('POST', url, payload, headers);
  }
  put<T = any>(url: string, payload: unknown = {}) {
    return this.request<T>('PUT', url, payload);
  }
  patch<T = any>(url: string, payload: unknown = {}) {
    return this.request<T>('PATCH', url, payload);
  }
  del<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }

  async login(username: string, password = 'password123') {
    const res = await this.post('/api/auth/login', { login: username, password });
    if (res.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(res.body)}`);
    return res.body.user;
  }
}
