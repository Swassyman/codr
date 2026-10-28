/**
 * Imports problems from the DeepMind CodeContests dataset (CC BY 4.0) as draft
 * questions, with statements, examples, hidden tests and a reference solution.
 *
 *   npm run import:dataset -- --split test --limit 10
 *   npm run import:dataset -- --split valid --offset 20 --limit 5 --extra-tests 20
 *   npm run import:dataset -- --search "graph" --limit 5
 *
 * In Docker: docker compose exec web node dist/server/import-dataset.js --limit 10
 */
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { loadConfig, loadDotEnv } from '../src/server/config';
import { createDb, runMigrations } from '../src/server/db';
import { users } from '../src/server/db/schema';
import { PoliteHttp } from '../src/server/importers/http';
import { codeContestsAdapter } from '../src/server/importers/code-contests';
import { saveImported } from '../src/server/importers/registry';
import type { ImportContext } from '../src/server/importers/types';

async function main() {
  loadDotEnv();
  const { values } = parseArgs({
    options: {
      split: { type: 'string', default: 'test' },
      offset: { type: 'string', default: '0' },
      limit: { type: 'string', default: '10' },
      search: { type: 'string' },
      'extra-tests': { type: 'string', default: '0' },
      author: { type: 'string', default: process.env.ADMIN_USERNAME ?? 'admin' },
    },
  });
  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  await runMigrations(db);
  const [author] = await db.select({ id: users.id }).from(users).where(eq(users.username, values.author!));
  const ctx: ImportContext = { http: new PoliteHttp(db, config.IMPORT_USER_AGENT), options: { extraTests: Number(values['extra-tests']) } };

  const limit = Number(values.limit);
  const offset = Number(values.offset);
  let ids: string[];
  if (values.search) {
    const { results } = await codeContestsAdapter.search(values.search, ctx);
    ids = results.slice(offset, offset + limit).map((r) => r.externalId);
  } else {
    ids = Array.from({ length: limit }, (_, i) => `${values.split}:${offset + i}`);
  }

  console.log(`Importing ${ids.length} problem(s) from CodeContests (CC BY 4.0)…`);
  let created = 0;
  for (const id of ids) {
    try {
      const q = codeContestsAdapter.normalize(await codeContestsAdapter.fetchProblem(id, ctx), ctx);
      const result = await saveImported(db, codeContestsAdapter.info.id, q, author?.id ?? null, new Date());
      if (!result.existed) created++;
      console.log(`${result.existed ? 'exists ' : 'created'} #${result.id}  ${q.title}  (${q.samples.length} examples, ${q.tests.length} tests${q.referenceSolution ? `, ${q.referenceSolution.language} reference` : ''})`);
    } catch (err) {
      console.error(`skipped ${id}: ${(err as Error).message}`);
    }
  }
  console.log(`Done: ${created} new draft question(s). Review them in the question bank, validate, then publish.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
