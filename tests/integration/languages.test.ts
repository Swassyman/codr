import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { createQuestion } from '../helpers/fixtures';
import { FakeRunner } from '../helpers/fake-runner';
import { createServices } from '../../src/server/bootstrap';
import { buildApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { PistonRunner } from '../../src/server/runner/piston';
import { DEFAULT_LANGUAGES, LANGUAGES, effectiveLimits } from '../../src/shared/languages';
import type { RuntimeInfo } from '../../src/server/runner/types';

/** The fake runner with Zig and TypeScript installed, and a switch to make it unreachable. */
class SwitchableRunner extends FakeRunner {
  down = false;
  constructor() {
    super(['cpp', 'python', 'javascript', 'typescript', 'zig']);
  }
  override async runtimes(): Promise<RuntimeInfo[]> {
    if (this.down) throw new Error('connect ECONNREFUSED');
    return (await super.runtimes()).map((rt) => ({ ...rt, version: rt.language === 'zig' ? '0.10.1' : rt.language === 'typescript' ? '5.0.3' : rt.version }));
  }
}

let ctx: TestContext;
let runner: SwitchableRunner;
let alice: TestClient;

beforeAll(async () => {
  runner = new SwitchableRunner();
  ctx = await createTestContext({ runner });
  await createUser(ctx.db, 'alice');
  alice = new TestClient(ctx.app);
  await alice.login('alice');
});

afterAll(async () => {
  await ctx.close();
});

describe('Zig and TypeScript', () => {
  it('are accepted and judged like any other language, with their own limits', async () => {
    const q = await createQuestion(ctx.db, { allowedLanguages: DEFAULT_LANGUAGES });
    for (const language of ['zig', 'typescript'] as const) {
      runner.executions = [];
      const res = await alice.post(`/api/practice/questions/${q.slug}/submit`, { language, code: '// fake:sum' });
      expect(res.status).toBe(200);
      await ctx.services.worker.drain();
      const sub = (await alice.get(`/api/submissions/${res.body.id}`)).body;
      expect(sub).toMatchObject({ language, verdict: 'AC' });
      const limits = effectiveLimits(q, language);
      expect(runner.executions.every((e) => e.language === language && e.timeLimitMs === limits.timeLimitMs && e.memoryLimitMb === limits.memoryLimitMb)).toBe(true);
    }
  });

  it('are offered by default for new questions', async () => {
    await createUser(ctx.db, 'author', 'creator');
    const author = new TestClient(ctx.app);
    await author.login('author');
    const { body } = await author.post('/api/manage/questions', { title: 'Fresh' });
    expect((await author.get(`/api/manage/questions/${body.id}`)).body.allowedLanguages).toEqual(expect.arrayContaining(['typescript', 'zig']));
  });

  it('are refused when the question does not allow them', async () => {
    const q = await createQuestion(ctx.db);
    const res = await alice.post(`/api/practice/questions/${q.slug}/submit`, { language: 'zig', code: '// fake:sum' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('language_not_allowed');
  });
});

describe('runtime versions', () => {
  it('reports the installed version of each language and keeps the last known ones while the runner is down', async () => {
    const up = await alice.get('/api/runtimes');
    expect(up.body.reachable).toBe(true);
    expect(up.body.languages).toEqual(expect.arrayContaining([{ id: 'zig', label: 'Zig', version: '0.10.1' }, { id: 'typescript', label: 'TypeScript', version: '5.0.3' }]));
    expect(up.body.versions).toMatchObject({ zig: '0.10.1', typescript: '5.0.3', cpp: '1.0.0' });

    runner.down = true;
    try {
      const down = await alice.get('/api/runtimes');
      expect(down.body).toMatchObject({ reachable: false, languages: [], versions: { zig: '0.10.1', typescript: '5.0.3' } });
    } finally {
      runner.down = false;
    }
  });
});

// Real compilers, when the runner has both packages installed. TypeScript also
// needs the runner image built from runner/Dockerfile (its compile override).
const RUNNER_URL = process.env.RUNNER_URL ?? 'http://localhost:2000';
const live = await fetch(`${RUNNER_URL}/api/v2/runtimes`, { signal: AbortSignal.timeout(1500) })
  .then(async (r) => {
    const list = r.ok ? ((await r.json()) as { language: string; runtime?: string }[]) : [];
    return ['zig', 'typescript'].every((l) => list.some((rt) => rt.language === l && (rt.runtime ?? rt.language) === l));
  })
  .catch(() => false);

describe.runIf(live)('Zig and TypeScript on the real runner', () => {
  it('passes the runner check and judges submissions', async () => {
    const config = loadConfig({ NODE_ENV: 'test', RUNNER_CONCURRENCY: '4', SUBMIT_RATE_PER_MINUTE: '1000' });
    const real = new PistonRunner(RUNNER_URL);
    const services = createServices({ config, db: ctx.db, runner: real, clock: ctx.clock, log: pino({ level: 'silent' }) });
    const app = await buildApp(services);
    const client = new TestClient(app);
    await client.login('alice');
    try {
      // The admin page's check: each hello-world echoes its first input line.
      for (const language of ['zig', 'typescript'] as const) {
        const r = await real.execute({ language, source: LANGUAGES[language].hello, stdin: 'codr\n', timeLimitMs: 2000, memoryLimitMb: 256 });
        expect(
          { language, status: r.status, out: r.stdout.trim(), compile: r.compileOutput },
          language === 'typescript' ? 'TypeScript needs the runner image built from runner/Dockerfile (docker compose up -d --build runner)' : undefined,
        ).toEqual({ language, status: 'ok', out: 'hello codr', compile: null });
      }

      const q = await createQuestion(ctx.db, {
        allowedLanguages: DEFAULT_LANGUAGES,
        tests: [
          { input: '2000000000 2000000000\n', output: '4000000000\n' },
          { input: '-7 3\n', output: '-4\n' },
        ],
      });
      const send = async (language: string, code: string) => {
        const res = await client.post(`/api/practice/questions/${q.slug}/submit`, { language, code });
        expect(res.status).toBe(200);
        await services.worker.drain(240_000);
        return (await client.get(`/api/submissions/${res.body.id}`)).body;
      };

      // Built from the starter templates, the way a participant would.
      const zig = LANGUAGES.zig.template
        .replace('    _ = tokens;\n', '    const a = try std.fmt.parseInt(i64, tokens.next().?, 10);\n    const b = try std.fmt.parseInt(i64, tokens.next().?, 10);\n')
        .replace('    _ = w;\n', '    try w.print("{d}\\n", .{a + b});\n');
      expect((await send('zig', zig)).verdict).toBe('AC');

      const ts = `${LANGUAGES.typescript.template}const [a, b] = input.map(BigInt);\nconsole.log(String(a + b));\n`;
      expect((await send('typescript', ts)).verdict).toBe('AC');

      const typeError = await send('typescript', 'const n: number = "seven";\nconsole.log(n);\n');
      expect(typeError.verdict).toBe('CE');
      expect(typeError.compileOutput).toMatch(/^main\.ts\(1,7\): error TS2322/);

      const zigError = await send('zig', 'pub fn main() void {\n    const unused = 1;\n}\n');
      expect(zigError.verdict).toBe('CE');
      expect(zigError.compileOutput).toMatch(/^main\.zig:2:11: error/);
    } finally {
      await app.close();
      await services.worker.stop();
    }
  }, 300_000);
});
