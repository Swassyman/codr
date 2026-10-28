import { eq } from 'drizzle-orm';
import type { DB } from '../../src/server/db';
import { questions, testCases } from '../../src/server/db/schema';
import type { Sample } from '../../src/shared/types';

export interface QuestionFixture {
  title?: string;
  slug?: string;
  samples?: Sample[];
  tests?: { input: string; output: string; hidden?: boolean; points?: number | null; group?: string | null }[];
  points?: number;
  practice?: boolean;
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
      allowedLanguages: ['cpp', 'python', 'java', 'javascript', 'c'],
      points: f.points ?? 100,
      practice: f.practice ?? true,
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

export async function setQuestion(db: DB, id: number, values: Partial<typeof questions.$inferInsert>) {
  await db.update(questions).set(values).where(eq(questions.id, id));
}
