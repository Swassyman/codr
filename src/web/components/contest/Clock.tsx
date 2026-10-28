import { useEffect, useRef } from 'react';
import { Timer } from 'lucide-react';
import { formatClock } from '../../lib/format';
import { useServerNow } from '../../lib/server-time';
import { cn } from '../../lib/cn';

export type ClockLevel = 'calm' | 'low' | 'critical' | 'over';

export function clockLevel(remainingMs: number): ClockLevel {
  if (remainingMs <= 0) return 'over';
  if (remainingMs <= 60_000) return 'critical';
  if (remainingMs <= 5 * 60_000) return 'low';
  return 'calm';
}

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

/** The fuse: a thin bar along the top edge that burns down as time runs out. */
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

export function ContestClock({ deadline, label, onExpire }: { deadline: string | null; label: string; onExpire?: () => void }) {
  const remaining = useRemaining(deadline, onExpire);
  if (remaining == null) return null;
  const level = clockLevel(remaining);
  return (
    <div
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-md px-2.5 font-mono text-[15px] font-semibold tabular-nums',
        level === 'calm' && 'text-ink',
        level === 'low' && 'bg-warn-soft text-warn',
        (level === 'critical' || level === 'over') && 'bg-bad-soft text-bad',
      )}
      role="timer"
      aria-label={`${label}: ${formatClock(remaining)} left`}
      title={label}
    >
      <Timer className="size-4" aria-hidden />
      {remaining > 0 ? formatClock(remaining) : '00:00'}
    </div>
  );
}
