import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Logger } from 'pino';
import type { Config } from './config';
import type { Clock } from './clock';
import type { DB } from './db';
import type { EventBus } from './events';
import type { ExecutionPool } from './jobs/pool';
import type { JobWorker } from './jobs/worker';
import type { Runner } from './runner/types';
import type { PistonSetup } from './runner/setup';
import type { ExpiryScheduler } from './services/scheduler';
import { HttpError, forbidden } from './lib/errors';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, loadSessionUser, randomToken, type SessionUser } from './auth/sessions';
import { authRoutes } from './routes/auth';
import { systemRoutes } from './routes/system';
import { runRoutes } from './routes/runs';
import { contestRoutes } from './routes/contests';
import { manageQuestionRoutes } from './routes/manage-questions';
import { practiceRoutes } from './routes/practice';
import { submissionRoutes } from './routes/submissions';
import { contestPlayRoutes } from './routes/contest-play';
import { manageContestRoutes } from './routes/manage-contests';
import { importRoutes } from './routes/import';

export interface Services {
  config: Config;
  db: DB;
  runner: Runner;
  clock: Clock;
  events: EventBus;
  pool: ExecutionPool;
  worker: JobWorker;
  scheduler: ExpiryScheduler;
  setup: PistonSetup | null;
  log: Logger;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
  interface FastifyRequest {
    user: SessionUser | null;
    /** Server time at which the request arrived; used for every deadline decision. */
    receivedAt: Date;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function resolveWebDist(config: Config) {
  if (config.WEB_DIST) return config.WEB_DIST;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/server/main.js → dist/web; tsx from the repo → dist/web under cwd. Only a
  // built SPA has an assets/ folder (src/web has an index.html too, but no build).
  const candidates = [path.resolve(here, '../web'), path.resolve(process.cwd(), 'dist/web')];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'assets'))) ?? null;
}

export async function buildApp(services: Services): Promise<FastifyInstance> {
  const { config, clock } = services;
  const app = Fastify({
    loggerInstance: services.log as FastifyBaseLogger,
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 4 * 1024 * 1024,
  });
  app.decorate('services', services);
  app.decorateRequest('user', null);
  app.decorateRequest('receivedAt', null as unknown as Date);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        workerSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: false,
  });
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) =>
      new HttpError(429, 'rate_limited', `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`),
  });

  app.addHook('onRequest', async (req, reply) => {
    req.receivedAt = clock.now();
    if (!req.cookies[CSRF_COOKIE]) {
      reply.setCookie(CSRF_COOKIE, randomToken(18), {
        path: '/',
        sameSite: 'strict',
        secure: config.COOKIE_SECURE,
        httpOnly: false,
      });
    }
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await loadSessionUser(services.db, token, req.receivedAt) : null;

    if (UNSAFE_METHODS.has(req.method) && req.url.startsWith('/api/')) {
      // Double-submit token: the SPA copies the readable cookie into a header,
      // which a cross-site form or script cannot do.
      const header = req.headers[CSRF_HEADER];
      const expected = req.cookies[CSRF_COOKIE];
      if (!expected || header !== expected) {
        throw forbidden('csrf_failed', 'Your security token is missing or out of date. Reload the page and try again.');
      }
      const origin = req.headers.origin;
      if (origin) {
        let originHost: string | null = null;
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = null;
        }
        const host = (config.TRUST_PROXY && (req.headers['x-forwarded-host'] as string)) || req.headers.host;
        if (originHost !== host) throw forbidden('csrf_failed', 'Cross-site request blocked.');
      }
    }
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-server-time', String(clock.now().getTime()));
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      const code = e.statusCode === 413 ? 'payload_too_large' : (e.code?.toLowerCase() ?? 'bad_request');
      return reply.status(e.statusCode).send({ error: { code, message: e.message ?? 'Bad request.' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong on the server. Check the server log.' } });
  });

  await app.register(authRoutes);
  await app.register(systemRoutes);
  await app.register(runRoutes);
  await app.register(contestRoutes);
  await app.register(manageQuestionRoutes);
  await app.register(practiceRoutes);
  await app.register(submissionRoutes);
  await app.register(contestPlayRoutes);
  await app.register(manageContestRoutes);
  await app.register(importRoutes);

  const webDist = resolveWebDist(config);
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      setHeaders(reply, filePath) {
        reply.header('cache-control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !webDist || req.method !== 'GET') {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    }
    // Client-side routes all render the SPA shell.
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });

  return app;
}
