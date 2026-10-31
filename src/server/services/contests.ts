import { randomInt } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db';
import {
  contestQuestions,
  contests,
  integrityEvents,
  participantQuestions,
  participants,
  questions,
  submissions,
  users,
  type Contest,
} from '../db/schema';
import { contestFinalEnd, leaderboardFreezeAt } from '../../shared/timing';
import { timingOf } from './contest-state';

// Unambiguous characters only: no 0/O, 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateJoinCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** "k7q2 mx4p", "K7Q2MX4P" and "K7Q2-MX4P" all mean the same code. */
export function normalizeJoinCode(input: string) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

export async function uniqueJoinCode(db: DbOrTx) {
  for (;;) {
    const code = generateJoinCode();
    const [clash] = await db.select({ id: contests.id }).from(contests).where(eq(contests.joinCode, code)).limit(1);
    if (!clash) return code;
  }
}

export interface ConfigProblem {
  path: string;
  message: string;
}

/** Cross-field checks that a single field's schema cannot express. */
export async function contestProblems(db: DbOrTx, contest: Contest): Promise<ConfigProblem[]> {
  const problems: ConfigProblem[] = [];
  if (contest.endsAt.getTime() <= contest.startsAt.getTime()) {
    problems.push({ path: 'endsAt', message: contest.timingMode === 'personal_window' ? 'The entry cutoff must be after the start.' : 'The end must be after the start.' });
  }
  if (contest.timingMode === 'personal_window' && !contest.durationMinutes) {
    problems.push({ path: 'durationMinutes', message: 'Set how many minutes each participant gets.' });
  }
  const items = await db
    .select({ title: questions.title, status: questions.status, durationMinutes: contestQuestions.durationMinutes })
    .from(contestQuestions)
    .innerJoin(questions, eq(questions.id, contestQuestions.questionId))
    .where(eq(contestQuestions.contestId, contest.id));
  if (items.length === 0) problems.push({ path: 'questions', message: 'Add at least one question.' });
  const drafts = items.filter((i) => i.status !== 'published').map((i) => i.title);
  if (drafts.length) problems.push({ path: 'questions', message: `Publish these questions first: ${drafts.join(', ')}.` });
  if (contest.timingMode === 'per_question' && !contest.defaultQuestionMinutes && items.some((i) => !i.durationMinutes)) {
    problems.push({ path: 'defaultQuestionMinutes', message: 'Set a default time per question, or a time for every question.' });
  }
  return problems;
}

/**
 * Settings that shape the experience and cannot change once the contest is
 * running. Autocomplete is among them: switching it mid-contest would treat
 * participants differently depending on when they worked.
 */
export const LOCKED_AFTER_START = ['timingMode', 'durationMinutes', 'defaultQuestionMinutes', 'viewOnce', 'sequential', 'startsAt', 'autocomplete'] as const;

export const hasStarted = (c: Contest, now: Date) => c.status === 'published' && now.getTime() >= c.startsAt.getTime();

// ---------------------------------------------------------------- Standings

export interface QuestionStanding {
  questionId: number;
  score: number;
  maxScore: number;
  attempts: number;
  solved: boolean;
  bestAt: string | null;
  penalty: number;
}

export interface StandingRow {
  rank: number;
  participantId: number;
  userId: number;
  displayName: string;
  username: string;
  isGuest: boolean;
  score: number;
  penalty: number;
  lastBestAt: string | null;
  questions: QuestionStanding[];
}

/**
 * Standings aggregated from judged submissions. With `cutoff`, only
 * submissions received before it count (leaderboard freeze).
 */
