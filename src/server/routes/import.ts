import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, notFound, parse } from '../lib/errors';
import { requireStaff } from '../auth/guards';
import { PoliteHttp } from '../importers/http';
import { ADAPTERS, adapterById, findImported, saveImported } from '../importers/registry';
import { SourceError, type ImportContext } from '../importers/types';
import { userKey } from '../services/workspace';

const sourceParams = z.object({ source: z.string().min(1).max(40) });
const importBody = z.object({
  externalId: z.string().min(1).max(120),
  extraTests: z.number().int().min(0).max(100).optional(),
});

/** Source failures become clear 4xx/5xx answers; one source failing never affects another. */
function sourceFailure(err: unknown): never {
  if (err instanceof SourceError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'robots' || err.code === 'blocked' ? 403 : 502;
    throw new HttpError(status, `source_${err.code}`, err.message);
  }
  throw err;
}

export async function importRoutes(app: FastifyInstance) {
  const { db, config, clock } = app.services;
  const http = new PoliteHttp(db, config.IMPORT_USER_AGENT, () => clock.now());
  const ctx = (extraTests?: number): ImportContext => ({ http, options: { extraTests } });

  app.get('/api/manage/import/sources', async (req) => {
    requireStaff(req);
    return { sources: ADAPTERS.map((a) => a.info) };
  });

  app.get('/api/manage/import/:source/search', { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    requireStaff(req);
    const { source } = parse(sourceParams, req.params);
    const { q } = parse(z.object({ q: z.string().max(100).default('') }), req.query);
    const adapter = adapterById(source);
    if (!adapter) throw notFound('Unknown source.');
    try {
      const { results, note } = await adapter.search(q, ctx());
      const imported = await findImported(db, adapter.info.id, results.map((r) => r.externalId));
      return { results: results.map((r) => ({ ...r, importedQuestionId: imported.get(r.externalId) ?? null })), note: note ?? null };
    } catch (err) {
      sourceFailure(err);
    }
  });

  app.post('/api/manage/import/:source/import', { config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    const user = requireStaff(req);
    const { source } = parse(sourceParams, req.params);
    const body = parse(importBody, req.body);
    const adapter = adapterById(source);
    if (!adapter) throw notFound('Unknown source.');
    try {
      const c = ctx(body.extraTests);
      const normalized = adapter.normalize(await adapter.fetchProblem(body.externalId, c), c);
      return await saveImported(db, adapter.info.id, normalized, user.id, req.receivedAt);
    } catch (err) {
      sourceFailure(err);
    }
  });
}
