import type { FastifyRequest } from 'fastify';
import type { Role } from '../../shared/types';
import { forbidden, unauthorized } from '../lib/errors';
import type { SessionUser } from './sessions';

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): SessionUser {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

/** Admins and contest creators. */
export function requireStaff(req: FastifyRequest) {
  return requireRole(req, 'admin', 'creator');
}

export const isStaff = (user: SessionUser | null) => user?.role === 'admin' || user?.role === 'creator';
