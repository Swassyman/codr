import { and, eq, sql } from 'drizzle-orm';
import type { LanguageId } from '../../shared/languages';
import type { SubmissionDTO, TestResultDTO } from '../../shared/api';
import { overallVerdict } from '../../shared/scoring';
import type { DB, DbOrTx } from '../db';
import { drafts, submissions, type Submission } from '../db/schema';

export interface NewSubmission {
  userId: number;
  contestId: number | null;
  questionId: number;
  language: LanguageId;
  code: string;
  receivedAt: Date;
  isAuto?: boolean;
  idempotencyKey?: string | null;
}

/**
 * Inserts a queued submission. A repeated idempotency key (double click, retry
 * after a dropped connection) returns the original submission instead.
 */
export async function createSubmission(db: DbOrTx, input: NewSubmission): Promise<{ id: number; duplicate: boolean }> {
  const inserted = await db
    .insert(submissions)
    .values({
      userId: input.userId,
      contestId: input.contestId,
      questionId: input.questionId,
      language: input.language,
      code: input.code,
      receivedAt: input.receivedAt,
      isAuto: input.isAuto ?? false,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: [submissions.userId, submissions.idempotencyKey] })
    .returning({ id: submissions.id });
  if (inserted[0]) return { id: inserted[0].id, duplicate: false };
  const [existing] = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.userId, input.userId), eq(submissions.idempotencyKey, input.idempotencyKey!)));
  return { id: existing!.id, duplicate: true };
}

export async function queuePosition(db: DB, sub: Pick<Submission, 'id' | 'status'>) {
  if (sub.status !== 'queued') return null;
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM submissions WHERE status = 'queued' AND id < ${sub.id}`);
  return (res.rows[0]?.n ?? 0) + 1;
}

export interface Visibility {
  /** Show per-test rows, or only the summary counts. */
  detail: 'per_test' | 'summary';
  /** Show hidden-test outcomes (and therefore the final verdict and score). */
  revealHidden: boolean;
  includeCode: boolean;
}

export const FULL_VISIBILITY: Visibility = { detail: 'per_test', revealHidden: true, includeCode: true };

/** The participant view of a submission. Test inputs/outputs are never included. */
export function toSubmissionDTO(sub: Submission, visibility: Visibility, position: number | null = null): SubmissionDTO {
  let sampleNo = 0;
  let testNo = 0;
  const all: TestResultDTO[] = sub.results.map((r) => ({
    index: r.index,
    label: r.sample ? `Example ${++sampleNo}` : `Test ${++testNo}`,
    sample: r.sample,
    hidden: r.hidden,
    verdict: r.verdict,
    timeMs: r.timeMs,
    memoryKb: r.memoryKb,
    points: r.points,
    maxPoints: r.maxPoints,
    // Checker messages are positional only, but hidden tests stay silent anyway.
    message: r.hidden ? undefined : r.message,
  }));
  const done = sub.status === 'done' || sub.status === 'failed';
  const withheld = done && !visibility.revealHidden && all.some((r) => r.hidden);
  const visible = withheld ? all.filter((r) => !r.hidden) : all;
  const verdict = !done ? null : withheld && sub.verdict !== 'CE' ? overallVerdict(visible) : sub.verdict;
  return {
    id: sub.id,
    questionId: sub.questionId,
    contestId: sub.contestId,
    language: sub.language,
    status: sub.status,
    queuePosition: position,
    verdict,
    score: done && !withheld ? sub.score : null,
    maxScore: sub.maxScore,
    passed: withheld ? visible.filter((r) => r.verdict === 'AC').length : sub.passed,
    total: withheld ? visible.length : sub.total,
    timeMs: withheld ? maxOf(visible.map((r) => r.timeMs)) : sub.timeMs,
    memoryKb: withheld ? maxOf(visible.map((r) => r.memoryKb)) : sub.memoryKb,
    compileOutput: sub.compileOutput,
    results: visibility.detail === 'summary' ? null : visible,
    withheld,
    receivedAt: sub.receivedAt.toISOString(),
    judgedAt: sub.judgedAt?.toISOString() ?? null,
    isAuto: sub.isAuto,
    ...(visibility.includeCode ? { code: sub.code } : {}),
  };
}

function maxOf(values: (number | null)[]) {
  const nums = values.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

/** Upserts the latest editor content for one language. */
export async function saveDraft(db: DbOrTx, input: { userId: number; contestId: number | null; questionId: number; language: LanguageId; code: string; now: Date }) {
  await db
    .insert(drafts)
    .values({ userId: input.userId, contestId: input.contestId, questionId: input.questionId, language: input.language, code: input.code, updatedAt: input.now })
    .onConflictDoUpdate({
      target: [drafts.userId, drafts.contestId, drafts.questionId, drafts.language],
      set: { code: input.code, updatedAt: input.now },
    });
}

export async function loadDrafts(db: DbOrTx, userId: number, contestId: number | null, questionId: number) {
  const rows = await db
    .select()
    .from(drafts)
    .where(
      and(
        eq(drafts.userId, userId),
        contestId == null ? sql`${drafts.contestId} IS NULL` : eq(drafts.contestId, contestId),
        eq(drafts.questionId, questionId),
      ),
    );
  return rows.map((d) => ({ language: d.language, code: d.code, updatedAt: d.updatedAt.toISOString() }));
}
