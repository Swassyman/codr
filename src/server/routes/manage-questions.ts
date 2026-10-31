import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, ilike, inArray, max, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_LANGUAGES } from '../../shared/languages';
import {
  applyOutputsSchema,
  publishSchema,
  questionCreateSchema,
  questionPatchSchema,
  referenceRunSchema,
  testCasePatchSchema,
  testsBulkSchema,
  testsOrderSchema,
} from '../../shared/schemas';
import type { QuestionEditorDTO, QuestionListItemDTO, TestCaseDTO } from '../../shared/api';
import { contestQuestions, contests, questions, runs, testCases, users, type Question, type TestCase } from '../db/schema';
import { badRequest, conflict, idParam, notFound, parse } from '../lib/errors';
import { requireStaff } from '../auth/guards';
import {
  canEditQuestion,
  loadEditableQuestion,
  questionUsage,
  testCount,
  touchJudgeData,
  uniqueSlug,
  validationState,
} from '../services/questions';

/** Fields that change how submissions are judged; editing them makes validation stale. */
const JUDGE_FIELDS = ['timeLimitMs', 'memoryLimitMb', 'languageLimits', 'checker', 'referenceSolution', 'samples', 'scoringMode'] as const;

/** Tests above this size are sent as a preview; the full text is fetched on demand. */
const INLINE_TEST_LIMIT = 256 * 1024;
const PREVIEW = 4 * 1024;

const testParams = z.object({ id: z.coerce.number().int().positive(), testId: z.coerce.number().int().positive() });

export function toTestDTO(t: TestCase): TestCaseDTO {
  const big = t.input.length > INLINE_TEST_LIMIT || t.expectedOutput.length > INLINE_TEST_LIMIT;
  return {
    id: t.id,
    position: t.position,
    input: big ? t.input.slice(0, PREVIEW) : t.input,
    expectedOutput: big ? t.expectedOutput.slice(0, PREVIEW) : t.expectedOutput,
    truncated: big,
    inputSize: t.input.length,
    outputSize: t.expectedOutput.length,
    hidden: t.hidden,
    points: t.points,
    label: t.label,
    groupName: t.groupName,
  };
}

function toEditorDTO(q: Question, extra: { testCount: number; usedIn: number; canEdit: boolean }): QuestionEditorDTO {
  return {
    id: q.id,
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
    languageLimits: q.languageLimits,
    allowedLanguages: q.allowedLanguages,
    starterCode: q.starterCode,
    points: q.points,
    scoringMode: q.scoringMode,
    checker: q.checker,
    referenceSolution: q.referenceSolution,
    status: q.status,
    practice: q.practice,
    practiceHidden: q.practiceHidden,
    source: q.source,
    validation: q.validation,
    validationState: validationState(q),
    updatedAt: q.updatedAt.toISOString(),
    ...extra,
  };
}

