import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { VERDICT_LABELS, type TestVerdict } from '../../../shared/types';
import type { SubmissionDTO, TestResultDTO } from '../../../shared/api';
import { cn } from '../../lib/cn';
import { useLanguageLabel } from '../../lib/runtimes';
import { formatWhen } from '../../lib/format';
import { useServerNow } from '../../lib/server-time';
import { Spinner } from '../ui';
import { VerdictBadge, formatKb, formatMs } from '../verdict';

const cellTone: Record<string, string> = {
  AC: 'bg-ok',
  WA: 'bg-bad',
  TLE: 'bg-warn',
  MLE: 'bg-mle',
  OLE: 'bg-mle',
  RE: 'bg-re',
  CE: 'bg-ce',
  IE: 'bg-ce',
  SK: 'bg-line-strong',
};

/** One cell per judged case, in judging order: a compact picture of the whole run. */
export function TestStrip({ results }: { results: TestResultDTO[] }) {
  return (
    <ol className="flex flex-wrap gap-1" aria-label="Results per test">
      {results.map((r) => {
        const label = `${r.label}: ${VERDICT_LABELS[r.verdict as TestVerdict] ?? r.verdict}${r.timeMs != null ? `, ${formatMs(r.timeMs)}` : ''}`;
        return (
          <li key={r.index} title={label} aria-label={label} className={cn('flex h-5 min-w-5 items-center justify-center rounded-[3px] px-1 font-mono text-[10px] leading-none font-semibold text-white', cellTone[r.verdict] ?? 'bg-ce')}>
            {r.sample ? `E${r.label.replace(/\D/g, '')}` : r.label.replace(/\D/g, '')}
          </li>
        );
      })}
    </ol>
  );
}

function StatusCell({ s }: { s: SubmissionDTO }) {
  if (s.status === 'queued') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
        <Spinner className="size-3.5" /> Queued{s.queuePosition ? ` #${s.queuePosition}` : ''}
      </span>
    );
  }
  if (s.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
        <Spinner className="size-3.5" /> Judging
      </span>
    );
  }
  return <VerdictBadge verdict={s.verdict ?? 'IE'} />;
}

function Detail({ s }: { s: SubmissionDTO }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line bg-well px-4 py-3">
      {s.verdict === 'CE' && s.compileOutput ? (
        <pre className="max-h-64 overflow-auto rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs whitespace-pre-wrap text-bad">{s.compileOutput}</pre>
      ) : s.results ? (
        <>
          <TestStrip results={s.results} />
          <table className="w-full max-w-2xl text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-1 pr-3 font-medium">Case</th>
                <th className="py-1 pr-3 font-medium">Verdict</th>
                <th className="py-1 pr-3 text-right font-medium">Time</th>
                <th className="py-1 pr-3 text-right font-medium">Memory</th>
                <th className="py-1 text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody>
              {s.results.map((r) => (
                <tr key={r.index} className="border-t border-line">
                  <td className="py-1 pr-3">
                    {r.label}
                    {r.hidden && <span className="ml-1.5 text-xs text-ink-3">hidden</span>}
                    {r.message && r.verdict === 'WA' && <span className="block text-xs text-ink-3">{r.message}</span>}
                  </td>
                  <td className="py-1 pr-3">
                    <VerdictBadge verdict={r.verdict} />
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatMs(r.timeMs)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatKb(r.memoryKb)}</td>
                  <td className="py-1 text-right tabular-nums text-ink-2">{r.sample ? '—' : `${r.points} / ${r.maxPoints}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="text-sm text-ink-2">This contest shows a summary only: {s.passed} of {s.total} cases passed.</p>
      )}
      {s.withheld && <p className="text-sm text-ink-2">Hidden tests are judged now; their results appear after the contest ends for you.</p>}
    </div>
  );
}

export function SubmissionsPanel({ submissions, loading, limit }: { submissions: SubmissionDTO[]; loading: boolean; limit?: { used: number; max: number } | null }) {
  const now = useServerNow(30_000);
  const languageLabel = useLanguageLabel();
  const [open, setOpen] = useState<number | null>(null);
  const latest = submissions[0];
  const expanded = open ?? (latest && latest.status === 'done' ? latest.id : null);

  if (loading) return <div className="p-4"><Spinner /></div>;
  return (
    <div className="h-full min-h-0 overflow-auto">
      {limit && (
        <p className="border-b border-line px-4 py-2 text-xs text-ink-3 tabular-nums">
          {limit.used} of {limit.max} submissions used
        </p>
      )}
      {submissions.length === 0 ? (
        <p className="p-4 text-sm text-ink-3">Nothing submitted yet. Submitting judges your code on every test, including hidden ones.</p>
      ) : (
        <ul>
          {submissions.map((s) => {
            const isOpen = expanded === s.id;
            return (
              <li key={s.id} className="border-b border-line">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : s.id)}
                  className="grid w-full grid-cols-[16px_minmax(88px,auto)_1fr_auto] items-center justify-items-start gap-3 px-4 py-2.5 text-left hover:bg-raised"
                >
                  <ChevronRight className={cn('size-4 text-ink-3 transition-transform', isOpen && 'rotate-90')} />
                  <StatusCell s={s} />
                  <span className="flex min-w-0 flex-wrap gap-x-4 text-sm text-ink-2 tabular-nums">
                    {s.status === 'done' && (
                      <>
                        <span className="font-medium text-ink">{s.score != null ? `${s.score} / ${s.maxScore}` : 'Score after the contest'}</span>
                        <span>
                          {s.passed} of {s.total} passed
                        </span>
                        <span>{formatMs(s.timeMs)}</span>
                        <span>{formatKb(s.memoryKb)}</span>
                      </>
                    )}
                    <span className="text-ink-3">{languageLabel(s.language)}</span>
                    {s.isAuto && <span className="text-ink-3">sent when time ran out</span>}
                  </span>
                  <span className="text-xs text-ink-3">{formatWhen(s.receivedAt, now)}</span>
                </button>
                {isOpen && s.status === 'done' && <Detail s={s} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
