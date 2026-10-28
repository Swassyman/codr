import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { DEFAULT_LANGUAGES } from '../../shared/languages';
import type { DB } from '../db';
import { contestQuestions, contests, questions, runs, testCases } from '../db/schema';
import { uniqueJoinCode } from '../services/contests';
import { SEED_QUESTIONS } from './data';

const DAY = 24 * 3600_000;

/**
 * Demo content: five sample questions (with tests and a Python reference
 * solution) and one public contest per timing mode. The demo contests use the
 * three easier questions; the two harder ones stay out of contests so the
 * practice bank is not empty while the demos run (questions in an unfinished
 * contest are hidden from practice). Idempotent: existing questions (by slug)
 * and contests (by name) are left alone.
 */
export async function seedDemo(db: DB, adminId: number, now: Date, log?: Logger) {
  const ids = new Map<string, number>();
  for (const q of SEED_QUESTIONS) {
    const [existing] = await db.select({ id: questions.id }).from(questions).where(eq(questions.slug, q.slug));
    if (existing) {
      ids.set(q.slug, existing.id);
      continue;
    }
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(questions)
        .values({
          slug: q.slug,
          title: q.title,
          difficulty: q.difficulty,
          rating: q.rating,
          tags: q.tags,
          statement: q.statement,
          inputFormat: q.inputFormat,
          outputFormat: q.outputFormat,
          constraints: q.constraints,
          samples: q.samples,
          notes: q.notes,
          timeLimitMs: q.timeLimitMs,
          memoryLimitMb: q.memoryLimitMb,
          checker: q.checker,
          allowedLanguages: DEFAULT_LANGUAGES,
          referenceSolution: { language: 'python', code: q.reference },
          status: 'published',
          practice: true,
          authorId: adminId,
          createdAt: now,
          updatedAt: now,
          judgeDataUpdatedAt: now,
        })
        .returning({ id: questions.id });
      const inputs = q.inputs();
      await tx.insert(testCases).values(
        inputs.map((input, position) => ({ questionId: row!.id, position, input, expectedOutput: q.solve(input), hidden: true, createdAt: now, updatedAt: now })),
      );
      return row!.id;
    });
    ids.set(q.slug, id);
  }

  const contestsToCreate: { name: string; description: string; slugs: string[]; values: Partial<typeof contests.$inferInsert> }[] = [
    {
      name: 'Demo: fixed window',
      description: 'Everyone works in the same window. Partial credit, results shown right away. A good first contest to try.',
      slugs: ['sum-of-two-numbers', 'average-of-a-list', 'counting-islands'],
      values: { timingMode: 'fixed_window', scoring: 'partial', leaderboardEnabled: true },
    },
    {
      name: 'Demo: personal window',
      description: 'Your 60 minutes start when you press Start. All-or-nothing scoring with a penalty, and hidden-test results are revealed when your time is up.',
      slugs: ['average-of-a-list', 'sum-of-two-numbers', 'counting-islands'],
      values: { timingMode: 'personal_window', durationMinutes: 60, scoring: 'all_or_nothing', penaltyMinutes: 20, revealHidden: 'after', maxSubmissionsPerQuestion: 10 },
    },
    {
      name: 'Demo: timer per question',
      description: 'Each question has its own 15-minute timer. Questions open in order and each can be viewed only once. Tab switches and pastes are recorded.',
      slugs: ['sum-of-two-numbers', 'counting-islands', 'average-of-a-list'],
      values: { timingMode: 'per_question', defaultQuestionMinutes: 15, viewOnce: true, sequential: true, recordIntegrity: true },
    },
  ];

  let created = 0;
  for (const c of contestsToCreate) {
    const [existing] = await db.select({ id: contests.id }).from(contests).where(eq(contests.name, c.name));
    if (existing) continue;
    const [row] = await db
      .insert(contests)
      .values({
        name: c.name,
        description: c.description,
        startsAt: new Date(now.getTime() - 10 * 60_000),
        endsAt: new Date(now.getTime() + 30 * DAY),
        visibility: 'public',
        joinCode: await uniqueJoinCode(db),
        status: 'published',
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
        ...c.values,
      })
      .returning({ id: contests.id });
    await db.insert(contestQuestions).values(c.slugs.map((slug, position) => ({ contestId: row!.id, questionId: ids.get(slug)!, position })));
    created++;
  }
  log?.info({ questions: ids.size, contests: created }, 'seeded demo content');
}

export async function needsSeed(db: DB) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(questions);
  return (row?.n ?? 0) === 0;
}

/** Runs each seed question's reference solution once the runner is ready, so the bank shows real validation results. */
export async function queueSeedValidation(db: DB, adminId: number, now: Date) {
  const pending = await db
    .select({ id: questions.id, reference: questions.referenceSolution })
    .from(questions)
    .where(and(inArray(questions.slug, SEED_QUESTIONS.map((q) => q.slug)), isNull(questions.validation)));
  for (const q of pending) {
    if (!q.reference) continue;
    const [already] = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.questionId, q.id), eq(runs.kind, 'validate'), inArray(runs.status, ['queued', 'running'])));
    if (already) continue;
    await db.insert(runs).values({ userId: adminId, questionId: q.id, kind: 'validate', language: q.reference.language, code: q.reference.code, createdAt: now });
  }
  return pending.length;
}
