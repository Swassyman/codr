import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LANGUAGES, type LanguageId } from '../../../shared/languages';
import type { RunnerStatusDTO } from '../../../shared/api';
import { api, errorMessage } from '../../lib/api';
import { useRun } from '../../lib/runs';
import { AppShell } from '../../components/AppShell';
import { Button, ErrorNote, Notice, PageHeader, Spinner } from '../../components/ui';
import { VerdictBadge, formatKb, formatMs } from '../../components/verdict';

const setupText: Record<string, string> = {
  disabled: 'Automatic install is off (RUNNER_AUTO_INSTALL=false).',
  waiting: 'Waiting for the runner to start…',
  checking: 'Checking installed languages…',
  installing: 'Installing language packages…',
  ready: 'All configured languages are installed.',
  error: 'Setup stopped with an error.',
};

function LanguageCheck({ language, runId }: { language: LanguageId; runId: number | null }) {
  const run = useRun(runId);
  const result = run.data?.results[0];
  const passed = result && result.execution.status === 'ok' && result.execution.stdout.trim() === 'hello codr';
  return (
    <tr className="border-t border-line">
      <td className="py-2.5 pr-4 font-medium">{LANGUAGES[language].label}</td>
      <td className="py-2.5 pr-4">
        {runId == null ? (
          <span className="text-ink-3">Not checked</span>
        ) : !result ? (
          <span className="inline-flex items-center gap-2 text-ink-2">
            <Spinner /> {run.data?.status === 'queued' ? 'Queued' : 'Running'}
          </span>
        ) : passed ? (
          <VerdictBadge verdict="AC" long />
        ) : (
          <VerdictBadge verdict={result.verdict ?? 'WA'} long />
        )}
      </td>
      <td className="py-2.5 pr-4 font-mono text-xs text-ink-2">{result ? (result.execution.stdout.trim() || result.execution.compileOutput || result.execution.message || '—').slice(0, 120) : ''}</td>
      <td className="py-2.5 pr-4 text-right tabular-nums text-ink-2">{result ? formatMs(result.execution.timeMs) : ''}</td>
      <td className="py-2.5 text-right tabular-nums text-ink-2">{result ? formatKb(result.execution.memoryKb) : ''}</td>
    </tr>
  );
}

export default function RunnerPage() {
  const status = useQuery({
    queryKey: ['admin-runner'],
    queryFn: () => api.get<RunnerStatusDTO>('/api/admin/runner'),
    refetchInterval: 3000,
  });
  const [runs, setRuns] = useState<Partial<Record<LanguageId, number>>>({});
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const installed = status.data?.runtimes ?? [];

  const checkAll = async () => {
    setCheckError(null);
    setChecking(true);
    try {
      const entries = await Promise.all(
        installed.map(async (rt) => {
          const run = await api.post<{ id: number }>('/api/runs', { language: rt.language, code: LANGUAGES[rt.language].hello, input: 'codr\n' });
          return [rt.language, run.id] as const;
        }),
      );
      setRuns(Object.fromEntries(entries));
    } catch (err) {
      setCheckError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const s = status.data;
  return (
    <AppShell>
      <PageHeader
        title="Code runner"
        description="Every program runs in the sandboxed runner container, never in the web server."
        actions={
          <Button variant="primary" onClick={checkAll} loading={checking} disabled={installed.length === 0}>
            Check all languages
          </Button>
        }
      />
      {status.isPending ? (
        <Spinner />
      ) : status.error ? (
        <ErrorNote>{errorMessage(status.error)}</ErrorNote>
      ) : s ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            {checkError && <ErrorNote>{checkError}</ErrorNote>}
            {installed.length === 0 ? (
              <Notice>No languages are installed yet. {s.setup ? setupText[s.setup.state] : ''}</Notice>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-3">
                    <th className="pb-2 font-medium">Language</th>
                    <th className="pb-2 font-medium">Result</th>
                    <th className="pb-2 font-medium">Output</th>
                    <th className="pb-2 text-right font-medium">Time</th>
                    <th className="pb-2 text-right font-medium">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {installed.map((rt) => (
                    <LanguageCheck key={rt.language} language={rt.language} runId={runs[rt.language] ?? null} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <dl className="grid h-fit grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm">
            <dt className="text-ink-3">Engine</dt>
            <dd className="capitalize">{s.engine}</dd>
            <dt className="text-ink-3">Status</dt>
            <dd className={s.reachable ? 'text-ok' : 'text-bad'}>{s.reachable ? 'Reachable' : 'Unreachable'}</dd>
            <dt className="text-ink-3">Setup</dt>
            <dd>
              {s.setup ? setupText[s.setup.state] : 'Managed outside Codr.'}
              {s.setup?.installing && <span className="block text-ink-3">Now: {s.setup.installing}</span>}
              {s.setup?.error && <span className="block text-bad">{s.setup.error}</span>}
            </dd>
            <dt className="text-ink-3">Versions</dt>
            <dd>
              {installed.map((rt) => (
                <span key={rt.language} className="block">
                  {LANGUAGES[rt.language].label} <span className="text-ink-3">{rt.version}</span>
                </span>
              ))}
            </dd>
            <dt className="text-ink-3">Queue</dt>
            <dd className="tabular-nums">
              {s.queue.runs} runs, {s.queue.submissions} submissions
            </dd>
            <dt className="text-ink-3">Slots</dt>
            <dd className="tabular-nums">
              {s.pool.active} of {s.pool.size} busy{s.pool.waiting ? `, ${s.pool.waiting} waiting` : ''}
            </dd>
          </dl>
        </div>
      ) : null}
    </AppShell>
  );
}
