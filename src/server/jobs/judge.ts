import { and, asc, eq } from 'drizzle-orm';
import { effectiveLimits } from '../../shared/languages';
import { judgeExecution } from '../../shared/checkers';
import { overallVerdict, pointsPerTest, submissionPoints, testFraction, type ContestScoring } from '../../shared/scoring';
import type { TestResult, Verdict } from '../../shared/types';
import { contestQuestions, contests, questions, submissions, testCases, type Submission } from '../db/schema';
import type { JobContext } from './context';

interface JudgeCase {
  sample: boolean;
  hidden: boolean;
  testId: number | null;
  group: string | null;
  weight: number;
  input: string;
  expected: string;
}

/** Judges one submission: examples first (worth nothing), then every test. */
export async function judgeSubmission(ctx: JobContext, sub: Submission) {
  const { db, clock, events, pool, runner } = ctx;
  const finish = async (values: Partial<Submission>) => {
    await db.update(submissions).set({ ...values, judgedAt: clock.now() }).where(eq(submissions.id, sub.id));
    events.publish(sub.userId, { type: 'submission', submissionId: sub.id, questionId: sub.questionId, contestId: sub.contestId, status: values.status ?? 'done' });
  };

  const [question] = await db.select().from(questions).where(eq(questions.id, sub.questionId));
  if (!question) {
    await finish({ status: 'failed', verdict: 'IE', compileOutput: 'The question no longer exists.' });
    return;
  }
  const tests = await db.select().from(testCases).where(eq(testCases.questionId, question.id)).orderBy(asc(testCases.position), asc(testCases.id));

  let scoring: ContestScoring = 'partial';
  let maxPoints = question.points;
  if (sub.contestId != null) {
    const [contest] = await db.select({ scoring: contests.scoring }).from(contests).where(eq(contests.id, sub.contestId));
    const [cq] = await db
      .select({ points: contestQuestions.points })
      .from(contestQuestions)
      .where(and(eq(contestQuestions.contestId, sub.contestId), eq(contestQuestions.questionId, question.id)));
    scoring = contest?.scoring ?? 'partial';
    maxPoints = cq?.points ?? question.points;
  }

  const cases: JudgeCase[] = [
    ...question.samples.map((s) => ({ sample: true, hidden: false, testId: null, group: null, weight: 0, input: s.input, expected: s.output })),
    ...tests.map((t) => ({ sample: false, hidden: t.hidden, testId: t.id, group: t.groupName, weight: t.points ?? 1, input: t.input, expected: t.expectedOutput })),
  ];
  const limits = effectiveLimits(question, sub.language, question.languageLimits);
  const stopOnFailure = scoring === 'all_or_nothing';
  const judged: (TestResult | null)[] = new Array(cases.length).fill(null);
  // Assigned inside the lanes below; typed so TypeScript does not narrow it to null.
  let compileOutput = null as string | null;
  let stopped = false;
  let next = 0;

  // A few cases run in parallel; the shared pool bounds total runner load.
  const lane = async () => {
    while (!stopped) {
      const i = next++;
      if (i >= cases.length) return;
      const c = cases[i]!;
      const execution = await pool.run('low', () =>
        runner.execute({ language: sub.language, source: sub.code, stdin: c.input, timeLimitMs: limits.timeLimitMs, memoryLimitMb: limits.memoryLimitMb }),
      );
      if (execution.status === 'compile_error') {
        compileOutput ??= execution.compileOutput ?? 'Compilation failed.';
        stopped = true;
        return;
      }
      const { verdict, message } = judgeExecution(execution, c.expected, question.checker);
      judged[i] = {
        index: i,
        testId: c.testId,
        sample: c.sample,
        hidden: c.hidden,
        group: c.group,
        verdict,
        timeMs: execution.timeMs,
        memoryKb: execution.memoryKb,
        points: 0,
        maxPoints: 0,
        message,
      };
      if (verdict !== 'AC' && stopOnFailure) stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(pool.size, cases.length)) }, lane));

  const shares = pointsPerTest(maxPoints, cases);
  const results: TestResult[] = cases.map(
    (c, i) =>
      judged[i] ?? {
        index: i,
        testId: c.testId,
        sample: c.sample,
        hidden: c.hidden,
        group: c.group,
        verdict: 'SK',
        timeMs: null,
        memoryKb: null,
        points: 0,
        maxPoints: 0,
      },
  );
  results.forEach((r, i) => {
    r.maxPoints = shares[i]!;
    r.points = r.verdict === 'AC' ? shares[i]! : 0;
  });

  let verdict: Verdict;
  let fraction: number;
  if (compileOutput !== null) {
    verdict = 'CE';
    fraction = 0;
    results.forEach((r) => {
      r.verdict = 'SK';
      r.points = 0;
    });
  } else {
    verdict = cases.length === 0 ? 'IE' : overallVerdict(results);
    fraction = testFraction(
      results.map((r, i) => ({ sample: r.sample, weight: cases[i]!.weight, group: r.group, verdict: r.verdict })),
      question.scoringMode,
    );
  }
  const executed = results.filter((r) => r.timeMs != null);
  await finish({
    status: 'done',
    verdict,
    fraction,
    score: submissionPoints(maxPoints, fraction, verdict, scoring),
    maxScore: maxPoints,
    passed: results.filter((r) => r.verdict === 'AC').length,
    total: results.length,
    timeMs: executed.length ? Math.max(...executed.map((r) => r.timeMs!)) : null,
    memoryKb: executed.length ? Math.max(...executed.map((r) => r.memoryKb ?? 0)) : null,
    compileOutput: compileOutput ? compileOutput.slice(0, 32_000) : null,
    results,
  });
}
