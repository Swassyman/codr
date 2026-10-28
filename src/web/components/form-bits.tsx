import { forwardRef, useLayoutEffect, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { CircleAlert, Check, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Spinner, Textarea } from './ui';

/** Textarea that grows with its content up to `maxRows`, then scrolls. */
export const AutoTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean; minRows?: number; maxRows?: number }
>(function AutoTextarea({ minRows = 2, maxRows = 18, mono, className, value, ...rest }, forwarded) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const pad = 18;
    el.style.height = 'auto';
    const wanted = Math.min(Math.max(el.scrollHeight, minRows * line + pad), maxRows * line + pad);
    el.style.height = `${wanted}px`;
  }, [value, minRows, maxRows]);
  return (
    <Textarea
      ref={(el) => {
        inner.current = el;
        if (typeof forwarded === 'function') forwarded(el);
        else if (forwarded) forwarded.current = el;
      }}
      mono={mono}
      value={value}
      className={cn('min-h-0 resize-y', className)}
      {...rest}
    />
  );
});

export function TagInput({ value, onChange, id, ...aria }: { value: string[]; onChange: (tags: string[]) => void; id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const tags = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const next = [...value];
    for (const t of tags) if (!next.includes(t)) next.push(t);
    if (next.length !== value.length) onChange(next);
    setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(text);
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1 focus-within:border-accent">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded bg-raised px-1.5 py-0.5 text-xs text-ink-2">
          {tag}
          <button type="button" aria-label={`Remove tag ${tag}`} className="text-ink-3 hover:text-ink" onClick={() => onChange(value.filter((t) => t !== tag))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        {...aria}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() && add(text)}
        placeholder={value.length ? '' : 'graphs, dp, greedy'}
        className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
      />
    </div>
  );
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'offline';

export function SaveIndicator({ state, error }: { state: SaveState; error?: string | null }) {
  const content = {
    saved: (
      <>
        <Check className="size-3.5 text-ok" /> Saved
      </>
    ),
    dirty: <span className="text-ink-3">Unsaved changes</span>,
    saving: (
      <>
        <Spinner className="size-3.5" /> Saving
      </>
    ),
    error: (
      <>
        <CircleAlert className="size-3.5 text-bad" /> <span className="text-bad">{error ?? 'Not saved'}</span>
      </>
    ),
    offline: (
      <>
        <CircleAlert className="size-3.5 text-warn" /> <span className="text-warn">Offline, will retry</span>
      </>
    ),
  }[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-2" role="status" aria-live="polite">
      {content}
    </span>
  );
}
