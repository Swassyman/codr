import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';

let ctx: TestContext;
let admin: TestClient;
let adminId: number;

beforeAll(async () => {
  ctx = await createTestContext();
  adminId = (await createUser(ctx.db, 'boss', 'admin')).id;
  admin = new TestClient(ctx.app);
  await admin.login('boss');
});

afterAll(async () => {
  await ctx.close();
});

describe('user management', () => {
  it('creates accounts that can sign in, and rejects duplicates', async () => {
    const created = await admin.post('/api/admin/users', { username: 'teacher', displayName: 'Ms. Rao', password: 'chalkboard1', role: 'creator' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ username: 'teacher', role: 'creator', disabled: false });
    expect((await admin.post('/api/admin/users', { username: 'TEACHER', displayName: 'x', password: 'chalkboard1', role: 'participant' })).status).toBe(409);
    const teacher = new TestClient(ctx.app);
    expect((await teacher.login('teacher', 'chalkboard1')).role).toBe('creator');
    expect((await teacher.get('/api/admin/users')).status).toBe(403);
  });

  it('changes roles immediately and signs out disabled users', async () => {
    const u = await createUser(ctx.db, 'student');
    const student = new TestClient(ctx.app);
    await student.login('student');
    await admin.patch(`/api/admin/users/${u.id}`, { role: 'creator' });
    expect((await student.get('/api/auth/me')).body.user.role).toBe('creator');

    await admin.patch(`/api/admin/users/${u.id}`, { disabled: true });
    expect((await student.get('/api/auth/me')).body.user).toBeNull();
    expect((await new TestClient(ctx.app).post('/api/auth/login', { login: 'student', password: 'password123' })).status).toBe(401);
  });

  it('resets passwords and signs the user out everywhere', async () => {
    const u = await createUser(ctx.db, 'forgetful');
    const session = new TestClient(ctx.app);
    await session.login('forgetful');
    await admin.patch(`/api/admin/users/${u.id}`, { password: 'brand-new-pass' });
    expect((await session.get('/api/auth/me')).body.user).toBeNull();
    await new TestClient(ctx.app).login('forgetful', 'brand-new-pass');
  });

  it('will not let an admin lock themselves out', async () => {
    expect((await admin.patch(`/api/admin/users/${adminId}`, { disabled: true })).body.error.code).toBe('self_lockout');
    expect((await admin.patch(`/api/admin/users/${adminId}`, { role: 'participant' })).body.error.code).toBe('self_lockout');
  });
});
