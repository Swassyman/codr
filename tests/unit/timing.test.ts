import { describe, expect, it } from 'vitest';
import {
  canEnter,
  contestFinalEnd,
  contestPhase,
  leaderboardFreezeAt,
  openEffects,
  participantDeadline,
  participationOver,
  questionAccess,
  questionDeadline,
  type ContestTiming,
  type ParticipantTiming,
  type QuestionSlot,
} from '../../src/shared/timing';

const T = (hhmmss: string) => new Date(`2030-03-01T${hhmmss}Z`);
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);

const contest = (over: Partial<ContestTiming> = {}): ContestTiming => ({
  startsAt: T('10:00:00'),
  endsAt: T('12:00:00'),
  timingMode: 'fixed_window',
  durationMinutes: null,
  defaultQuestionMinutes: null,
  viewOnce: false,
  sequential: false,
  ...over,
});

const entered = (at = T('10:05:00'), finishedAt: Date | null = null): ParticipantTiming => ({ enteredAt: at, finishedAt });

const slots = (n: number, over: Partial<QuestionSlot>[] = []): QuestionSlot[] =>
  Array.from({ length: n }, (_, i) => ({ questionId: i + 1, position: i, durationMinutes: null, firstViewedAt: null, leftAt: null, ...over[i] }));

const access = (c: ContestTiming, p: ParticipantTiming | null, s: QuestionSlot[], questionId: number, now: Date, action: 'open' | 'work' = 'open') =>
  questionAccess({ contest: c, participant: p, slots: s, questionId, now, action });

describe('whole-contest fixed window', () => {
  const c = contest();

  it('refuses everything before the start', () => {
    expect(canEnter(c, null, T('09:59:59'))).toEqual({ ok: false, reason: 'not_started' });
    expect(access(c, entered(), slots(1), 1, T('09:59:59')).reason).toBe('not_started');
  });

  it('requires entering before opening questions', () => {
    expect(access(c, { enteredAt: null, finishedAt: null }, slots(1), 1, T('10:30:00')).reason).toBe('not_entered');
  });

  it('gives everyone the same end, enforced exactly at the deadline', () => {
    const s = slots(1, [{ firstViewedAt: T('10:10:00') }]);
    expect(participantDeadline(c, entered())).toEqual(T('12:00:00'));
    expect(access(c, entered(), s, 1, ms(T('12:00:00'), -1), 'work')).toMatchObject({ ok: true, deadline: T('12:00:00') });
    expect(access(c, entered(), s, 1, T('12:00:00'), 'work')).toMatchObject({ ok: false, reason: 'contest_ended' });
  });

  it('decides only from the server timestamp it is given', () => {
    // A submission that reached the server 1 ms before the end is on time, however late it is processed.
    const s = slots(1, [{ firstViewedAt: T('10:10:00') }]);
    const receivedAt = ms(T('12:00:00'), -1);
    expect(access(c, entered(), s, 1, receivedAt, 'work').ok).toBe(true);
    expect(access(c, entered(), s, 1, ms(receivedAt, 2), 'work').ok).toBe(false);
  });

  it('cannot be entered after it ends', () => {
    expect(canEnter(c, null, T('12:00:00'))).toEqual({ ok: false, reason: 'contest_ended' });
  });

  it('locks everything once the participant finishes early', () => {
    const s = slots(2, [{ firstViewedAt: T('10:10:00') }]);
    const p = entered(T('10:05:00'), T('11:00:00'));
    expect(access(c, p, s, 1, T('11:00:00'), 'work').reason).toBe('finished');
    expect(access(c, p, s, 2, T('11:30:00')).reason).toBe('finished');
  });
});

