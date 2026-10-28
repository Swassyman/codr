import { VERDICT_LABELS, type TestVerdict } from '../../shared/types';
import { cn } from '../lib/cn';

const tone: Record<TestVerdict, string> = {
  AC: 'bg-ok-soft text-ok',
  WA: 'bg-bad-soft text-bad',
  TLE: 'bg-warn-soft text-warn',
  MLE: 'bg-mle-soft text-mle',
  OLE: 'bg-mle-soft text-mle',
  RE: 'bg-re-soft text-re',
  CE: 'bg-ce-soft text-ce',
  IE: 'bg-ce-soft text-ce',
  SK: 'bg-raised text-ink-3',
};

export function VerdictBadge({ verdict, long, className }: { verdict: string; long?: boolean; className?: string }) {
  const v = (verdict in VERDICT_LABELS ? verdict : 'IE') as TestVerdict;
  return (
    <span
      title={VERDICT_LABELS[v]}
      className={cn('inline-flex h-6 items-center rounded px-1.5 font-mono text-xs font-semibold tracking-wide', tone[v], className)}
    >
      {v}
      {long && <span className="ml-1.5 font-sans font-medium tracking-normal">{VERDICT_LABELS[v]}</span>}
    </span>
  );
}

export function formatMs(ms: number | null | undefined) {
  if (ms == null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatKb(kb: number | null | undefined) {
  if (kb == null) return '—';
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
