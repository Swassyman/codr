import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Timer } from 'lucide-react';
import { formatClock } from '../../lib/format';
import { useServerNow } from '../../lib/server-time';
import { clockLevel, timerVisibility, type ClockLevel } from '../../lib/timer';
import { cn } from '../../lib/cn';

export { clockLevel, type ClockLevel };

/**
 * Remaining time against the server clock. Display only: the server enforces
 * every deadline. Calls onExpire once when it reaches zero.
 */
export function useRemaining(deadline: string | null, onExpire?: () => void) {
  const now = useServerNow(500);
  const remaining = deadline ? Date.parse(deadline) - now : null;
  const fired = useRef<string | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  useEffect(() => {
    if (deadline && remaining != null && remaining <= 0 && fired.current !== deadline) {
      fired.current = deadline;
      onExpireRef.current?.();
    }
  }, [deadline, remaining]);
  return remaining;
}

/**
 * Calls onExpire when the deadline passes, and renders nothing. The solve page
 * keeps this mounted so expiry never depends on where (or whether) the clock
 * is shown: the clock moves between the header and the zen bar.
 */
export function DeadlineWatcher({ deadline, onExpire }: { deadline: string | null; onExpire: () => void }) {
  useRemaining(deadline, onExpire);
  return null;
}

/** The fuse: a thin bar along the top edge that burns down as time runs out. It flashes in the last minute. */
export function Fuse({ start, deadline }: { start: string | null; deadline: string | null }) {
  const now = useServerNow(1000);
  if (!deadline || !start) return <div className="h-[3px] shrink-0 bg-transparent" aria-hidden />;
  const total = Date.parse(deadline) - Date.parse(start);
  const left = Date.parse(deadline) - now;
  const fraction = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const level = clockLevel(left);
  return (
    <div className="h-[3px] shrink-0 bg-line" aria-hidden>
      <div className="fuse h-full" data-level={level === 'calm' ? undefined : level === 'low' ? 'low' : 'critical'} style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}

const faceTone: Record<ClockLevel, string> = {
  calm: 'text-ink',
  low: 'bg-warn-soft text-warn',
  critical: 'bg-bad-soft text-bad',
  over: 'bg-bad-soft text-bad',
};
const face = 'inline-flex h-8 items-center gap-2 rounded-md px-2.5 font-mono text-[15px] font-semibold tabular-nums';

export function ContestClock({ deadline, label, onExpire }: { deadline: string | null; label: string; onExpire?: () => void }) {
  const remaining = useRemaining(deadline, onExpire);
  if (remaining == null) return null;
  return (
    <div className={cn(face, faceTone[clockLevel(remaining)])} role="timer" aria-label={`${label}: ${formatClock(remaining)} left`} title={label}>
      <Timer className="size-4" aria-hidden />
      {remaining > 0 ? formatClock(remaining) : '00:00'}
    </div>
  );
}

// Pinned open stays pinned for this page visit, across questions and zen.
let pinned = false;
const pinListeners = new Set<() => void>();
const pinStore = {
  subscribe(l: () => void) {
    pinListeners.add(l);
    return () => pinListeners.delete(l);
  },
  get: () => pinned,
  toggle() {
    pinned = !pinned;
    pinListeners.forEach((l) => l());
  },
};

/**
 * The clock while working on a question: hidden behind a dimmed placeholder
 * unless "always show timer" is on. Hovering (or keyboard focus) reveals it,
 * clicking or Enter/Space pins it open, and in the last minute it shows
 * whatever the choice (FORCED_CLOCK_LEVELS). Expiry is handled by the page
 * (DeadlineWatcher), not here.
 */
export function QuestionClock({ deadline, label, alwaysShow }: { deadline: string | null; label: string; alwaysShow: boolean }) {
  const remaining = useRemaining(deadline);
  const isPinned = useSyncExternalStore(pinStore.subscribe, pinStore.get);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  if (remaining == null) return null;
  const level = clockLevel(remaining);
  const { visible, forced } = timerVisibility({ level, alwaysShow, pinned: isPinned, revealed: hovered || focused });
  const time = remaining > 0 ? formatClock(remaining) : '00:00';

  if (alwaysShow) return <ContestClock deadline={deadline} label={label} />;
  return (
    <>
      <button
        type="button"
        className={cn(
          face,
          'cursor-pointer transition-colors',
          visible ? faceTone[level] : 'text-ink-3 hover:bg-raised',
          forced && 'clock-forced',
        )}
        // Hover reveals on devices that can hover; a tap goes straight to pinning.
        onPointerEnter={(e) => e.pointerType !== 'touch' && setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={(e) => setFocused(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => setFocused(false)}
        onClick={pinStore.toggle}
        aria-pressed={isPinned}
        aria-label={visible ? `${label}: ${time} left` : `${label}: hidden`}
        title={forced ? `${label}: shown in the last minute` : isPinned ? 'Timer pinned. Click to hide it again.' : 'Hover to see the time, click to keep it visible'}
        data-clock-state={forced ? 'forced' : visible ? 'shown' : 'hidden'}
      >
        <Timer className="size-4" aria-hidden />
        {/* The placeholder keeps the width, so revealing the time doesn't shift the bar. */}
        <span aria-hidden className={cn(!visible && 'opacity-60')}>
          {visible ? time : '··:··'}
        </span>
      </button>
      {/* Announced once when the last minute forces the clock into view. */}
      <span className="sr-only" aria-live="polite">
        {forced && remaining > 0 ? `Less than a minute left. ${label}.` : ''}
      </span>
    </>
  );
}
