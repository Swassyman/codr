import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { PistonRunner } from '../../src/server/runner/piston';
import { LANGUAGES } from '../../src/shared/languages';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
  await createUser(ctx.db, 'staff', 'creator');
  await createUser(ctx.db, 'alice');
  await createUser(ctx.db, 'root', 'admin');
});

afterAll(async () => {
  await ctx.close();
});

describe('auth', () => {
  it('registers, reports the session and logs out', async () => {
    const c = new TestClient(ctx.app);
    const reg = await c.post('/api/auth/register', { username: 'newbie', displayName: 'New Bie', password: 'longenough' });
    expect(reg.status).toBe(200);
    expect(reg.body.user).toMatchObject({ username: 'newbie', role: 'participant' });
    expect(c.cookies.codr_session).toBeTruthy();

    const me = await c.get('/api/auth/me');
    expect(me.body.user.username).toBe('newbie');

    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).body.user).toBeNull();
  });

  it('rejects duplicate usernames regardless of case', async () => {
    const c = new TestClient(ctx.app);
    const res = await c.post('/api/auth/register', { username: 'ALICE', displayName: 'x', password: 'longenough' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('username_taken');
  });

  it('validates registration input', async () => {
    const res = await new TestClient(ctx.app).post('/api/auth/register', { username: 'a', displayName: '', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['username', 'displayName', 'password']));
  });

  it('rejects a wrong password without saying which part was wrong', async () => {
    const res = await new TestClient(ctx.app).post('/api/auth/login', { login: 'alice', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).not.toMatch(/username.*not found/i);
  });

  it('sets the session cookie httpOnly', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    const csrf = res.cookies.find((c) => c.name === 'codr_csrf')!;
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'alice', password: 'password123' },
      headers: { cookie: `codr_csrf=${csrf.value}`, 'x-csrf-token': csrf.value },
    });
    const session = login.cookies.find((c) => c.name === 'codr_session')!;
    expect(session.httpOnly).toBe(true);
    expect(session.sameSite?.toLowerCase()).toBe('lax');
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without the token header', async () => {
    const c = new TestClient(ctx.app);
    await c.get('/api/auth/me');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'alice', password: 'password123' },
      headers: { cookie: `codr_csrf=${c.cookies.codr_csrf}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf_failed');
  });

  it('rejects cross-origin requests even with a token', async () => {
    const c = new TestClient(ctx.app);
    const res = await c.post('/api/auth/login', { login: 'alice', password: 'password123' }, { origin: 'http://evil.example', host: 'codr.local' });
    expect(res.status).toBe(403);
  });
});

describe('server time', () => {
  it('stamps every response with the server clock', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(Number(res.headers['x-server-time'])).toBe(ctx.clock.now().getTime());
  });
});

describe('scratch runs', () => {
  it('is limited to staff', async () => {
    const c = new TestClient(ctx.app);
    await c.login('alice');
    const res = await c.post('/api/runs', { language: 'python', code: 'fake:sum', input: '1 2' });
    expect(res.status).toBe(403);
  });

  it('queues a run, executes it on the runner and returns the output', async () => {
    const c = new TestClient(ctx.app);
    await c.login('staff');
    ctx.services.worker.pause();
    const created = await c.post('/api/runs', { language: 'python', code: '# fake:sum', input: '40 2' });
    expect(created.status).toBe(200);
    expect(created.body.status).toBe('queued');

    const queued = await c.get(`/api/runs/${created.body.id}`);
    expect(queued.body.queuePosition).toBe(1);

    ctx.services.worker.resume();
    await ctx.services.worker.drain();
    const done = await c.get(`/api/runs/${created.body.id}`);
    expect(done.body.status).toBe('done');
    expect(done.body.results[0].execution.stdout).toBe('42\n');
    expect(done.body.results[0].execution.status).toBe('ok');

    // Another user cannot read it.
    const other = new TestClient(ctx.app);
    await other.login('root');
    expect((await other.get(`/api/runs/${created.body.id}`)).status).toBe(404);
  });

  it('reports compile errors', async () => {
    const c = new TestClient(ctx.app);
    await c.login('staff');
    const created = await c.post('/api/runs', { language: 'cpp', code: '// fake:ce', input: '' });
    await ctx.services.worker.drain();
    const done = await c.get(`/api/runs/${created.body.id}`);
    expect(done.body.results[0].verdict).toBe('CE');
    expect(done.body.results[0].execution.compileOutput).toContain('error');
  });
});

describe('admin runner status', () => {
  it('requires an admin', async () => {
    const c = new TestClient(ctx.app);
    await c.login('staff');
    expect((await c.get('/api/admin/runner')).status).toBe(403);
    const admin = new TestClient(ctx.app);
    await admin.login('root');
    const res = await admin.get('/api/admin/runner');
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('fake');
  });
});

// Talks to a real Piston instance when one is reachable (docker-compose.dev.yml).
const RUNNER_URL = process.env.RUNNER_URL ?? 'http://localhost:2000';
const live = await fetch(`${RUNNER_URL}/api/v2/runtimes`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);

describe.runIf(live)('live Piston runner', () => {
  const runner = new PistonRunner(RUNNER_URL);

  it('runs a program with stdin', async () => {
    const res = await runner.execute({ language: 'python', source: LANGUAGES.python.hello, stdin: 'codr\n', timeLimitMs: 2000, memoryLimitMb: 128 });
    expect(res.status).toBe('ok');
    expect(res.stdout.trim()).toBe('hello codr');
  });

  it('enforces the time limit', async () => {
    const res = await runner.execute({ language: 'python', source: 'while True: pass', stdin: '', timeLimitMs: 500, memoryLimitMb: 128 });
    expect(res.status).toBe('time_limit');
  });

  it('enforces the memory limit', async () => {
    const res = await runner.execute({ language: 'python', source: 'a=[]\nwhile True: a.append(bytearray(1<<20))', stdin: '', timeLimitMs: 2000, memoryLimitMb: 64 });
    expect(res.status).toBe('memory_limit');
  });

  it('has no network inside the sandbox', async () => {
    const res = await runner.execute({
      language: 'python',
      source: 'import socket\nsocket.create_connection(("1.1.1.1", 80), timeout=2)\nprint("connected")',
      stdin: '',
      timeLimitMs: 3000,
      memoryLimitMb: 128,
    });
    expect(res.stdout).not.toContain('connected');
    expect(res.status).toBe('runtime_error');
  });
});
