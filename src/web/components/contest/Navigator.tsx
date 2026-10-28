import { Check, Lock } from 'lucide-react';
import type { ContestQuestionStateDTO } from '../../../shared/api';
import { cn } from '../../lib/cn';

const stateText: Record<ContestQuestionStateDTO['state'], string> = {
  open: 'open now',
  available: 'not opened yet',
  locked: 'locked',
  waiting: 'not available yet',
};

export function isSolved(q: ContestQuestionStateDTO) {
  return q.bestScore != null && q.points > 0 && q.bestScore >= q.points;
}

/** Lettered question tiles; locked and waiting questions are visibly disabled. */
export function Navigator({
  questions,
  activeId,
  onSelect,
}: {
  questions: ContestQuestionStateDTO[];
  activeId: number | null;
  onSelect: (q: ContestQuestionStateDTO) => void;
}) {
  return (
    <nav aria-label="Questions" className="flex items-center gap-1">
      {questions.map((q) => {
        const disabled = q.state === 'locked' || q.state === 'waiting';
        // A locked question stays visibly locked even when its URL is open.
        const active = q.questionId === activeId && !disabled;
        const here = q.questionId === activeId;
        const solved = isSolved(q);
        return (
          <button
            key={q.questionId}
            type="button"
            disabled={disabled || here}
            onClick={() => onSelect(q)}
            aria-current={here ? 'page' : undefined}
            aria-label={`Question ${q.letter}: ${q.title}, ${solved ? 'solved' : stateText[q.state]}${q.reason && disabled ? `. ${q.reason}` : ''}`}
            title={`${q.letter}. ${q.title}${q.reason && disabled ? ` (${q.reason})` : ''}`}
            className={cn(
              'relative inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border px-2 font-mono text-sm font-semibold transition-colors',
              active && 'border-accent bg-accent text-on-accent',
              !active && !disabled && 'border-line-strong bg-surface text-ink hover:border-accent hover:text-accent',
              q.state === 'locked' && !active && 'cursor-not-allowed border-dashed border-line bg-raised text-ink-3',
              q.state === 'waiting' && !active && 'cursor-not-allowed border-line bg-surface text-ink-3 opacity-60',
              here && disabled && 'ring-2 ring-line-strong ring-offset-1 ring-offset-surface',
            )}
          >
            {q.letter}
            {q.state === 'locked' && !active && <Lock className="size-3" aria-hidden />}
            {solved && !active && <Check className="size-3 text-ok" aria-hidden />}
          </button>
        );
      })}
    </nav>
  );
}
