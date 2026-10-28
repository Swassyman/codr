import { and, inArray, sql } from 'drizzle-orm';
import { DEFAULT_LANGUAGES } from '../../shared/languages';
import type { DB } from '../db';
import { questions, testCases } from '../db/schema';
import { uniqueSlug } from '../services/questions';
import { atcoderAdapter } from './atcoder';
import { codeContestsAdapter } from './code-contests';
import { codeforcesAdapter } from './codeforces';
import { csesAdapter } from './cses';
import type { NormalizedQuestion, SourceAdapter } from './types';

/** Every available source. Add a new adapter here (see README, "Adding an importer"). */
export const ADAPTERS: SourceAdapter<any>[] = [codeContestsAdapter, codeforcesAdapter, atcoderAdapter, csesAdapter];

export const adapterById = (id: string) => ADAPTERS.find((a) => a.info.id === id) ?? null;

export async function findImported(db: DB, adapterId: string, externalIds: string[]) {
  if (externalIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ id: questions.id, externalId: sql<string>`${questions.source}->>'externalId'` })
    .from(questions)
    .where(and(sql`${questions.source}->>'adapter' = ${adapterId}`, inArray(sql`${questions.source}->>'externalId'`, externalIds)));
  return new Map(rows.map((r) => [r.externalId, r.id]));
}

/**
 * Stores a normalized problem as a draft question with its attribution. The
 * creator reviews it in the normal question form before anything is published.
 */
export async function saveImported(db: DB, adapterId: string, q: NormalizedQuestion, authorId: number | null, now: Date) {
  const existing = (await findImported(db, adapterId, [q.externalId])).get(q.externalId);
  if (existing) return { id: existing, existed: true };
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(questions)
      .values({
        title: q.title.slice(0, 200),
        slug: await uniqueSlug(tx, q.title),
        statement: q.statement,
        inputFormat: q.inputFormat,
        outputFormat: q.outputFormat,
        constraints: q.constraints.slice(0, 50),
        samples: q.samples.slice(0, 20),
        notes: q.notes,
        tags: q.tags.map((t) => t.toLowerCase().slice(0, 40)).slice(0, 20),
        rating: q.rating,
        difficulty: q.difficulty,
        timeLimitMs: q.timeLimitMs ?? 2000,
        memoryLimitMb: q.memoryLimitMb ?? 256,
        allowedLanguages: DEFAULT_LANGUAGES,
        referenceSolution: q.referenceSolution,
        status: 'draft',
        practice: false,
        source: { adapter: adapterId, externalId: q.externalId, url: q.url ?? undefined, license: q.license, attribution: q.attribution, importedAt: now.toISOString() },
        authorId,
        createdAt: now,
        updatedAt: now,
        judgeDataUpdatedAt: now,
      })
      .returning({ id: questions.id });
    if (q.tests.length) {
      await tx.insert(testCases).values(
        q.tests.map((t, position) => ({ questionId: created!.id, position, input: t.input, expectedOutput: t.output, hidden: true, createdAt: now, updatedAt: now })),
      );
    }
    return { id: created!.id, existed: false };
  });
}

