/**
 * Contest timing and question-lock rules, as pure functions of server
 * timestamps. The API calls these with the request's arrival time; the client
 * only uses them to render state the server already decided.
 */

export type TimingMode = 'per_question' | 'fixed_window' | 'personal_window';

export interface ContestTiming {
  startsAt: Date;
  /** fixed_window / per_question: the contest closes. personal_window: entry cutoff. */
  endsAt: Date;
  timingMode: TimingMode;
  /** personal_window: minutes each participant gets from their own entry. */
  durationMinutes: number | null;
  /** per_question: default minutes per question. */
  defaultQuestionMinutes: number | null;
  viewOnce: boolean;
  sequential: boolean;
}

export interface ParticipantTiming {
  enteredAt: Date | null;
  finishedAt: Date | null;
}

export interface QuestionSlot {
  questionId: number;
  /** 0-based order within the contest. */
  position: number;
  /** per_question: overrides the contest default. */
  durationMinutes: number | null;
  firstViewedAt: Date | null;
  leftAt: Date | null;
}

export type LockReason =
  | 'not_started'
  | 'not_entered'
  | 'entry_closed'
  | 'contest_ended'
  | 'time_up'
  | 'finished'
  | 'question_expired'
  | 'question_left'
  | 'sequential'
  | 'not_opened';

export const LOCK_MESSAGES: Record<LockReason, string> = {
  not_started: 'The contest has not started yet.',
  not_entered: 'Start the contest before opening questions.',
  entry_closed: 'Entry to this contest has closed.',
  contest_ended: 'The contest has ended.',
  time_up: 'Your time for this contest is up.',
  finished: 'You finished this contest.',
  question_expired: "This question's timer ran out.",
  question_left: 'You moved on from this question, so it is locked.',
  sequential: 'Questions open in order. Open the earlier ones first.',
  not_opened: 'Open this question before working on it.',
};

const MINUTE = 60_000;

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MINUTE);
const earliest = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

/** When contest-level participation ends. Null until a personal-window participant enters. */
export function participantDeadline(contest: ContestTiming, participant: ParticipantTiming | null): Date | null {
  if (contest.timingMode !== 'personal_window') return contest.endsAt;
  if (!participant?.enteredAt) return null;
  return addMinutes(participant.enteredAt, contest.durationMinutes ?? 0);
}

/** The last moment anyone can still be working (personal windows run past the cutoff). */
export function contestFinalEnd(contest: ContestTiming): Date {
  return contest.timingMode === 'personal_window' ? addMinutes(contest.endsAt, contest.durationMinutes ?? 0) : contest.endsAt;
}

export function questionMinutes(contest: ContestTiming, slot: Pick<QuestionSlot, 'durationMinutes'>): number | null {
  return slot.durationMinutes ?? contest.defaultQuestionMinutes ?? null;
}

/**
 * Deadline for work on one question. In per-question mode the timer starts at
 * first view and is cut short by the contest end; before first view it is null.
 */
export function questionDeadline(contest: ContestTiming, participant: ParticipantTiming | null, slot: QuestionSlot): Date | null {
  if (contest.timingMode !== 'per_question') return participantDeadline(contest, participant);
  if (!slot.firstViewedAt) return null;
  const minutes = questionMinutes(contest, slot);
  return minutes == null ? contest.endsAt : earliest(addMinutes(slot.firstViewedAt, minutes), contest.endsAt);
}

/** Why the participant as a whole cannot act right now, or null if they can. */
export function participationLock(contest: ContestTiming, participant: ParticipantTiming | null, now: Date): LockReason | null {
  const t = now.getTime();
  if (t < contest.startsAt.getTime()) return 'not_started';
  if (!participant?.enteredAt) {
    if (t >= contest.endsAt.getTime()) return contest.timingMode === 'personal_window' ? 'entry_closed' : 'contest_ended';
    return 'not_entered';
  }
  if (participant.finishedAt && participant.finishedAt.getTime() <= t) return 'finished';
  const deadline = participantDeadline(contest, participant)!;
  if (t >= deadline.getTime()) return contest.timingMode === 'personal_window' ? 'time_up' : 'contest_ended';
  return null;
}

/** Whether pressing "Start" is allowed now. */
export function canEnter(contest: ContestTiming, participant: ParticipantTiming | null, now: Date): { ok: true } | { ok: false; reason: LockReason } {
  if (participant?.enteredAt) {
    const lock = participationLock(contest, participant, now);
    return lock ? { ok: false, reason: lock } : { ok: true };
  }
  const t = now.getTime();
  if (t < contest.startsAt.getTime()) return { ok: false, reason: 'not_started' };
  if (t >= contest.endsAt.getTime()) {
    return { ok: false, reason: contest.timingMode === 'personal_window' ? 'entry_closed' : 'contest_ended' };
  }
  return { ok: true };
}