describe('whole-contest personal window', () => {
  const c = contest({ timingMode: 'personal_window', durationMinutes: 90 });

  it('starts the clock at the participant’s own entry', () => {
    expect(participantDeadline(c, entered(T('11:00:00')))).toEqual(T('12:30:00'));
    expect(participantDeadline(c, null)).toBeNull();
  });

  it('keeps the full duration even past the entry cutoff', () => {
    const p = entered(T('11:59:00'));
    const s = slots(1, [{ firstViewedAt: T('11:59:30') }]);
    expect(access(c, p, s, 1, T('13:00:00'), 'work').ok).toBe(true);
    expect(access(c, p, s, 1, T('13:29:00'), 'work').ok).toBe(false);
  });

  it('refuses entry after the hard cutoff', () => {
    expect(canEnter(c, null, T('12:00:00'))).toEqual({ ok: false, reason: 'entry_closed' });
    expect(access(c, { enteredAt: null, finishedAt: null }, slots(1), 1, T('12:00:01')).reason).toBe('entry_closed');
  });

  it('ends at entry + duration (time_up), and reopening the browser changes nothing', () => {
    const p = entered(T('10:00:00'));
    const s = slots(1, [{ firstViewedAt: T('10:01:00') }]);
    // The state is a pure function of stored timestamps, so a reload sees the same deadline.
    expect(access(c, p, s, 1, T('11:29:59'), 'work').ok).toBe(true);
    expect(access(c, p, s, 1, T('11:30:00'), 'work').reason).toBe('time_up');
    expect(canEnter(c, p, T('11:30:00'))).toEqual({ ok: false, reason: 'time_up' });
  });

  it('reports the last possible end for the whole contest', () => {
    expect(contestFinalEnd(c)).toEqual(T('13:30:00'));
  });
});

describe('per-question timer', () => {
  const c = contest({ timingMode: 'per_question', defaultQuestionMinutes: 20 });

  it('starts when the question is first opened', () => {
    const s = slots(2);
    const decision = access(c, entered(), s, 1, T('10:10:00'));
    expect(decision).toMatchObject({ ok: true, deadline: T('10:30:00') });
    expect(questionDeadline(c, entered(), s[0]!)).toBeNull();
  });

  it('expires after its own duration and locks the question', () => {
    const s = slots(2, [{ firstViewedAt: T('10:10:00') }]);
    expect(access(c, entered(), s, 1, T('10:29:59'), 'work').ok).toBe(true);
    expect(access(c, entered(), s, 1, T('10:30:00'), 'work')).toMatchObject({ ok: false, reason: 'question_expired', deadline: T('10:30:00') });
    expect(access(c, entered(), s, 1, T('10:31:00'), 'open').reason).toBe('question_expired');
  });

  it('lets the participant move on to the next question afterwards', () => {
    const s = slots(2, [{ firstViewedAt: T('10:10:00') }]);
    expect(access(c, entered(), s, 2, T('10:31:00'))).toMatchObject({ ok: true, deadline: T('10:51:00') });
  });

  it('uses per-question overrides', () => {
    const s = slots(2, [{ firstViewedAt: T('10:10:00'), durationMinutes: 5 }]);
    expect(questionDeadline(c, entered(), s[0]!)).toEqual(T('10:15:00'));
  });

  it('is cut short by the contest end', () => {
    const s = slots(1, [{ firstViewedAt: T('11:50:00') }]);
    expect(questionDeadline(c, entered(), s[0]!)).toEqual(T('12:00:00'));
    expect(access(c, entered(), s, 1, T('12:00:00'), 'work').reason).toBe('contest_ended');
  });

  it('timers run independently once started', () => {
    const s = slots(2, [{ firstViewedAt: T('10:00:00') }, { firstViewedAt: T('10:10:00') }]);
    expect(access(c, entered(), s, 1, T('10:25:00'), 'work').reason).toBe('question_expired');
    expect(access(c, entered(), s, 2, T('10:25:00'), 'work').ok).toBe(true);
  });

  it('is over once every question is locked', () => {
    const s = slots(2, [{ firstViewedAt: T('10:00:00') }, { firstViewedAt: T('10:05:00') }]);
    expect(participationOver(c, entered(), s, T('10:24:00'))).toBe(false);
    expect(participationOver(c, entered(), s, T('10:25:00'))).toBe(true);
  });
});

