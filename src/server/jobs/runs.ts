import { asc, eq } from 'drizzle-orm';
import { effectiveLimits } from '../../shared/languages';
import { executionVerdict, judgeExecution } from '../../shared/checkers';
import type { CheckerConfig, ValidationReport } from '../../shared/types';
import { questions, runs, testCases, type Run, type RunCaseResult } from '../db/schema';
import { clip, type JobContext } from './context';

interface RunCase {
  label: string;
  input: string;
  expected: string | null;
  testId: number | null;
  sample: boolean;
}

interface RunPlan {
  cases: RunCase[];
  timeLimitMs: number;
  memoryLimitMb: number;
  checker: CheckerConfig;
}

const SCRATCH_LIMITS = { timeLimitMs: 5000, memoryLimitMb: 512 };

async function planRun(ctx: JobContext, run: Run): Promise<RunPlan> {
  if (run.questionId == null) {
    return { cases: [{ label: 'Custom input', input: run.input ?? '', expected: null, testId: null, sample: false }], ...SCRATCH_LIMITS, checker: { type: 'trim' } };
  }
  const [question] = await ctx.db.select().from(questions).where(eq(questions.id, run.questionId));
  if (!question) throw new Error('The question no longer exists.');
  const limits = effectiveLimits(question, run.language, question.languageLimits);
  const samples: RunCase[] = question.samples.map((s, i) => ({
    label: `Sample ${i + 1}`,
    input: s.input,
    expected: s.output,
    testId: null,
    sample: true,
  }));

  switch (run.kind) {
    case 'custom':
      return { cases: [{ label: 'Custom input', input: run.input ?? '', expected: null, testId: null, sample: false }], ...limits, checker: question.checker };
    case 'samples':
      return { cases: samples, ...limits, checker: question.checker };
    case 'generate':
    case 'validate': {
      const tests = await ctx.db.select().from(testCases).where(eq(testCases.questionId, question.id)).orderBy(asc(testCases.position));
      const testRuns: RunCase[] = tests.map((t, i) => ({
        label: t.label || `Test ${i + 1}`,
        input: t.input,
        expected: t.expectedOutput,
        testId: t.id,
        sample: false,
      }));
      if (run.kind === 'generate') {
        // Give a slow reference solution room to finish; validation reports real timings.
        return { cases: testRuns, timeLimitMs: Math.min(15_000, limits.timeLimitMs * 3), memoryLimitMb: limits.memoryLimitMb, checker: question.checker };
      }
      return { cases: [...samples, ...testRuns], ...limits, checker: question.checker };
    }
  }
}

/** Executes a queued run (custom input, samples, output generation or validation). */
export async function processRun(ctx: JobContext, run: Run) {
  const { db, clock, events } = ctx;
  let plan: RunPlan;
  try {
    plan = await planRun(ctx, run);
  } catch (err) {
    await db.update(runs).set({ status: 'failed', error: (err as Error).message, finishedAt: clock.now() }).where(eq(runs.id, run.id));
    events.publish(run.userId, { type: 'run', runId: run.id, status: 'failed' });
    return;
  }

  const keepFullOutput = run.kind === 'generate';
  const results: RunCaseResult[] = await Promise.all(
    plan.cases.map(async (c) => {
      const execution = await ctx.pool.run('high', () =>
        ctx.runner.execute({
          language: run.language,
          source: run.code,
          stdin: c.input,
          timeLimitMs: plan.timeLimitMs,
          memoryLimitMb: plan.memoryLimitMb,
        }),
      );
      const judged =
        c.expected == null || run.kind === 'generate'
          ? { verdict: executionVerdict(execution.status), message: execution.message ?? undefined }
          : judgeExecution(execution, c.expected, plan.checker);
      return {
        label: c.label,
        input: keepFullOutput ? c.input : clip(c.input),
        expected: c.expected == null ? null : keepFullOutput ? c.expected : clip(c.expected),
        testId: c.testId,
        sample: c.sample,
        verdict: judged.verdict,
        execution: {
          ...execution,
          stdout: keepFullOutput ? execution.stdout : clip(execution.stdout),
          stderr: clip(execution.stderr, 16 * 1024),
          compileOutput: execution.compileOutput ? clip(execution.compileOutput, 32 * 1024) : null,
          message: execution.message ?? judged.message ?? null,
        },
      } satisfies RunCaseResult;
    }),
  );

  await db.update(runs).set({ status: 'done', results, finishedAt: clock.now() }).where(eq(runs.id, run.id));

  if (run.kind === 'validate' && run.questionId != null) {
    const times = results.map((r) => r.execution.timeMs).filter((t): t is number => t != null);
    const report: ValidationReport = {
      ranAt: clock.now().toISOString(),
      language: run.language,
      ok: results.length > 0 && results.every((r) => r.verdict === 'AC'),
      timeLimitMs: plan.timeLimitMs,
      maxTimeMs: times.length ? Math.max(...times) : null,
      cases: results.map((r) => ({
        testId: r.testId ?? null,
        sample: r.sample ?? false,
        label: r.label,
        verdict: (r.verdict ?? 'IE') as ValidationReport['cases'][number]['verdict'],
        timeMs: r.execution.timeMs,
        memoryKb: r.execution.memoryKb,
        message: r.execution.message ?? undefined,
      })),
    };
    await db.update(questions).set({ validation: report }).where(eq(questions.id, run.questionId));
  }

  events.publish(run.userId, { type: 'run', runId: run.id, status: 'done' });
}