export async function manageQuestionRoutes(app: FastifyInstance) {
  const { db, worker } = app.services;

  // ------------------------------------------------------------ Questions

  app.get('/api/manage/questions', async (req): Promise<{ questions: QuestionListItemDTO[] }> => {
    const user = requireStaff(req);
    const query = parse(z.object({ search: z.string().trim().max(100).optional() }), req.query);
    // Creators see their own questions plus everyone's published ones.
    const visible = user.role === 'admin' ? sql`true` : or(eq(questions.authorId, user.id), eq(questions.status, 'published'));
    const search = query.search
      ? or(ilike(questions.title, `%${query.search}%`), ilike(questions.slug, `%${query.search}%`), sql`${query.search} = ANY(${questions.tags})`)
      : sql`true`;
    const rows = await db
      .select({
        q: questions,
        authorName: users.displayName,
        tests: sql<number>`(select count(*)::int from ${testCases} where ${testCases.questionId} = ${questions.id})`,
        usedIn: sql<number>`(select count(*)::int from ${contestQuestions} where ${contestQuestions.questionId} = ${questions.id})`,
      })
      .from(questions)
      .leftJoin(users, eq(users.id, questions.authorId))
      .where(and(visible, search))
      .orderBy(desc(questions.updatedAt))
      .limit(500);
    return {
      questions: rows.map(({ q, authorName, tests, usedIn }) => ({
        id: q.id,
        slug: q.slug,
        title: q.title,
        difficulty: q.difficulty,
        rating: q.rating,
        tags: q.tags,
        status: q.status,
        practice: q.practice,
        practiceHidden: q.practiceHidden,
        testCount: tests,
        usedIn,
        validationState: validationState(q),
        updatedAt: q.updatedAt.toISOString(),
        authorName: authorName ?? null,
        canEdit: canEditQuestion(user, q),
        source: q.source ? { adapter: q.source.adapter, url: q.source.url ?? null } : null,
      })),
    };
  });

  app.post('/api/manage/questions', async (req) => {
    const user = requireStaff(req);
    const body = parse(questionCreateSchema, req.body ?? {});
    const title = body.title?.trim() || 'Untitled question';
    const [created] = await db
      .insert(questions)
      .values({
        title,
        slug: await uniqueSlug(db, title),
        allowedLanguages: DEFAULT_LANGUAGES,
        authorId: user.id,
        createdAt: req.receivedAt,
        updatedAt: req.receivedAt,
        judgeDataUpdatedAt: req.receivedAt,
      })
      .returning({ id: questions.id });
    return { id: created!.id };
  });

  app.get('/api/manage/questions/:id', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const q = await loadEditableQuestion(db, user, id);
    return toEditorDTO(q, { testCount: await testCount(db, id), usedIn: await questionUsage(db, id), canEdit: true });
  });

  /** Statement-only view of any published question (or your own), for the contest builder. */
  app.get('/api/manage/questions/:id/preview', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const [q] = await db.select().from(questions).where(eq(questions.id, id));
    if (!q || (q.status !== 'published' && !canEditQuestion(user, q))) throw notFound('Question not found.');
    return {
      id: q.id,
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
      allowedLanguages: q.allowedLanguages,
      points: q.points,
      testCount: await testCount(db, id),
    };
  });

  /** Autosave target: any subset of fields. */
  app.patch('/api/manage/questions/:id', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const patch = parse(questionPatchSchema, req.body);
    const q = await loadEditableQuestion(db, user, id);
    if (patch.slug && patch.slug !== q.slug) {
      const free = (await uniqueSlug(db, patch.slug, id)) === patch.slug;
      if (!free) throw conflict('slug_taken', 'Another question already uses that slug.', [{ path: 'slug', message: 'Another question already uses that slug.' }]);
    }
    if (patch.checker?.type === 'float' && patch.checker.epsilon == null) patch.checker.epsilon = 1e-6;
    const judgeChanged = JUDGE_FIELDS.some((f) => f in patch);
    const [updated] = await db
      .update(questions)
      .set({ ...patch, updatedAt: req.receivedAt, ...(judgeChanged ? { judgeDataUpdatedAt: req.receivedAt } : {}) })
      .where(eq(questions.id, id))
      .returning();
    return toEditorDTO(updated!, { testCount: await testCount(db, id), usedIn: await questionUsage(db, id), canEdit: true });
  });

  app.delete('/api/manage/questions/:id', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    await loadEditableQuestion(db, user, id);
    if ((await questionUsage(db, id)) > 0) {
      throw conflict('in_use', 'This question is part of a contest. Remove it from the contest first.');
    }
    await db.delete(questions).where(eq(questions.id, id));
    return { ok: true };
  });

  app.post('/api/manage/questions/:id/publish', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const body = parse(publishSchema, req.body ?? {});
    const q = await loadEditableQuestion(db, user, id);
    const problems: { path: string; message: string }[] = [];
    if (!q.title.trim()) problems.push({ path: 'title', message: 'Add a title.' });
    if (!q.statement.trim()) problems.push({ path: 'statement', message: 'Write the problem statement.' });
    if (q.allowedLanguages.length === 0) problems.push({ path: 'allowedLanguages', message: 'Allow at least one language.' });
    if ((await testCount(db, id)) === 0) problems.push({ path: 'tests', message: 'Add at least one test case.' });
    if (problems.length) throw badRequest('not_ready', 'Finish these before publishing.', problems);
    const state = validationState(q);
    if (state !== 'passed' && !body.acknowledgeValidation) {
      const message = {
        missing: 'This question has not been validated against a reference solution.',
        stale: 'Tests or limits changed since the last validation.',
        failed: 'The last validation failed.',
      }[state];
      throw conflict('validation_needed', message, { state });
    }
    await db.update(questions).set({ status: 'published', updatedAt: req.receivedAt }).where(eq(questions.id, id));
    return { ok: true, status: 'published' };
  });

  app.post('/api/manage/questions/:id/unpublish', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    await loadEditableQuestion(db, user, id);
    const [inPublished] = await db
      .select({ id: contests.id, name: contests.name })
      .from(contestQuestions)
      .innerJoin(contests, eq(contests.id, contestQuestions.contestId))
      .where(and(eq(contestQuestions.questionId, id), eq(contests.status, 'published')))
      .limit(1);
    if (inPublished) throw conflict('in_use', `"${inPublished.name}" is published and uses this question. Unpublish the contest first.`);
    await db.update(questions).set({ status: 'draft', updatedAt: req.receivedAt }).where(eq(questions.id, id));
    return { ok: true, status: 'draft' };
  });

  // ------------------------------------------------------------ Test cases

  app.get('/api/manage/questions/:id/tests', async (req): Promise<{ tests: TestCaseDTO[] }> => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    await loadEditableQuestion(db, user, id);
    const rows = await db.select().from(testCases).where(eq(testCases.questionId, id)).orderBy(asc(testCases.position), asc(testCases.id));
    return { tests: rows.map(toTestDTO) };
  });

  /** Appends one or many tests (add row, zip import, paste import). */
  app.post('/api/manage/questions/:id/tests', { bodyLimit: 128 * 1024 * 1024 }, async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const body = parse(testsBulkSchema, req.body);
    await loadEditableQuestion(db, user, id);
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.select({ max: max(testCases.position) }).from(testCases).where(eq(testCases.questionId, id));
      let position = (row?.max ?? -1) + 1;
      const inserted = await tx
        .insert(testCases)
        .values(
          body.tests.map((t) => ({
            questionId: id,
            position: position++,
            input: t.input ?? '',
            expectedOutput: t.expectedOutput ?? '',
            hidden: t.hidden ?? true,
            points: t.points ?? null,
            label: t.label || null,
            groupName: t.groupName || null,
            createdAt: req.receivedAt,
            updatedAt: req.receivedAt,
          })),
        )
        .returning();
      await touchJudgeData(tx, id, req.receivedAt);
      return inserted;
    });
    return { tests: created.map(toTestDTO) };
  });

  app.patch('/api/manage/questions/:id/tests/:testId', { bodyLimit: 40 * 1024 * 1024 }, async (req) => {
    const user = requireStaff(req);
    const { id, testId } = parse(testParams, req.params);
    const patch = parse(testCasePatchSchema, req.body);
    await loadEditableQuestion(db, user, id);
    const [updated] = await db
      .update(testCases)
      .set({ ...patch, label: patch.label === '' ? null : patch.label, groupName: patch.groupName === '' ? null : patch.groupName, updatedAt: req.receivedAt })
      .where(and(eq(testCases.id, testId), eq(testCases.questionId, id)))
      .returning();
    if (!updated) throw notFound('Test case not found.');
    await touchJudgeData(db, id, req.receivedAt);
    return toTestDTO(updated);
  });

  app.delete('/api/manage/questions/:id/tests/:testId', async (req) => {
    const user = requireStaff(req);
    const { id, testId } = parse(testParams, req.params);
    await loadEditableQuestion(db, user, id);
    const deleted = await db.delete(testCases).where(and(eq(testCases.id, testId), eq(testCases.questionId, id))).returning({ id: testCases.id });
    if (deleted.length === 0) throw notFound('Test case not found.');
    await touchJudgeData(db, id, req.receivedAt);
    return { ok: true };
  });

  app.post('/api/manage/questions/:id/tests/:testId/duplicate', async (req) => {
    const user = requireStaff(req);
    const { id, testId } = parse(testParams, req.params);
    await loadEditableQuestion(db, user, id);
    const copy = await db.transaction(async (tx) => {
      const [original] = await tx.select().from(testCases).where(and(eq(testCases.id, testId), eq(testCases.questionId, id)));
      if (!original) throw notFound('Test case not found.');
      await tx
        .update(testCases)
        .set({ position: sql`${testCases.position} + 1` })
        .where(and(eq(testCases.questionId, id), gt(testCases.position, original.position)));
      const [inserted] = await tx
        .insert(testCases)
        .values({
          questionId: id,
          position: original.position + 1,
          input: original.input,
          expectedOutput: original.expectedOutput,
          hidden: original.hidden,
          points: original.points,
          label: original.label ? `${original.label} (copy)`.slice(0, 120) : null,
          groupName: original.groupName,
          createdAt: req.receivedAt,
          updatedAt: req.receivedAt,
        })
        .returning();
      await touchJudgeData(tx, id, req.receivedAt);
      return inserted!;
    });
    return toTestDTO(copy);
  });

  app.put('/api/manage/questions/:id/tests/order', async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const { ids } = parse(testsOrderSchema, req.body);
    await loadEditableQuestion(db, user, id);
    await db.transaction(async (tx) => {
      const existing = await tx.select({ id: testCases.id }).from(testCases).where(eq(testCases.questionId, id));
      const known = new Set(existing.map((t) => t.id));
      if (ids.length !== known.size || new Set(ids).size !== ids.length || !ids.every((t) => known.has(t))) {
        throw badRequest('order_mismatch', 'The test list changed in the meantime. Reload and try again.');
      }
      for (const [position, testId] of ids.entries()) {
        await tx.update(testCases).set({ position }).where(eq(testCases.id, testId));
      }
      await touchJudgeData(tx, id, req.receivedAt);
    });
    return { ok: true };
  });

  /** Full text of a large test, for viewing or downloading. */
  app.get('/api/manage/questions/:id/tests/:testId/raw', async (req, reply) => {
    const user = requireStaff(req);
    const { id, testId } = parse(testParams, req.params);
    const { part } = parse(z.object({ part: z.enum(['input', 'output']) }), req.query);
    await loadEditableQuestion(db, user, id);
    const [t] = await db.select().from(testCases).where(and(eq(testCases.id, testId), eq(testCases.questionId, id)));
    if (!t) throw notFound('Test case not found.');
    reply.header('content-type', 'text/plain; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${t.position + 1}.${part === 'input' ? 'in' : 'out'}"`);
    return part === 'input' ? t.input : t.expectedOutput;
  });

  /** Saves expected outputs the creator accepted from the reference-solution generator. */
  app.post('/api/manage/questions/:id/tests/outputs', { bodyLimit: 128 * 1024 * 1024 }, async (req) => {
    const user = requireStaff(req);
    const { id } = parse(idParam, req.params);
    const { outputs } = parse(applyOutputsSchema, req.body);
    await loadEditableQuestion(db, user, id);
    await db.transaction(async (tx) => {
      const ids = outputs.map((o) => o.testId);
      const owned = await tx.select({ id: testCases.id }).from(testCases).where(and(eq(testCases.questionId, id), inArray(testCases.id, ids)));
      if (owned.length !== new Set(ids).size) throw badRequest('unknown_test', 'Some tests no longer exist. Generate again.');
      for (const o of outputs) {
        await tx.update(testCases).set({ expectedOutput: o.expectedOutput, updatedAt: req.receivedAt }).where(eq(testCases.id, o.testId));
      }
      await touchJudgeData(tx, id, req.receivedAt);
    });
    return { ok: true, updated: outputs.length };
  });

  // ------------------------------------------------------------ Reference solution

  /** Runs the reference solution on every test input; the creator reviews before saving. */
  app.post(
    '/api/manage/questions/:id/generate',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireStaff(req);
      const { id } = parse(idParam, req.params);
      const body = parse(referenceRunSchema, req.body);
      await loadEditableQuestion(db, user, id);
      if ((await testCount(db, id)) === 0) throw badRequest('no_tests', 'Add test inputs first, then generate their outputs.');
      await db
        .update(questions)
        .set({ referenceSolution: body, judgeDataUpdatedAt: req.receivedAt, updatedAt: req.receivedAt })
        .where(eq(questions.id, id));
      const [run] = await db
        .insert(runs)
        .values({ userId: user.id, questionId: id, kind: 'generate', language: body.language, code: body.code, createdAt: req.receivedAt })
        .returning({ id: runs.id });
      worker.notify();
      return { runId: run!.id };
    },
  );

  /** Runs the saved (or given) reference solution against samples and tests and records a report. */
  app.post(
    '/api/manage/questions/:id/validate',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const user = requireStaff(req);
      const { id } = parse(idParam, req.params);
      const body = parse(referenceRunSchema.optional(), req.body && Object.keys(req.body as object).length ? req.body : undefined);
      const q = await loadEditableQuestion(db, user, id);
      let reference = q.referenceSolution;
      if (body) {
        reference = body;
        await db.update(questions).set({ referenceSolution: body, judgeDataUpdatedAt: req.receivedAt, updatedAt: req.receivedAt }).where(eq(questions.id, id));
      }
      if (!reference) throw badRequest('no_reference', 'Add a reference solution first.');
      if ((await testCount(db, id)) === 0 && q.samples.length === 0) throw badRequest('no_tests', 'Add samples or test cases first.');
      const [run] = await db
        .insert(runs)
        .values({ userId: user.id, questionId: id, kind: 'validate', language: reference.language, code: reference.code, createdAt: req.receivedAt })
        .returning({ id: runs.id });
      worker.notify();
      return { runId: run!.id };
    },
  );
}
