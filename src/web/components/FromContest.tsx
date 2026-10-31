import type { PracticeQuestionDTO } from '../../shared/api';
import { cn } from '../lib/cn';

/** "from Spring Round" (and "+2" when the question was in several finished contests). */
export function FromContest({ contests, className }: { contests: PracticeQuestionDTO['fromContests']; className?: string }) {
  const [latest, ...rest] = contests;
  if (!latest) return null;
  return (
    <span
      className={cn('inline-flex h-5 max-w-64 items-center rounded bg-raised px-1.5 text-xs text-ink-2', className)}
      title={contests.map((c) => c.name).join(', ')}
    >
      <span className="truncate">from {latest.name}</span>
      {rest.length > 0 && <span className="ml-1 text-ink-3 tabular-nums">+{rest.length}</span>}
    </span>
  );
}