/**
 * - `open`: view the statement (may start a per-question timer and, in
 *   view-once mode, lock the question the participant is leaving).
 * - `work`: run, submit or save a draft; the question must already be open.
 */
export type QuestionAction = 'open' | 'work';

export interface AccessDecision {
  ok: boolean;
  reason: LockReason | null;
  /** When work on this question must stop (null if not running yet). */
  deadline: Date | null;
}

export function questionAccess(params: {
  contest: ContestTiming;
  participant: ParticipantTiming | null;
  slots: QuestionSlot[];
  questionId: number;
  now: Date;
  action: QuestionAction;
}): AccessDecision {
  const { contest, participant, slots, questionId, now, action } = params;
  const slot = slots.find((s) => s.questionId === questionId);
  if (!slot) throw new Error(`question ${questionId} is not in this contest`);
  const deny = (reason: LockReason, deadline: Date | null = null): AccessDecision => ({ ok: false, reason, deadline });

  const lock = participationLock(contest, participant, now);
  if (lock) return deny(lock, participantDeadline(contest, participant));

  if (contest.viewOnce && slot.leftAt) return deny('question_left', slot.leftAt);

  if (slot.firstViewedAt) {
    const deadline = questionDeadline(contest, participant, slot);
    if (deadline && now.getTime() >= deadline.getTime()) return deny('question_expired', deadline);
    return { ok: true, reason: null, deadline };
  }

  if (action === 'work') return deny('not_opened');
  if (contest.sequential) {
    const skipped = slots.some((s) => s.position < slot.position && !s.firstViewedAt);
    if (skipped) return deny('sequential');
  }
  // Opening now: in per-question mode the timer would start at `now`.
  const deadline =
    contest.timingMode === 'per_question'
      ? questionDeadline(contest, participant, { ...slot, firstViewedAt: now })
      : participantDeadline(contest, participant);
  return { ok: true, reason: null, deadline };
}

/** State changes implied by opening a question (apply only if access was granted). */
export function openEffects(contest: ContestTiming, slots: QuestionSlot[], questionId: number) {
  const slot = slots.find((s) => s.questionId === questionId);
  return {
    firstView: !slot?.firstViewedAt,
    /** View-once: every other open question is left (locked) now. */
    leave: contest.viewOnce
      ? slots.filter((s) => s.questionId !== questionId && s.firstViewedAt && !s.leftAt).map((s) => s.questionId)
      : [],
  };
}

/** Lock state of every question, for the navigator. */
export function slotStates(contest: ContestTiming, participant: ParticipantTiming | null, slots: QuestionSlot[], now: Date) {
  return slots.map((slot) => {
    const decision = questionAccess({ contest, participant, slots, questionId: slot.questionId, now, action: 'open' });
    return { questionId: slot.questionId, ...decision };
  });
}

/**
 * True once this participant can no longer change anything in the contest:
 * used to reveal hidden-test results "after the contest".
 */
export function participationOver(contest: ContestTiming, participant: ParticipantTiming | null, slots: QuestionSlot[], now: Date) {
  const lock = participationLock(contest, participant, now);
  if (lock && lock !== 'not_started' && lock !== 'not_entered') return true;
  if (lock === 'not_entered') return false;
  if (contest.timingMode === 'per_question' && slots.length > 0) {
    return slots.every((slot) => {
      if (contest.viewOnce && slot.leftAt) return true;
      const d = questionDeadline(contest, participant, slot);
      return d != null && now.getTime() >= d.getTime();
    });
  }
  return false;
}

export type ContestPhase = 'upcoming' | 'live' | 'ended';

/** Phase for listings: live means "open for entry" in personal-window mode. */
export function contestPhase(contest: Pick<ContestTiming, 'startsAt' | 'endsAt'>, now: Date): ContestPhase {
  if (now.getTime() < contest.startsAt.getTime()) return 'upcoming';
  if (now.getTime() < contest.endsAt.getTime()) return 'live';
  return 'ended';
}

/** When the public leaderboard stops updating (null = never frozen). */
export function leaderboardFreezeAt(contest: ContestTiming, freezeMinutes: number | null): Date | null {
  if (!freezeMinutes) return null;
  return addMinutes(contestFinalEnd(contest), -freezeMinutes);
}
