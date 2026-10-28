/**
 * Seeds the admin account, five sample questions and one demo contest per
 * timing mode. Safe to run more than once.
 *
 *   npm run seed
 *   docker compose exec web node dist/server/seed.js
 */
import { eq } from 'drizzle-orm';
import { loadConfig, loadDotEnv } from '../src/server/config';
import { createDb, runMigrations } from '../src/server/db';
import { users } from '../src/server/db/schema';
import { createLogger, ensureAdmin } from '../src/server/bootstrap';
import { seedDemo } from '../src/server/seed';

async function main() {
  loadDotEnv();
  const config = loadConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV === 'production' ? 'production' : 'development' });
  const log = createLogger({ ...config, NODE_ENV: 'production' });
  const { db, pool } = createDb(config.DATABASE_URL);
  await runMigrations(db);
  await ensureAdmin(db, config, log);
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  await seedDemo(db, admin!.id, new Date(), log);
  console.log('Seed complete. Questions are validated automatically when the server next starts with the runner ready.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
