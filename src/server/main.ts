import { loadConfig, loadDotEnv } from './config';
import { systemClock } from './clock';
import { createDb, runMigrations } from './db';
import { buildApp } from './app';
import { createLogger, createServices, ensureAdmin } from './bootstrap';
import { PistonRunner } from './runner/piston';
import { PistonSetup } from './runner/setup';

async function waitForDatabase(pool: import('pg').Pool, log: import('pino').Logger) {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('select 1');
      return;
    } catch (err) {
      if (attempt >= 60) throw err;
      if (attempt === 1) log.info('waiting for the database…');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const log = createLogger(config);
  const { db, pool } = createDb(config.DATABASE_URL);

  await waitForDatabase(pool, log);
  await runMigrations(db);
  await ensureAdmin(db, config, log);

  const runner = new PistonRunner(config.RUNNER_URL);
  const setup = new PistonSetup(config.RUNNER_URL, config.RUNNER_PACKAGES, log, config.RUNNER_AUTO_INSTALL);
  const services = createServices({ config, db, runner, clock: systemClock, log, setup });
  const app = await buildApp(services);

  const abort = new AbortController();
  void setup.run(abort.signal).catch((err) => log.error({ err }, 'runner setup failed'));
  await services.worker.recover();
  services.worker.start();

  await app.listen({ host: config.HOST, port: config.PORT });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'shutting down');
    abort.abort();
    await app.close();
    await services.worker.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
