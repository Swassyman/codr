import { describe, expect, it } from 'vitest';
import { CLOCK_CRITICAL_MS, CLOCK_LOW_MS, FORCED_CLOCK_LEVELS, clockLevel, timerVisibility } from '../../src/web/lib/timer';

describe('clock levels', () => {
  it('turns low at five minutes, critical at one, over at zero', () => {
    expect(CLOCK_LOW_MS).toBe(5 * 60_000);
    expect(CLOCK_CRITICAL_MS).toBe(60_000);
    expect(clockLevel(CLOCK_LOW_MS + 1)).toBe('calm');
    expect(clockLevel(CLOCK_LOW_MS)).toBe('low');
    expect(clockLevel(CLOCK_CRITICAL_MS + 1)).toBe('low');
    expect(clockLevel(CLOCK_CRITICAL_MS)).toBe('critical');
    expect(clockLevel(1)).toBe('critical');
    expect(clockLevel(0)).toBe('over');
    expect(clockLevel(-5000)).toBe('over');
  });
});

describe('timer visibility', () => {
  const base = { level: 'calm' as const, alwaysShow: false, pinned: false, revealed: false };

  it('is hidden by default', () => {
    expect(timerVisibility(base)).toEqual({ visible: false, forced: false });
    expect(timerVisibility({ ...base, level: 'low' })).toEqual({ visible: false, forced: false });
  });

  it('shows while hovered or focused, and while pinned', () => {
    expect(timerVisibility({ ...base, revealed: true }).visible).toBe(true);
    expect(timerVisibility({ ...base, pinned: true }).visible).toBe(true);
  });

  it('always shows with the setting on', () => {
    expect(timerVisibility({ ...base, alwaysShow: true })).toEqual({ visible: true, forced: false });
  });

  it('is forced into view in the last minute and after time is up, whatever the choice', () => {
    expect(FORCED_CLOCK_LEVELS).toEqual(['critical', 'over']);
    expect(timerVisibility({ ...base, level: clockLevel(CLOCK_CRITICAL_MS) })).toEqual({ visible: true, forced: true });
    expect(timerVisibility({ ...base, level: clockLevel(0) })).toEqual({ visible: true, forced: true });
    expect(timerVisibility({ ...base, level: clockLevel(CLOCK_CRITICAL_MS + 1) })).toEqual({ visible: false, forced: false });
  });
});
