import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { LANGUAGES, LANGUAGE_IDS, effectiveLimits, type LanguageId } from '../../../../shared/languages';
import type { QuestionEditorDTO } from '../../../../shared/api';
import type { ValidationReport } from '../../../../shared/types';
import { api, errorMessage } from '../../../lib/api';
import { formatWhen } from '../../../lib/format';
import { useRun } from '../../../lib/runs';
import { useLanguageLabel, useRuntimes } from '../../../lib/runtimes';
import { cn } from '../../../lib/cn';
import { CodeEditor } from '../../../components/CodeEditor';
import { Button, ErrorNote, Notice, Select, Spinner } from '../../../components/ui';
import { VerdictBadge, formatKb, formatMs } from '../../../components/verdict';
import type { TabProps } from './QuestionEditorPage';

function TimeBar({ ms, limit }: { ms: number | null; limit: number }) {
  if (ms == null) return null;
  const ratio = Math.min(1, ms / limit);
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-raised" aria-hidden>
      <div className={cn('h-full rounded-full', ratio > 0.5 ? 'bg-warn' : 'bg-ok')} style={{ width: `${Math.max(2, ratio * 100)}%` }} />
    </div>
  );
}

function Report({ report, stale }: { report: ValidationReport; stale: boolean }) {
  const languageLabel = useLanguageLabel();
  const slow = report.maxTimeMs != null && report.maxTimeMs > report.timeLimitMs * 0.5;
  return (
    <div className="flex flex-col gap-3">
      <div className={cn('flex items-start gap-3 rounded-lg border px-4 py-3', report.ok ? 'border-ok/30 bg-ok-soft' : 'border-bad/30 bg-bad-soft')}>
        {report.ok ? <CircleCheck className="mt-0.5 size-5 text-ok" /> : <CircleX className="mt-0.5 size-5 text-bad" />}
        <div className="text-sm">
          <p className="font-medium text-ink">
            {report.ok ? 'The reference solution passes every case.' : `${report.cases.filter((c) => c.verdict !== 'AC').length} of ${report.cases.length} cases failed.`}
          </p>
          <p className="text-ink-2">
            {languageLabel(report.language)}, slowest case {formatMs(report.maxTimeMs)} of a {formatMs(report.timeLimitMs)} limit. Ran {formatWhen(report.ranAt, Date.now())}.
          </p>
        </div>
      </div>
      {stale && (
        <Notice className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-warn" /> Tests, limits or the reference changed since this run. Validate again before publishing.
        </Notice>
      )}
      {slow && report.ok && (
        <Notice className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-warn" /> The reference solution uses more than half the time limit. Slower but correct solutions in other languages may time out.
        </Notice>
      )}
      <div className="max-h-[480px] overflow-auto rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-raised text-left text-xs text-ink-3">
            <tr>
              <th className="px-3 py-1.5 font-medium">Case</th>
              <th className="px-3 py-1.5 font-medium">Verdict</th>
              <th className="px-3 py-1.5 text-right font-medium">Time</th>
              <th className="px-3 py-1.5" />
              <th className="px-3 py-1.5 text-right font-medium">Memory</th>
            </tr>
          </thead>
          <tbody>
            {report.cases.map((c, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-1.5">
                  {c.label}
                  {c.message && c.verdict !== 'AC' && <span className="block text-xs text-ink-3">{c.message}</span>}
                </td>
                <td className="px-3 py-1.5">
                  <VerdictBadge verdict={c.verdict} />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMs(c.timeMs)}</td>
                <td className="px-3 py-1.5">
                  <TimeBar ms={c.timeMs} limit={report.timeLimitMs} />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{formatKb(c.memoryKb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ValidateTab({ questionId, values, update, meta, flush }: TabProps & { questionId: number; meta: QuestionEditorDTO; flush: () => Promise<void> }) {
  const qc = useQueryClient();
  const runtimes = useRuntimes();
  const languageLabel = useLanguageLabel();
  const reference = values.referenceSolution;
  const language: LanguageId = reference?.language ?? values.allowedLanguages.find((l) => runtimes.installed.has(l)) ?? 'cpp';
  const code = reference?.code ?? '';
  const [runId, setRunId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const run = useRun(runId);
  const running = runId != null && run.data?.status !== 'done' && run.data?.status !== 'failed';

  useEffect(() => {
    if (run.data?.status === 'done') void qc.invalidateQueries({ queryKey: ['question', questionId] });
  }, [run.data?.status, qc, questionId]);

  const validate = async () => {
    setError(null);
    setStarting(true);
    try {
      await flush();
      const res = await api.post<{ runId: number }>(`/api/manage/questions/${questionId}/validate`, code.trim() ? { language, code } : {});
      setRunId(res.runId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="font-semibold">Reference solution</h2>
          <p className="mt-1 text-sm text-ink-2">
            A correct solution, never shown to participants. Validation runs it on the examples and every test with the real limits (
            {formatMs(effectiveLimits(values, language, values.languageLimits).timeLimitMs)} for {languageLabel(language)}).
          </p>
        </div>
        <Select
          aria-label="Reference solution language"
          className="w-52"
          value={language}
          onChange={(e) => {
            const next = e.target.value as LanguageId;
            update({ referenceSolution: { language: next, code: code || LANGUAGES[next].template } });
          }}
        >
          {LANGUAGE_IDS.filter((l) => runtimes.installed.has(l)).map((l) => (
            <option key={l} value={l}>
              {languageLabel(l)}
            </option>
          ))}
        </Select>
        <CodeEditor
          className="h-[420px] overflow-hidden rounded-md border border-line"
          language={LANGUAGES[language].monaco}
          value={code}
          onChange={(next) => update({ referenceSolution: next.trim() ? { language, code: next } : null })}
          ariaLabel="Reference solution"
        />
        <div className="flex items-center gap-3">
          <Button variant="primary" loading={starting || running} disabled={!code.trim()} onClick={() => void validate()}>
            Validate question
          </Button>
          {running && (
            <span className="inline-flex items-center gap-2 text-sm text-ink-2">
              <Spinner /> {run.data?.status === 'queued' ? 'Waiting for the runner' : 'Running every case'}
            </span>
          )}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {run.data?.status === 'failed' && <ErrorNote>{run.data.error ?? 'Validation could not run.'}</ErrorNote>}
      </div>
      <div className="min-w-0">
        {meta.validation ? (
          <Report report={meta.validation} stale={meta.validationState === 'stale'} />
        ) : (
          <Notice>Not validated yet. Write or paste a reference solution, then validate before publishing.</Notice>
        )}
      </div>
    </div>
  );
}
