import type { RunCaseDTO, RunDTO } from '../../../shared/api';
import { cn } from '../../lib/cn';
import { useLanguageLabel } from '../../lib/runtimes';
import { AutoTextarea } from '../form-bits';
import { Spinner } from '../ui';
import { VerdictBadge, formatKb, formatMs } from '../verdict';

const statusText: Record<string, string> = {
  ok: 'Finished',
  runtime_error: 'Runtime error',
  time_limit: 'Time limit exceeded',
  memory_limit: 'Memory limit exceeded',
  output_limit: 'Output limit exceeded',
  compile_error: 'Compilation error',
  internal_error: 'Runner error',
};

function Waiting({ run }: { run: RunDTO | undefined }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-ink-2" role="status">
      <Spinner />
      {run?.status === 'queued' ? `Queued${run.queuePosition ? `, position ${run.queuePosition}` : ''}. The runner is busy.` : 'Running'}
    </p>
  );
}

function Pre({ text, className, label }: { text: string; className?: string; label: string }) {
  return (
    <pre
      aria-label={label}
      className={cn('max-h-60 min-h-9 overflow-auto rounded-md border border-line bg-well px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre', className)}
    >
      {text || ' '}
    </pre>
  );
}

function Meta({ c }: { c: RunCaseDTO }) {
  const e = c.execution;
  return (
    <span className="inline-flex gap-3 text-xs text-ink-3 tabular-nums">
      <span>{formatMs(e.timeMs)}</span>
      <span>{formatKb(e.memoryKb)}</span>
      {e.status === 'runtime_error' && e.message && <span>{e.message}</span>}
    </span>
  );
}

function CompileError({ output }: { output: string }) {
  return (
    <div className="flex flex-col gap-2">
      <VerdictBadge verdict="CE" long />
      <Pre label="Compiler output" text={output} className="max-h-72 whitespace-pre-wrap text-bad" />
    </div>
  );
}

export function CustomInputPanel({ input, onInput, run, running, onRun }: { input: string; onInput: (v: string) => void; run: RunDTO | undefined; running: boolean; onRun: () => void }) {
  const languageLabel = useLanguageLabel();
  const result = run?.results[0];
  const e = result?.execution;
  return (
    <div className="grid h-full min-h-0 gap-4 overflow-auto p-4 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="custom-input" className="text-xs font-medium text-ink-3">
          Input
        </label>
        <AutoTextarea
          id="custom-input"
          mono
          minRows={5}
          maxRows={14}
          value={input}
          onChange={(ev) => onInput(ev.target.value)}
          onKeyDown={(ev) => {
            if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              onRun();
            }
          }}
          placeholder="Type the input your program should read"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3 text-xs text-ink-3">
          <span className="font-medium">Output</span>
          {run && !running && <span className="truncate">{languageLabel(run.language)}</span>}
        </span>
        {running ? (
          <Waiting run={run} />
        ) : !e ? (
          <p className="text-sm text-ink-3">Run your code to see what it prints for this input.</p>
        ) : e.status === 'compile_error' ? (
          <CompileError output={e.compileOutput ?? ''} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              {e.status === 'ok' ? <span className="text-sm text-ink-2">{statusText.ok}</span> : <VerdictBadge verdict={result.verdict ?? 'RE'} long />}
              <Meta c={result} />
            </div>
            <Pre label="Standard output" text={e.stdout} />
            {e.stderr && (
              <>
                <span className="text-xs font-medium text-ink-3">Standard error</span>
                <Pre label="Standard error" text={e.stderr} className="text-re" />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Marks lines of `actual` that differ from `expected` (ignoring trailing spaces). */
function DiffOutput({ expected, actual }: { expected: string; actual: string }) {
  const exp = expected.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd());
  const act = actual.replace(/\r\n?/g, '\n').split('\n');
  return (
    <pre aria-label="Your output" className="max-h-60 min-h-9 overflow-auto rounded-md border border-line bg-well py-2 font-mono text-[13px] leading-relaxed">
      {act.map((line, i) => (
        <div key={i} className={cn('px-3', line.trimEnd() !== (exp[i] ?? '') && (line.trim() || exp[i]) && 'bg-bad-soft')}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

export function ExampleResultsPanel({ run, running, hasSamples }: { run: RunDTO | undefined; running: boolean; hasSamples: boolean }) {
  const languageLabel = useLanguageLabel();
  if (!hasSamples) return <p className="p-4 text-sm text-ink-3">This question has no examples. Use the custom input tab.</p>;
  if (running) return <div className="p-4"><Waiting run={run} /></div>;
  if (!run) return <p className="p-4 text-sm text-ink-3">Run your code on the examples to compare its output with the expected output.</p>;
  if (run.status === 'failed') return <p className="p-4 text-sm text-bad">{run.error ?? 'The run failed.'}</p>;
  const first = run.results[0];
  if (first?.execution.status === 'compile_error') {
    return (
      <div className="p-4">
        <CompileError output={first.execution.compileOutput ?? ''} />
      </div>
    );
  }
  const passed = run.results.filter((r) => r.verdict === 'AC').length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-auto p-4">
      <p className="text-sm text-ink-2">
        {passed === run.results.length ? 'Every example passes.' : `${passed} of ${run.results.length} examples pass.`} Passing the examples does not guarantee the hidden tests pass.
        <span className="ml-2 text-xs text-ink-3">{languageLabel(run.language)}</span>
      </p>
      {run.results.map((r) => (
        <section key={r.label} aria-label={r.label}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium">{r.label}</span>
            <VerdictBadge verdict={r.verdict ?? 'IE'} />
            <Meta c={r} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="min-w-0">
              <span className="mb-1 block text-xs text-ink-3">Input</span>
              <Pre label={`${r.label} input`} text={r.input} />
            </div>
            <div className="min-w-0">
              <span className="mb-1 block text-xs text-ink-3">Expected output</span>
              <Pre label={`${r.label} expected output`} text={r.expected ?? ''} />
            </div>
            <div className="min-w-0">
              <span className="mb-1 block text-xs text-ink-3">Your output</span>
              {r.execution.status === 'ok' || r.execution.stdout ? (
                <DiffOutput expected={r.expected ?? ''} actual={r.execution.stdout} />
              ) : (
                <Pre label="Your output" text={r.execution.stderr || statusText[r.execution.status] || ''} className="text-re" />
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
