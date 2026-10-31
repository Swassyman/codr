import { describe, expect, it } from 'vitest';
import { isPracticeVisible, type PracticeContestRef } from '../../src/server/services/practice';

const at = (iso: string) => new Date(iso);
const now = at('2030-01-15T10:00:00Z');

const question = (over: Partial<{ status: 'draft' | 'published'; practice: boolean; practiceHidden: boolean }> = {}) => ({
  status: 'published' as const,
  practice: false,
  practiceHidden: false,
  ...over,
});

const contest = (endsAt: string, over: Partial<PracticeContestRef> = {}): PracticeContestRef => ({
  status: 'published',
  endsAt: at(endsAt),
  timingMode: 'fixed_window',
  durationMinutes: null,
  ...over,
});

const ended = contest('2030-01-15T09:00:00Z');
const running = contest('2030-01-15T12:00:00Z');
const upcoming = contest('2030-01-20T12:00:00Z');

describe('practice visibility', () => {
  it('lists practice questions that are in no contest', () => {
    expect(isPracticeVisible(question({ practice: true }), [], now)).toBe(true);
    expect(isPracticeVisible(question({ practice: false }), [], now)).toBe(false);
  });

  it('never lists drafts or questions kept out of practice', () => {
    expect(isPracticeVisible(question({ practice: true, status: 'draft' }), [ended], now)).toBe(false);
    expect(isPracticeVisible(question({ practice: true, practiceHidden: true }), [], now)).toBe(false);
    expect(isPracticeVisible(question({ practiceHidden: true }), [ended], now)).toBe(false);
  });

  it('lists every question of a finished contest, practice flag or not', () => {
    expect(isPracticeVisible(question(), [ended], now)).toBe(true);
    expect(isPracticeVisible(question({ practice: true }), [ended], now)).toBe(true);
  });

  it('hides questions of running and upcoming contests, even practice ones', () => {
    for (const c of [running, upcoming]) {
      expect(isPracticeVisible(question(), [c], now)).toBe(false);
      expect(isPracticeVisible(question({ practice: true }), [c], now)).toBe(false);
    }
  });

  it('waits for every published contest containing the question to finish', () => {
    expect(isPracticeVisible(question(), [ended, running], now)).toBe(false);
    expect(isPracticeVisible(question(), [ended, upcoming], now)).toBe(false);
    expect(isPracticeVisible(question(), [ended, contest('2030-01-14T00:00:00Z')], now)).toBe(true);
  });

  it('ignores draft contests: they neither hide a question nor make it practice material', () => {
    const draftRunning = { ...running, status: 'draft' as const };
    const draftEnded = { ...ended, status: 'draft' as const };
    expect(isPracticeVisible(question({ practice: true }), [draftRunning], now)).toBe(true);
    expect(isPracticeVisible(question(), [draftEnded], now)).toBe(false);
    expect(isPracticeVisible(question(), [ended, draftRunning], now)).toBe(true);
  });

  it('keeps personal-window questions hidden until the last window can close', () => {
    // Entry closed at 09:00, but someone who entered at 08:59 works until 10:29.
    const personal = contest('2030-01-15T09:00:00Z', { timingMode: 'personal_window', durationMinutes: 90 });
    expect(isPracticeVisible(question(), [personal], now)).toBe(false);
    expect(isPracticeVisible(question(), [personal], at('2030-01-15T10:29:59Z'))).toBe(false);
    expect(isPracticeVisible(question(), [personal], at('2030-01-15T10:30:00Z'))).toBe(true);
  });

  it('treats the end time itself as finished (the same boundary as contest phases)', () => {
    expect(isPracticeVisible(question(), [contest('2030-01-15T10:00:00Z')], now)).toBe(true);
    expect(isPracticeVisible(question(), [contest('2030-01-15T10:00:00.001Z')], now)).toBe(false);
  });
});