describe('view-once', () => {
  const c = contest({ viewOnce: true });

  it('locks the question you leave when you open another', () => {
    const s = slots(3, [{ firstViewedAt: T('10:10:00') }]);
    expect(openEffects(c, s, 2)).toEqual({ firstView: true, leave: [1] });
  });

  it('refuses re-entry, statement and submissions for a left question', () => {
    const s = slots(2, [{ firstViewedAt: T('10:10:00'), leftAt: T('10:20:00') }, { firstViewedAt: T('10:20:00') }]);
    for (const action of ['open', 'work'] as const) {
      expect(access(c, entered(), s, 1, T('10:21:00'), action)).toMatchObject({ ok: false, reason: 'question_left' });
    }
  });

  it('treats a refresh, new tab or new device as the same view', () => {
    // Opening the question that is already open changes nothing and locks nothing.
    const s = slots(2, [{ firstViewedAt: T('10:10:00') }]);
    expect(access(c, entered(), s, 1, T('10:40:00')).ok).toBe(true);
    expect(openEffects(c, s, 1)).toEqual({ firstView: false, leave: [] });
  });

  it('never locks anything without view-once', () => {
    const plain = contest();
    const s = slots(2, [{ firstViewedAt: T('10:10:00') }]);
    expect(openEffects(plain, s, 2).leave).toEqual([]);
    expect(access(plain, entered(), s, 1, T('10:30:00')).ok).toBe(true);
  });
});

describe('sequential only', () => {
  const c = contest({ sequential: true });

  it('refuses skipping ahead', () => {
    expect(access(c, entered(), slots(3), 2, T('10:10:00')).reason).toBe('sequential');
    expect(access(c, entered(), slots(3, [{ firstViewedAt: T('10:06:00') }]), 3, T('10:10:00')).reason).toBe('sequential');
  });

  it('allows the next one and going back when not view-once', () => {
    const s = slots(3, [{ firstViewedAt: T('10:06:00') }, { firstViewedAt: T('10:09:00') }]);
    expect(access(c, entered(), s, 3, T('10:10:00')).ok).toBe(true);
    expect(access(c, entered(), s, 1, T('10:10:00')).ok).toBe(true);
  });

  it('combines with view-once into a strict one-way path', () => {
    const strict = contest({ sequential: true, viewOnce: true });
    const s = slots(3, [{ firstViewedAt: T('10:06:00') }]);
    expect(openEffects(strict, s, 2).leave).toEqual([1]);
    const after = slots(3, [{ firstViewedAt: T('10:06:00'), leftAt: T('10:09:00') }, { firstViewedAt: T('10:09:00') }]);
    expect(access(strict, entered(), after, 1, T('10:10:00')).reason).toBe('question_left');
    expect(access(strict, entered(), after, 3, T('10:10:00')).ok).toBe(true);
  });
});

describe('work requires an opened question', () => {
  it('refuses runs and submissions for a question never opened', () => {
    expect(access(contest(), entered(), slots(2), 2, T('10:10:00'), 'work').reason).toBe('not_opened');
  });
});

describe('listing helpers', () => {
  it('derives the contest phase', () => {
    const c = contest();
    expect(contestPhase(c, T('09:00:00'))).toBe('upcoming');
    expect(contestPhase(c, T('10:00:00'))).toBe('live');
    expect(contestPhase(c, T('12:00:00'))).toBe('ended');
  });

  it('computes the leaderboard freeze from the final end', () => {
    expect(leaderboardFreezeAt(contest(), 30)).toEqual(T('11:30:00'));
    expect(leaderboardFreezeAt(contest({ timingMode: 'personal_window', durationMinutes: 60 }), 15)).toEqual(T('12:45:00'));
    expect(leaderboardFreezeAt(contest(), null)).toBeNull();
  });
});
