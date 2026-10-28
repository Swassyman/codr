import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import type { StatementDTO } from '../../shared/api';
import { Markdown } from './Markdown';
import { IconButton } from './ui';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? 'Copied' : label}
      className="size-7"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard blocked (e.g. insecure origin on a LAN): nothing to do.
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

function IOBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex h-7 items-center justify-between">
        <span className="text-xs font-medium text-ink-3">{title}</span>
        <CopyButton text={text} label={`Copy ${title.toLowerCase()}`} />
      </div>
      <pre className="max-h-72 overflow-auto rounded-md border border-line bg-well px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre">
        {text || ' '}
      </pre>
    </div>
  );
}

/**
 * Constraints are usually pure math ("1 \le N \le 10^5"), so they render as
 * math unless they contain $…$ already or read like a sentence.
 */
export function constraintMarkdown(c: string) {
  if (c.includes('$')) return c;
  const words = c.replace(/\\[a-zA-Z]+/g, ' ').match(/\b[a-zA-Z]{3,}\b/g) ?? [];
  return words.length >= 2 ? c : `$${c}$`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** The participant-facing statement. Used for live preview while authoring too. */
export function ProblemStatement({ question, header }: { question: StatementDTO; header?: ReactNode }) {
  const constraints = question.constraints.filter((c) => c.trim());
  return (
    <article className="pb-10">
      {header}
      <h1 className="text-xl font-semibold tracking-tight">{question.title || 'Untitled question'}</h1>
      <p className="mt-1 text-sm text-ink-3 tabular-nums">
        Time limit {question.timeLimitMs >= 1000 ? `${question.timeLimitMs / 1000} s` : `${question.timeLimitMs} ms`}, memory limit {question.memoryLimitMb} MB
      </p>

      {question.statement.trim() ? (
        <Markdown text={question.statement} className="mt-5" />
      ) : (
        <p className="mt-5 text-sm text-ink-3">The statement is empty.</p>
      )}

      {question.inputFormat.trim() && (
        <Section title="Input">
          <Markdown text={question.inputFormat} />
        </Section>
      )}
      {question.outputFormat.trim() && (
        <Section title="Output">
          <Markdown text={question.outputFormat} />
        </Section>
      )}
      {constraints.length > 0 && (
        <Section title="Constraints">
          <ul className="statement list-disc space-y-1 pl-5">
            {constraints.map((c, i) => (
              <li key={i}>
                <Markdown text={constraintMarkdown(c)} inline />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {question.samples.length > 0 && (
        <Section title={question.samples.length === 1 ? 'Example' : 'Examples'}>
          <div className="flex flex-col gap-5">
            {question.samples.map((s, i) => (
              <div key={i}>
                {question.samples.length > 1 && <p className="mb-1 text-sm font-medium text-ink-2">Example {i + 1}</p>}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <IOBlock title="Input" text={s.input} />
                  <IOBlock title="Output" text={s.output} />
                </div>
                {s.explanation?.trim() && <Markdown text={s.explanation} className="mt-2 text-[15px] text-ink-2" />}
              </div>
            ))}
          </div>
        </Section>
      )}
      {question.notes.trim() && (
        <Section title="Notes">
          <Markdown text={question.notes} />
        </Section>
      )}
    </article>
  );
}
