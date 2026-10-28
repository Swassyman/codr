import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LANGUAGES, LANGUAGE_IDS, type LanguageId } from '../../../../shared/languages';
import type { TestCaseDTO } from '../../../../shared/api';
import type { ReferenceSolution } from '../../../../shared/types';
import { api, errorMessage } from '../../../lib/api';
import { useRun } from '../../../lib/runs';
import { useRuntimes } from '../../../lib/runtimes';
import { cn } from '../../../lib/cn';
import { CodeEditor } from '../../../components/CodeEditor';
import { Button, Dialog, ErrorNote, Select, Spinner } from '../../../components/ui';
import { VerdictBadge, formatMs } from '../../../components/verdict';

const preview = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max)}…` : text) || ' ';

export function GenerateOutputsDialog({
  questionId,
  tests,
  reference,
  allowedLanguages,
  onReferenceSaved,
  onClose,
  onApplied,
}: {
  questionId: number;
  tests: TestCaseDTO[];
  reference: ReferenceSolution | null;
  allowedLanguages: LanguageId[];
  onReferenceSaved: (reference: ReferenceSolution) => void;
  onClose: () => void;
  onApplied: () => void;
}) {
  const runtimes = useRuntimes();
  const defaultLanguage = reference?.language ?? allowedLanguages.find((l) => runtimes.installed.has(l)) ?? 'cpp';
  const [language, setLanguage] = useState<LanguageId>(defaultLanguage);
  const [code, setCode] = useState(reference?.code ?? LANGUAGES[defaultLanguage].template);
  const [runId, setRunId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState(false);
  const run = useRun(runId);
  const done = run.data?.status === 'done';

  const byTest = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  const rows = useMemo(
    () =>
      (run.data?.results ?? []).map((r) => {
        const test = r.testId != null ? byTest.get(r.testId) : undefined;
        const ok = r.execution.status === 'ok';
        const current = test?.expectedOutput ?? '';
        const changed = ok && (test?.truncated || r.execution.stdout !== current);
        return { r, test, ok, changed };
      }),
    [run.data, byTest],
  );

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await api.post<{ runId: number }>(`/api/manage/questions/${questionId}/generate`, { language, code });
      onReferenceSaved({ language, code });
      setSelected(new Set());
      setRunId(res.runId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  // Once results arrive, preselect every test whose output would change.
  const [preselectedFor, setPreselectedFor] = useState<number | null>(null);
  if (done && runId != null && preselectedFor !== runId) {
    setPreselectedFor(runId);
    setSelected(new Set(rows.filter((x) => x.changed && x.r.testId != null).map((x) => x.r.testId!)));
  }

  const apply = async () => {
    setApplying(true);
    try {
      const outputs = rows.filter((x) => x.r.testId != null && selected.has(x.r.testId)).map((x) => ({ testId: x.r.testId!, expectedOutput: x.r.execution.stdout }));
      await api.post(`/api/manage/questions/${questionId}/tests/outputs`, { outputs });
      toast.success(`Updated ${outputs.length} expected output${outputs.length === 1 ? '' : 's'}.`);
      onApplied();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setApplying(false);
    }
  };

  const failures = rows.filter((x) => !x.ok).length;
  const changed = rows.filter((x) => x.changed).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Fill expected outputs from a reference solution" description="Your solution runs on every test input. Review the outputs before saving them." wide>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Language
            <Select
              className="w-48"
              value={language}
              onChange={(e) => {
                const next = e.target.value as LanguageId;
                if (code === LANGUAGES[language].template) setCode(LANGUAGES[next].template);
                setLanguage(next);
              }}
            >
              {LANGUAGE_IDS.filter((l) => runtimes.installed.has(l)).map((l) => (
                <option key={l} value={l}>
                  {LANGUAGES[l].label}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="primary" loading={starting || (runId != null && !done && run.data?.status !== 'failed')} onClick={() => void start()}>
            Run on {tests.length} input{tests.length === 1 ? '' : 's'}
          </Button>
          <span className="text-xs text-ink-3">Saved as the question's reference solution.</span>
        </div>
        <CodeEditor className="h-64 overflow-hidden rounded-md border border-line" language={LANGUAGES[language].monaco} value={code} onChange={setCode} ariaLabel="Reference solution" />
        {error && <ErrorNote>{error}</ErrorNote>}
        {runId != null && !done && (
          <p className="inline-flex items-center gap-2 text-sm text-ink-2">
            <Spinner /> {run.data?.status === 'queued' ? `Queued${run.data.queuePosition ? `, position ${run.data.queuePosition}` : ''}` : 'Running on all inputs'}
          </p>
        )}
        {run.data?.status === 'failed' && <ErrorNote>{run.data.error ?? 'The run failed.'}</ErrorNote>}
        {done && rows[0]?.r.execution.status === 'compile_error' ? (
          <div>
            <VerdictBadge verdict="CE" long />
            <pre className="mt-2 max-h-60 overflow-auto rounded-md border border-line bg-well p-3 font-mono text-xs whitespace-pre-wrap">{rows[0].r.execution.compileOutput}</pre>
          </div>
        ) : (
          done && (
            <>
              <p className="text-sm text-ink-2">
                {changed} of {rows.length} outputs would change{failures ? `; ${failures} input${failures === 1 ? '' : 's'} failed and cannot be used` : ''}.
              </p>
              <div className="max-h-80 overflow-auto rounded-md border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-raised text-left text-xs text-ink-3">
                    <tr>
                      <th className="w-10 px-3 py-1.5">
                        <input
                          type="checkbox"
                          aria-label="Select all usable outputs"
                          checked={selected.size > 0 && selected.size === rows.filter((x) => x.ok).length}
                          onChange={(e) => setSelected(e.target.checked ? new Set(rows.filter((x) => x.ok && x.r.testId != null).map((x) => x.r.testId!)) : new Set())}
                        />
                      </th>
                      <th className="px-2 py-1.5 font-medium">Test</th>
                      <th className="px-2 py-1.5 font-medium">Result</th>
                      <th className="px-2 py-1.5 font-medium">Current expected output</th>
                      <th className="px-2 py-1.5 font-medium">Generated output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ r, ok, changed: isChanged }, i) => (
                      <tr key={r.testId ?? i} className="border-t border-line align-top">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Use generated output for ${r.label}`}
                            disabled={!ok}
                            checked={r.testId != null && selected.has(r.testId)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(r.testId!);
                              else next.delete(r.testId!);
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{r.label}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          {ok ? <span className="text-ink-2 tabular-nums">{formatMs(r.execution.timeMs)}</span> : <VerdictBadge verdict={r.verdict ?? 'RE'} />}
                        </td>
                        <td className="max-w-64 px-2 py-2">
                          <pre className="font-mono text-xs whitespace-pre-wrap text-ink-2">{preview(byTest.get(r.testId ?? -1)?.expectedOutput ?? '')}</pre>
                        </td>
                        <td className={cn('max-w-64 px-2 py-2', isChanged && 'bg-accent-soft/60')}>
                          <pre className="font-mono text-xs whitespace-pre-wrap">{ok ? preview(r.execution.stdout) : preview(r.execution.stderr || r.execution.message || '')}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!done || selected.size === 0} loading={applying} onClick={() => void apply()}>
            Save {selected.size || ''} output{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
