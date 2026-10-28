import { and, eq, ne, sql } from 'drizzle-orm';
import type { SessionUser } from '../auth/sessions';
import type { DbOrTx } from '../db';
import { contestQuestions, questions, testCases, type Question } from '../db/schema';
import { forbidden, notFound } from '../lib/errors';
import { slugify } from '../../shared/slug';

export { slugify };

/** A slug not used by any other question, adding -2, -3… when needed. */
export async function uniqueSlug(db: DbOrTx, base: string, exceptId?: number) {
  const root = slugify(base);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const clash = await db
      .select({ id: questions.id })
      .from(questions)
      .where(exceptId ? and(eq(questions.slug, candidate), ne(questions.id, exceptId)) : eq(questions.slug, candidate))
      .limit(1);
    if (clash.length === 0) return candidate;
  }
}

/** Admins can edit everything; creators only their own questions. */
export function canEditQuestion(user: SessionUser, question: Pick<Question, 'authorId'>) {
  return user.role === 'admin' || (user.role === 'creator' && question.authorId === user.id);
}

export async function loadEditableQuestion(db: DbOrTx, user: SessionUser, id: number) {
  const [question] = await db.select().from(questions).where(eq(questions.id, id));
  if (!question) throw notFound('Question not found.');
  if (!canEditQuestion(user, question)) throw forbidden('not_owner', 'Only the author or an admin can change this question.');
  return question;
}

export async function questionUsage(db: DbOrTx, questionId: number) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contestQuestions)
    .where(eq(contestQuestions.questionId, questionId));
  return row?.n ?? 0;
}

export async function testCount(db: DbOrTx, questionId: number) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(testCases).where(eq(testCases.questionId, questionId));
  return row?.n ?? 0;
}

/** Marks validation as stale whenever tests, limits or the checker change. */
export async function touchJudgeData(db: DbOrTx, questionId: number, now: Date) {
  await db.update(questions).set({ judgeDataUpdatedAt: now, updatedAt: now }).where(eq(questions.id, questionId));
}

export function validationState(q: Pick<Question, 'validation' | 'judgeDataUpdatedAt' | 'referenceSolution'>) {
  if (!q.validation) return 'missing' as const;
  if (new Date(q.validation.ranAt).getTime() < q.judgeDataUpdatedAt.getTime()) return 'stale' as const;
  return q.validation.ok ? ('passed' as const) : ('failed' as const);
}
