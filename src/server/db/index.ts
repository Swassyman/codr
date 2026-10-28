import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction; most helpers accept either. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

export function createDb(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}

/** drizzle/ sits at the repo (or image) root; look relative to cwd and to this file. */
function migrationsFolder() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(process.cwd(), 'drizzle'), path.resolve(here, '../../drizzle'), path.resolve(here, '../../../drizzle')];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'meta/_journal.json'))) ?? candidates[0]!;
}

export async function runMigrations(db: DB, folder = migrationsFolder()) {
  await migrate(db, { migrationsFolder: folder });
}

export { schema };
