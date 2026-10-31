import { eq } from 'drizzle-orm';
import type { DB } from '../../src/server/db';
import { contestQuestions, contests, questions, testCases } from '../../src/server/db/schema';
import type { LanguageId } from '../../src/shared/languages';
import type { Sample } from '../../src/shared/types';

export interface QuestionFixture {
  title?: string;
  slug?: string;
  samples?: Sample[];
  tests?: { input: string; output: string; hidden?: boolean; points?: number | null; group?: string | null }[];
  points?: number;
  practice?: boolean;
  practiceHidden?: boolean;
  allowedLanguages?: LanguageId[];
  status?: 'draft' | 'published';
  scoringMode?: 'tests' | 'groups';
  authorId?: number | null;
}

let n = 0;

/** A published "sum the numbers" question unless overridden. */
export async function createQuestion(db: DB, f: QuestionFixture = {}) {
  n++;
  const [q] = await db
    .insert(questions)
    .values({
      title: f.title ?? `Sum ${n}`,
      slug: f.slug ?? `sum-${n}-${Math.random().toString(36).slice(2, 7)}`,
      statement: 'Print the sum of the numbers.',
      samples: f.samples ?? [{ input: '1 2\n', output: '3\n' }],
      allowedLanguages: f.allowedLanguages ?? ['cpp', 'python', 'java', 'javascript', 'c'],
      points: f.points ?? 100,
      practice: f.practice ?? true,
      practiceHidden: f.practiceHidden ?? false,
      status: f.status ?? 'published',
      scoringMode: f.scoringMode ?? 'tests',
      authorId: f.authorId ?? null,
    })
    .returning();
  const tests = f.tests ?? [
    { input: '10 20\n', output: '30\n' },
    { input: '5 5\n', output: '10\n' },
  ];
  if (tests.length) {
    await db.insert(testCases).values(
      tests.map((t, i) => ({
        questionId: q!.id,
        position: i,
        input: t.input,
        expectedOutput: t.output,
        hidden: t.hidden ?? true,
        points: t.points ?? null,
        groupName: t.group ?? null,
      })),
    );
  }
  return q!;
}

let codes = 0;

/** A published contest around the default fake-clock time (10:00Z) unless overridden. */
export async function createContest(
  db: DB,
  questionIds: number[],
  f: Partial<typeof contests.$inferInsert> & { durations?: (number | null)[]; points?: (number | null)[] } = {},
) {
  const { durations, points, ...values } = f;
  const [c] = await db
    .insert(contests)
    .values({
      name: `Contest ${++codes}`,
      startsAt: new Date('2030-01-15T09:00:00Z'),
      endsAt: new Date('2030-01-15T12:00:00Z'),
      joinCode: `TEST-${String(codes).padStart(4, '0')}`,
      status: 'published',
      visibility: 'public',
      ...values,
    })
    .returning();
  await db.insert(contestQuestions).values(
    questionIds.map((questionId, position) => ({ contestId: c!.id, questionId, position, durationMinutes: durations?.[position] ?? null, points: points?.[position] ?? null })),
  );
  return c!;
}

export async function setQuestion(db: DB, id: number, values: Partial<typeof questions.$inferInsert>) {
  await db.update(questions).set(values).where(eq(questions.id, id));
}