export async function computeStandings(db: DbOrTx, contest: Contest, cutoff: Date | null = null): Promise<StandingRow[]> {
  const items = await db
    .select({ questionId: contestQuestions.questionId, points: contestQuestions.points, questionPoints: questions.points })
    .from(contestQuestions)
    .innerJoin(questions, eq(questions.id, contestQuestions.questionId))
    .where(eq(contestQuestions.contestId, contest.id))
    .orderBy(asc(contestQuestions.position));
  const people = await db
    .select({ p: participants, displayName: users.displayName, username: users.username, isGuest: users.isGuest })
    .from(participants)
    .innerJoin(users, eq(users.id, participants.userId))
    .where(eq(participants.contestId, contest.id));
  if (people.length === 0) return [];
  const subs = await db
    .select({
      userId: submissions.userId,
      questionId: submissions.questionId,
      score: submissions.score,
      verdict: submissions.verdict,
      receivedAt: submissions.receivedAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.contestId, contest.id),
        eq(submissions.status, 'done'),
        cutoff ? sql`${submissions.receivedAt} < ${cutoff}` : undefined,
      ),
    )
    .orderBy(asc(submissions.receivedAt), asc(submissions.id));
  const views = await db
    .select()
    .from(participantQuestions)
    .where(inArray(participantQuestions.participantId, people.map((x) => x.p.id)));

  const rows: StandingRow[] = people.map(({ p, displayName, username, isGuest }) => {
    const mine = subs.filter((s) => s.userId === p.userId);
    let lastBest: Date | null = null;
    const perQuestion = items.map((item) => {
      const maxScore = item.points ?? item.questionPoints;
      const judged = mine.filter((s) => s.questionId === item.questionId && s.verdict !== 'CE' && s.verdict !== 'IE');
      const best = judged.reduce((m, s) => Math.max(m, s.score ?? 0), 0);
      const firstBest = best > 0 ? judged.find((s) => (s.score ?? 0) === best) : undefined;
      let penalty = 0;
      if (firstBest && contest.penaltyMinutes != null) {
        const start =
          contest.timingMode === 'personal_window'
            ? p.enteredAt
            : contest.timingMode === 'per_question'
              ? (views.find((v) => v.participantId === p.id && v.questionId === item.questionId)?.firstViewedAt ?? contest.startsAt)
              : contest.startsAt;
        const wrongBefore = judged.filter((s) => s.receivedAt < firstBest.receivedAt && (s.score ?? 0) < best).length;
        penalty = Math.max(0, Math.floor((firstBest.receivedAt.getTime() - (start ?? contest.startsAt).getTime()) / 60_000)) + wrongBefore * contest.penaltyMinutes;
      }
      if (firstBest && (!lastBest || firstBest.receivedAt > lastBest)) lastBest = firstBest.receivedAt;
      return {
        questionId: item.questionId,
        score: best,
        maxScore,
        attempts: judged.length,
        solved: best > 0 && best >= maxScore,
        bestAt: firstBest?.receivedAt.toISOString() ?? null,
        penalty,
      };
    });
    return {
      rank: 0,
      participantId: p.id,
      userId: p.userId,
      displayName,
      username,
      isGuest,
      score: Math.round(perQuestion.reduce((sum, q) => sum + q.score, 0) * 100) / 100,
      penalty: perQuestion.reduce((sum, q) => sum + q.penalty, 0),
      lastBestAt: (lastBest as Date | null)?.toISOString() ?? null,
      questions: perQuestion,
    };
  });

  rows.sort(
    (a, b) =>
      b.score - a.score ||
      a.penalty - b.penalty ||
      (a.lastBestAt ?? '9').localeCompare(b.lastBestAt ?? '9') ||
      a.displayName.localeCompare(b.displayName),
  );
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && prev.score === row.score && prev.penalty === row.penalty ? prev.rank : i + 1;
  });
  return rows;
}

/** The leaderboard's freeze point for non-staff viewers right now, if any. */
export function activeFreeze(contest: Contest, now: Date): Date | null {
  const freezeAt = leaderboardFreezeAt(timingOf(contest), contest.leaderboardFreezeMinutes);
  if (!freezeAt) return null;
  const end = contestFinalEnd(timingOf(contest));
  return now >= freezeAt && now < end ? freezeAt : null;
}

export async function integrityCounts(db: DbOrTx, contestId: number) {
  const rows = await db
    .select({
      userId: integrityEvents.userId,
      type: integrityEvents.type,
      n: sql<number>`count(*)::int`,
      chars: sql<number>`coalesce(sum((${integrityEvents.detail}->>'chars')::int), 0)::int`,
    })
    .from(integrityEvents)
    .where(eq(integrityEvents.contestId, contestId))
    .groupBy(integrityEvents.userId, integrityEvents.type);
  const byUser = new Map<number, { blurs: number; pastes: number; pastedChars: number }>();
  for (const r of rows) {
    const entry = byUser.get(r.userId) ?? { blurs: 0, pastes: 0, pastedChars: 0 };
    if (r.type === 'blur') entry.blurs += r.n;
    if (r.type === 'paste') {
      entry.pastes += r.n;
      entry.pastedChars += r.chars;
    }
    byUser.set(r.userId, entry);
  }
  return byUser;
}
