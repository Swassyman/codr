import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { DB } from '../db';
import { sessions, users } from '../db/schema';
import type { Role } from '../../shared/types';

export const SESSION_COOKIE = 'codr_session';
export const CSRF_COOKIE = 'codr_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  guestContestId: number | null;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export async function createSession(db: DB, userId: number, now: Date, ttlMs = ACCOUNT_SESSION_TTL_MS) {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, createdAt: now, lastSeenAt: now, expiresAt });
  return { token, expiresAt };
}

export async function loadSessionUser(db: DB, token: string, now: Date): Promise<SessionUser | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      isGuest: users.isGuest,
      guestContestId: users.guestContestId,
      disabled: users.disabled,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  if (!row || row.disabled || row.expiresAt <= now) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, tokenHash));
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isGuest: row.isGuest,
    guestContestId: row.guestContestId,
  };
}

export async function destroySession(db: DB, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function destroyUserSessions(db: DB, userId: number) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function pruneSessions(db: DB, now: Date) {
  await db.delete(sessions).where(and(lt(sessions.expiresAt, now)));
}
