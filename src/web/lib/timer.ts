// Contest clock levels and when the clock may be hidden. Display only: the
// server enforces every deadline, whatever the clock shows.

export type ClockLevel = 'calm' | 'low' | 'critical' | 'over';

/** At or under this the clock turns amber (and the fuse with it). */
export const CLOCK_LOW_MS = 5 * 60_000;
/** At or under this the clock turns red and can no longer be hidden. */
export const CLOCK_CRITICAL_MS = 60_000;

export function clockLevel(remainingMs: number): ClockLevel {
  if (remainingMs <= 0) return 'over';
  if (remainingMs <= CLOCK_CRITICAL_MS) return 'critical';
  if (remainingMs <= CLOCK_LOW_MS) return 'low';
  return 'calm';
}

/**
 * Levels at which a hidden clock is shown regardless of the participant's
 * choice: the last minute (CLOCK_CRITICAL_MS) and after time is up, so nobody
 * is surprised by the deadline. Before that the amber fuse is the warning.
 */
export const FORCED_CLOCK_LEVELS: readonly ClockLevel[] = ['critical', 'over'];

export interface TimerVisibilityInput {
  level: ClockLevel;
  /** The "always show timer" editor setting. */
  alwaysShow: boolean;
  /** Clicked (or Enter/Space) open; stays until toggled again. */
  pinned: boolean;
  /** Pointer hovering it, or keyboard focus on it. */
  revealed: boolean;
}

export function timerVisibility({ level, alwaysShow, pinned, revealed }: TimerVisibilityInput): { visible: boolean; forced: boolean } {
  const forced = FORCED_CLOCK_LEVELS.includes(level);
  return { visible: forced || alwaysShow || pinned || revealed, forced };
}
