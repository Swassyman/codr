import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Clock } from '../clock';
import type { DB } from '../db';
import { drafts, participantQuestions, questions, submissions } from '../db/schema';
import type { EventBus } from '../events';
import type { JobWorker } from '../jobs/worker';
import { allowedLanguages } from './workspace';
import { createSubmission } from './submissions';

interface DueRow extends Record<string, unknown> {
  participantId: number;
  questionId: number;
  userId: number;
  contestId: number;
  viewOnce: boolean;
  leftAt: Date | null;
  finishedAt: Date | null;
  contestLanguages: string[];
  deadline: Date;
}

/**
 * Per-question timers: when a question's time runs out, the participant's
 * code at that moment (the last draft the server received before the
 * deadline) is submitted automatically, stamped with the deadline itself.
 * Access checks never depend on this running on time; it only does the
 * auto-submit and tells the browser.
 */
export class ExpiryScheduler {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly ctx: { db: DB; clock: Clock; events: EventBus; worker: JobWorker; log: Logger }) {}

  start(intervalMs = 1000) {
    this.timer = setInterval(() => void this.tick().catch((err) => this.ctx.log.error({ err }, 'expiry tick failed')), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const { db, clock } = this.ctx;
      const now = clock.now();
      const due = await db.execute<DueRow>(sql`
        WITH timed AS (
          SELECT pq.participant_id AS "participantId", pq.question_id AS "questionId",
                 p.user_id AS "userId", p.contest_id AS "contestId", c.view_once AS "viewOnce",
                 pq.left_at AS "leftAt", p.finished_at AS "finishedAt", c.allowed_languages AS "contestLanguages",
                 CASE WHEN COALESCE(cq.duration_minutes, c.default_question_minutes) IS NULL THEN c.ends_at
                      ELSE LEAST(pq.first_viewed_at + make_interval(mins => COALESCE(cq.duration_minutes, c.default_question_minutes)), c.ends_at)
                 END AS "deadline"
          FROM participant_questions pq
          JOIN participants p ON p.id = pq.participant_id
          JOIN contests c ON c.id = p.contest_id
          JOIN contest_questions cq ON cq.contest_id = c.id AND cq.question_id = pq.question_id
          WHERE c.timing_mode = 'per_question' AND c.status = 'published' AND pq.expiry_processed_at IS NULL
        )
        SELECT * FROM timed WHERE "deadline" <= ${now} ORDER BY "deadline" LIMIT 200`);
      let processed = 0;
      for (const row of due.rows) {
        if (await this.expire(row, now)) processed++;
      }
      return processed;
    } finally {
      this.busy = false;
    }
  }

  private async expire(row: DueRow, now: Date) {
    const { db, events, worker } = this.ctx;
    const deadline = new Date(row.deadline);
    const result = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(participantQuestions)
        .set({ expiryProcessedAt: now })
        .where(
          and(
            eq(participantQuestions.participantId, row.participantId),
            eq(participantQuestions.questionId, row.questionId),
            isNull(participantQuestions.expiryProcessedAt),
          ),
        )
        .returning({ participantId: participantQuestions.participantId });
      if (claimed.length === 0) return null;
      // Nothing to send if they had already moved on (view-once) or finished.
      const leftEarlier = row.viewOnce && row.leftAt && new Date(row.leftAt) <= deadline;
      const finishedEarlier = row.finishedAt && new Date(row.finishedAt) <= deadline;
      if (leftEarlier || finishedEarlier) return { submitted: null };

      const [draft] = await tx
        .select()
        .from(drafts)
        .where(and(eq(drafts.userId, row.userId), eq(drafts.contestId, row.contestId), eq(drafts.questionId, row.questionId), sql`${drafts.updatedAt} <= ${deadline}`))
        .orderBy(desc(drafts.updatedAt))
        .limit(1);
      if (!draft || !draft.code.trim()) return { submitted: null };
      const [q] = await tx.select({ allowedLanguages: questions.allowedLanguages, functionSpec: questions.functionSpec }).from(questions).where(eq(questions.id, row.questionId));
      if (!q || !allowedLanguages(q, (row.contestLanguages ?? []) as never).includes(draft.language)) return { submitted: null };

      // Skip if the same code was already submitted.
      const [latest] = await tx
        .select({ code: submissions.code, language: submissions.language })
        .from(submissions)
        .where(and(eq(submissions.userId, row.userId), eq(submissions.contestId, row.contestId), eq(submissions.questionId, row.questionId)))
        .orderBy(desc(submissions.id))
        .limit(1);
      if (latest && latest.code === draft.code && latest.language === draft.language) return { submitted: null };

      const sub = await createSubmission(tx, {
        userId: row.userId,
        contestId: row.contestId,
        questionId: row.questionId,
        language: draft.language,
        code: draft.code,
        receivedAt: deadline,
        isAuto: true,
        idempotencyKey: `auto-${row.participantId}-${row.questionId}`,
      });
      return { submitted: sub.id };
    });
    if (!result) return false;
    events.publish(row.userId, { type: 'contest', contestId: row.contestId, reason: 'question_expired', questionId: row.questionId });
    if (result.submitted) {
      events.publish(row.userId, { type: 'submission', submissionId: result.submitted, questionId: row.questionId, contestId: row.contestId, status: 'queued' });
      worker.notify();
    }
    return true;
  }
}
