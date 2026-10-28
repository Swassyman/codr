import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { createUserSchema, updateUserSchema } from '../../shared/schemas';
import { users } from '../db/schema';
import { badRequest, conflict, idParam, notFound, parse } from '../lib/errors';
import { requireRole } from '../auth/guards';
import { hashPassword } from '../auth/password';
import { destroyUserSessions } from '../auth/sessions';

const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  email: u.email,
  role: u.role,
  isGuest: u.isGuest,
  disabled: u.disabled,
  createdAt: u.createdAt.toISOString(),
});

export async function adminUserRoutes(app: FastifyInstance) {
  const { db } = app.services;

  app.get('/api/admin/users', async (req) => {
    requireRole(req, 'admin');
    const q = parse(z.object({ search: z.string().trim().max(100).optional(), guests: z.enum(['0', '1']).optional() }), req.query);
    const rows = await db
      .select()
      .from(users)
      .where(
        and(
          q.guests === '1' ? undefined : eq(users.isGuest, false),
          q.search ? or(ilike(users.username, `%${q.search}%`), ilike(users.displayName, `%${q.search}%`), ilike(users.email, `%${q.search}%`)) : undefined,
        ),
      )
      .orderBy(desc(users.createdAt))
      .limit(500);
    return { users: rows.map(publicUser) };
  });

  app.post('/api/admin/users', async (req) => {
    requireRole(req, 'admin');
    const body = parse(createUserSchema, req.body);
    const email = body.email ? body.email.toLowerCase() : null;
    const [taken] = await db
      .select({ username: users.username })
      .from(users)
      .where(or(sql`lower(${users.username}) = lower(${body.username})`, email ? sql`lower(${users.email}) = ${email}` : sql`false`))
      .limit(1);
    if (taken) {
      const field = taken.username.toLowerCase() === body.username.toLowerCase() ? 'username' : 'email';
      throw conflict(`${field}_taken`, field === 'username' ? 'That username is taken.' : 'That email is already used.', [{ path: field, message: field === 'username' ? 'That username is taken.' : 'That email is already used.' }]);
    }
    const [created] = await db
      .insert(users)
      .values({ username: body.username, displayName: body.displayName, email, role: body.role, passwordHash: await hashPassword(body.password), createdAt: req.receivedAt })
      .returning();
    return publicUser(created!);
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const me = requireRole(req, 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(updateUserSchema, req.body);
    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (!target) throw notFound('User not found.');
    if (target.isGuest && (body.role || body.password)) throw badRequest('guest', 'Guests are tied to one contest and cannot get a role or password.');
    // Never let the last way into the admin area close behind you.
    if (id === me.id && (body.disabled === true || (body.role && body.role !== 'admin'))) {
      throw badRequest('self_lockout', 'You cannot disable or demote your own account. Ask another admin.');
    }
    const [updated] = await db
      .update(users)
      .set({
        ...(body.displayName ? { displayName: body.displayName } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
        ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
      })
      .where(eq(users.id, id))
      .returning();
    // Disabling or resetting a password signs the person out everywhere.
    if (body.disabled === true || body.password) await destroyUserSessions(db, id);
    return publicUser(updated!);
  });
}
