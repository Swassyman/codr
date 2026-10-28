import type { FastifyInstance, FastifyReply } from 'fastify';
import { or, sql } from 'drizzle-orm';
import { loginSchema, registerSchema } from '../../shared/schemas';
import { users } from '../db/schema';
import { conflict, forbidden, parse, unauthorized } from '../lib/errors';
import { hashPassword, verifyPassword } from '../auth/password';
import { SESSION_COOKIE, createSession, destroySession, loadSessionUser } from '../auth/sessions';

export async function authRoutes(app: FastifyInstance) {
  const { db, config, clock } = app.services;

  const setSessionCookie = (reply: FastifyReply, token: string, expires: Date) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE,
      expires,
    });

  app.get('/api/auth/me', async (req) => ({
    user: req.user,
    serverTime: clock.now().toISOString(),
    features: {
      registration: config.ALLOW_REGISTRATION,
      leaderboardUi: config.FEATURE_LEADERBOARD_UI,
    },
  }));

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(loginSchema, req.body);
      const [user] = await db
        .select()
        .from(users)
        .where(
          or(
            sql`lower(${users.username}) = lower(${body.login})`,
            sql`lower(${users.email}) = lower(${body.login})`,
          ),
        )
        .limit(1);
      const ok = await verifyPassword(body.password, user?.passwordHash ?? null);
      if (!user || !ok || user.disabled || user.isGuest) {
        throw unauthorized('That username and password do not match an active account.');
      }
      const session = await createSession(db, user.id, req.receivedAt);
      setSessionCookie(reply, session.token, session.expiresAt);
      return { user: await loadSessionUser(db, session.token, req.receivedAt) };
    },
  );

  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!config.ALLOW_REGISTRATION) throw forbidden('registration_closed', 'Registration is turned off. Ask an admin for an account.');
      const body = parse(registerSchema, req.body);
      const email = body.email ? body.email.toLowerCase() : null;
      const [taken] = await db
        .select({ username: users.username, email: users.email })
        .from(users)
        .where(
          or(
            sql`lower(${users.username}) = lower(${body.username})`,
            email ? sql`lower(${users.email}) = ${email}` : sql`false`,
          ),
        )
        .limit(1);
      if (taken) {
        const field = taken.username.toLowerCase() === body.username.toLowerCase() ? 'username' : 'email';
        throw conflict(`${field}_taken`, field === 'username' ? 'That username is taken.' : 'An account with that email already exists.', [
          { path: field, message: field === 'username' ? 'That username is taken.' : 'This email is already registered.' },
        ]);
      }
      const [user] = await db
        .insert(users)
        .values({
          username: body.username,
          displayName: body.displayName,
          email,
          passwordHash: await hashPassword(body.password),
          role: 'participant',
        })
        .returning({ id: users.id });
      const session = await createSession(db, user!.id, req.receivedAt);
      setSessionCookie(reply, session.token, session.expiresAt);
      return { user: await loadSessionUser(db, session.token, req.receivedAt) };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await destroySession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
