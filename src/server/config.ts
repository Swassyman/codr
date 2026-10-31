import { z } from 'zod';

const flag = (fallback: boolean) => z.stringbool().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().default('postgres://codr:codr@localhost:55432/codr'),

  RUNNER_URL: z.string().default('http://localhost:2000'),
  /** Install missing Piston language packages on boot (needs internet once). */
  RUNNER_AUTO_INSTALL: flag(true),
  /** Piston packages to install: "python,gcc,node,java" or pinned "python=3.12.0". */
  RUNNER_PACKAGES: z.string().default('python,gcc,node,java,typescript,zig'),
  /** Programs executed in parallel against the runner. */
  RUNNER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),

  /** Per-user limits on the generic rate limiter (contests add their own rules). */
  SUBMIT_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  RUN_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(30),
  /** Sign-in attempts per address and account (a classroom behind one NAT can still log in). */
  LOGIN_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(10),

  ADMIN_USERNAME: z.string().min(2).default('admin'),
  ADMIN_PASSWORD: z.string().min(8).default('codr-admin'),
  ADMIN_EMAIL: z.string().default('admin@codr.local'),
  /** Seed the admin, sample questions and demo contests when the database is empty. */
  SEED_ON_START: flag(true),

  ALLOW_REGISTRATION: flag(true),
  COOKIE_SECURE: flag(false),
  TRUST_PROXY: flag(false),
  FEATURE_LEADERBOARD_UI: flag(false),
  IMPORT_USER_AGENT: z.string().default('Codr/0.1 (self-hosted contest platform; importer)'),
  /** Directory with the built SPA; defaults to dist/web next to the server bundle. */
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid configuration:\n  ${issues}`);
  }
  return parsed.data;
}

/** Loads .env in development so `npm run dev` works without exporting variables. */
export function loadDotEnv() {
  if (process.env.NODE_ENV === 'production') return;
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: defaults apply.
  }
}
