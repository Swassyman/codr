import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { draftSchema, idempotencyKeySchema, solveRunSchema, submitSchema } from '../../shared/schemas';
import type { PracticeQuestionDTO, SubmissionDTO } from '../../shared/api';
import { questions, runs, submissions } from '../db/schema';
import { badRequest, forbidden, notFound, parse } from '../lib/errors';
import { requireUser } from '../auth/guards';
import { FULL_VISIBILITY, createSubmission, loadDrafts, queuePosition, saveDraft, toSubmissionDTO } from '../services/submissions';
import { allowedLanguages, assertLanguage, toWorkspace, userKey } from '../services/workspace';

const slugParams = z.object({ slug: z.string().min(1).max(96) });

/**
 * A question is in the practice bank when it is published, marked for
 * practice, and not part of a published contest that has not finished yet
 * (so practice can never leak a live contest's questions).
 */
const practiceVisible = (now: Date) => sql`
  ${questions.status} = 'published' AND ${questions.practice} = true AND NOT EXISTS (
    SELECT 1 FROM contest_questions cq JOIN contests c ON c.id = cq.contest_id
    WHERE cq.question_id = ${questions.id} AND c.status = 'published'
      AND (CASE WHEN c.timing_mode = 'personal_window'
                THEN c.ends_at + make_interval(mins => coalesce(c.duration_minutes, 0))
                ELSE c.ends_at END) > ${now}
  )`;

export async function practiceRoutes(app: FastifyInstance) {
  const { db, runner, worker, config } = app.services;

  const practiceUser = (req: FastifyRequest) => {
    const user = requireUser(req);
    if (user.isGuest) throw forbidden('guest_practice', 'Practice needs an account. Guests can only take part in their contest.');
    return user;
  };

  const loadPracticeQuestion = async (req: FastifyRequest) => {
    const { slug } = parse(slugParams, req.params);
    const [q] = await db.select().from(questions).where(and(eq(questions.slug, slug), practiceVisible(req.receivedAt)));
    if (!q) throw notFound('This question is not in the practice bank.');
    return q;
  };

  app.get('/api/practice/questions', async (req): Promise<{ questions: PracticeQuestionDTO[] }> => {
    const user = practiceUser(req);
    const { search } = parse(z.object({ search: z.string().trim().max(100).optional() }), req.query);
    const rows = await db
      .select({
        q: questions,
        solved: sql<boolean>`exists (select 1 from ${submissions} s where s.question_id = ${questions.id} and s.user_id = ${user.id} and s.contest_id is null and s.verdict = 'AC')`,
        attempted: sql<boolean>`exists (select 1 from ${submissions} s where s.question_id = ${questions.id} and s.user_id = ${user.id} and s.contest_id is null)`,
      })
      .from(questions)
      .where(
        and(
          practiceVisible(req.receivedAt),
          search ? or(ilike(questions.title, `%${search}%`), sql`${search} = ANY(${questions.tags})`) : undefined,
        ),
      )
      .orderBy(asc(questions.rating), asc(questions.title));
    return {
      questions: rows.map(({ q, solved, attempted }) => ({
        id: q.id,
        slug: q.slug,
        title: q.title,
        difficulty: q.difficulty,
        rating: q.rating,
        tags: q.tags,
        solved,
        attempted,
      })),
    };
  });

  app.get('/api/practice/questions/:slug', async (req) => {
    const user = practiceUser(req);
    const q = await loadPracticeQuestion(req);
    return toWorkspace(q, allowedLanguages(q), await loadDrafts(db, user.id, null, q.id), q.points);
  });

  app.put('/api/practice/questions/:slug/draft', { config: { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    const user = practiceUser(req);
    const q = await loadPracticeQuestion(req);
    const body = parse(draftSchema, req.body);
    await saveDraft(db, { userId: user.id, contestId: null, questionId: q.id, language: body.language, code: body.code, now: req.receivedAt });
    return { savedAt: req.receivedAt.toISOString() };
  });

  app.post('/api/practice/questions/:slug/run', { config: { rateLimit: { max: config.RUN_RATE_PER_MINUTE, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    const user = practiceUser(req);
    const q = await loadPracticeQuestion(req);
    const body = parse(solveRunSchema, req.body);
    await assertLanguage(runner, allowedLanguages(q), body.language);
    if (body.mode === 'samples' && q.samples.length === 0) throw badRequest('no_samples', 'This question has no examples. Run it with custom input instead.');
    const [run] = await db
      .insert(runs)
      .values({
        userId: user.id,
        questionId: q.id,
        kind: body.mode,
        language: body.language,
        code: body.code,
        input: body.mode === 'custom' ? body.input : null,
        createdAt: req.receivedAt,
      })
      .returning({ id: runs.id, status: runs.status });
    worker.notify();
    return run;
  });

  app.post('/api/practice/questions/:slug/submit', { config: { rateLimit: { max: config.SUBMIT_RATE_PER_MINUTE, timeWindow: '1 minute', keyGenerator: userKey } } }, async (req) => {
    const user = practiceUser(req);
    const q = await loadPracticeQuestion(req);
    const body = parse(submitSchema, req.body);
    const key = parse(idempotencyKeySchema, req.headers['idempotency-key']);
    await assertLanguage(runner, allowedLanguages(q), body.language);
    const created = await createSubmission(db, {
      userId: user.id,
      contestId: null,
      questionId: q.id,
      language: body.language,
      code: body.code,
      receivedAt: req.receivedAt,
      idempotencyKey: key ?? null,
    });
    await saveDraft(db, { userId: user.id, contestId: null, questionId: q.id, language: body.language, code: body.code, now: req.receivedAt });
    worker.notify();
    return { id: created.id, duplicate: created.duplicate };
  });

  app.get('/api/practice/questions/:slug/submissions', async (req): Promise<{ submissions: SubmissionDTO[] }> => {
    const user = practiceUser(req);
    const q = await loadPracticeQuestion(req);
    const rows = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.userId, user.id), eq(submissions.questionId, q.id), sql`${submissions.contestId} IS NULL`))
      .orderBy(desc(submissions.id))
      .limit(50);
    return { submissions: await Promise.all(rows.map(async (s) => toSubmissionDTO(s, { ...FULL_VISIBILITY, includeCode: false }, await queuePosition(db, s)))) };
  });
}
