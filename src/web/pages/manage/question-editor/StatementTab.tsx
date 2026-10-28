import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Plus, X } from 'lucide-react';
import { slugify } from '../../../../shared/slug';
import type { SourceInfo } from '../../../../shared/types';
import { AutoTextarea, TagInput } from '../../../components/form-bits';
import { ProblemStatement } from '../../../components/ProblemStatement';
import { Button, Field, IconButton, Input, Select } from '../../../components/ui';
import type { TabProps } from './QuestionEditorPage';
import { PasteStatementDialog } from './PasteStatementDialog';

function SourceNote({ source }: { source: SourceInfo }) {
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2.5 text-sm">
      <p className="font-medium">Imported from {source.adapter}</p>
      <p className="mt-0.5 text-ink-2">
        {source.attribution ?? 'See the original for authorship.'}
        {source.license && <> License: {source.license}.</>}
      </p>
      {source.url && (
        <a href={source.url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-accent hover:underline">
          Original problem <ExternalLink className="size-3" />
        </a>
      )}
      <p className="mt-1.5 text-xs text-ink-3">Keep the attribution. Do not republish imported statements publicly unless the license allows it.</p>
    </div>
  );
}

function ConstraintsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (i: number, text: string) => onChange(value.map((c, j) => (j === i ? text : c)));
  const addAfter = (i: number) => {
    const next = [...value.slice(0, i + 1), '', ...value.slice(i + 1)];
    onChange(next);
    requestAnimationFrame(() => refs.current[i + 1]?.focus());
  };
  return (
    <div className="flex flex-col gap-2">
      {value.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            ref={(el) => {
              refs.current[i] = el;
            }}
            mono
            aria-label={`Constraint ${i + 1}`}
            value={c}
            placeholder="1 \le N \le 10^5"
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAfter(i);
              }
            }}
          />
          <IconButton label={`Remove constraint ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" onClick={() => addAfter(value.length - 1)}>
          <Plus className="size-3.5" /> Add constraint
        </Button>
      </div>
    </div>
  );
}

function SamplesEditor({ value, onChange }: { value: TabProps['values']['samples']; onChange: (v: TabProps['values']['samples']) => void }) {
  const set = (i: number, patch: Partial<(typeof value)[number]>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item!);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-4">
      {value.map((s, i) => (
        <fieldset key={i} className="rounded-lg border border-line bg-surface p-3">
          <legend className="sr-only">Example {i + 1}</legend>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Example {i + 1}</span>
            <div className="flex">
              <IconButton label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-3.5" />
              </IconButton>
              <IconButton label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-3.5" />
              </IconButton>
              <IconButton label={`Remove example ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Input">{(p) => <AutoTextarea {...p} mono minRows={3} value={s.input} onChange={(e) => set(i, { input: e.target.value })} />}</Field>
            <Field label="Output">{(p) => <AutoTextarea {...p} mono minRows={3} value={s.output} onChange={(e) => set(i, { output: e.target.value })} />}</Field>
          </div>
          <Field label="Explanation" optional className="mt-3">
            {(p) => <AutoTextarea {...p} minRows={1} value={s.explanation ?? ''} onChange={(e) => set(i, { explanation: e.target.value })} />}
          </Field>
        </fieldset>
      ))}
      <div>
        <Button size="sm" variant="ghost" onClick={() => onChange([...value, { input: '', output: '', explanation: '' }])}>
          <Plus className="size-3.5" /> Add example
        </Button>
      </div>
    </div>
  );
}

export function StatementTab({ values, update, errors, source }: TabProps & { source: SourceInfo | null }) {
  const [pasting, setPasting] = useState(false);
  const setTitle = (title: string) => {
    // Keep the slug in step with the title until someone edits it by hand.
    const followsTitle = values.slug === slugify(values.title) || values.slug.startsWith('untitled-question');
    update(followsTitle ? { title, slug: slugify(title) } : { title });
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        {source && <SourceNote source={source} />}
        <Field label="Title" error={errors.title}>
          {(p) => <Input {...p} value={values.title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Slug" hint="Used in practice links." error={errors.slug}>
            {(p) => <Input {...p} mono value={values.slug} onChange={(e) => update({ slug: e.target.value })} />}
          </Field>
          <Field label="Difficulty" error={errors.difficulty}>
            {(p) => (
              <Select {...p} value={values.difficulty ?? ''} onChange={(e) => update({ difficulty: (e.target.value || null) as TabProps['values']['difficulty'] })}>
                <option value="">Not set</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            )}
          </Field>
          <Field label="Rating" optional error={errors.rating}>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                value={values.rating ?? ''}
                placeholder="1500"
                onChange={(e) => update({ rating: e.target.value === '' ? null : Number(e.target.value) })}
              />
            )}
          </Field>
        </div>
        <Field label="Tags" hint="Press Enter or comma to add a tag." error={errors.tags}>
          {(p) => <TagInput {...p} value={values.tags} onChange={(tags) => update({ tags })} />}
        </Field>
        <div className="-mb-3 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setPasting(true)}>
            Paste a whole statement
          </Button>
        </div>
        <Field label="Problem statement" hint="Markdown, with $math$ and $$display math$$." error={errors.statement}>
          {(p) => <AutoTextarea {...p} minRows={8} maxRows={30} value={values.statement} onChange={(e) => update({ statement: e.target.value })} />}
        </Field>
        <Field label="Input format" error={errors.inputFormat}>
          {(p) => <AutoTextarea {...p} minRows={3} value={values.inputFormat} onChange={(e) => update({ inputFormat: e.target.value })} />}
        </Field>
        <Field label="Output format" error={errors.outputFormat}>
          {(p) => <AutoTextarea {...p} minRows={2} value={values.outputFormat} onChange={(e) => update({ outputFormat: e.target.value })} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Constraints</span>
          <span className="text-xs text-ink-3">One per line, shown as a bullet list. Math like 1 \le N \le 10^5 renders automatically.</span>
          <ConstraintsEditor value={values.constraints} onChange={(constraints) => update({ constraints })} />
          {errors.constraints && <p className="text-xs text-bad">{errors.constraints}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Examples</span>
          <span className="text-xs text-ink-3">Shown in the statement and run by the Run button. They are judged first in every submission, worth no points.</span>
          <SamplesEditor value={values.samples} onChange={(samples) => update({ samples })} />
          {errors.samples && <p className="text-xs text-bad">{errors.samples}</p>}
        </div>
        <Field label="Notes and hints" optional error={errors.notes}>
          {(p) => <AutoTextarea {...p} minRows={2} value={values.notes} onChange={(e) => update({ notes: e.target.value })} />}
        </Field>
      </div>
      {pasting && <PasteStatementDialog onClose={() => setPasting(false)} onApply={(patch) => update(patch)} />}
      <div className="min-w-0">
        <div className="sticky top-16 max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-lg border border-line bg-surface px-6 pt-5">
          <p className="mb-4 text-xs text-ink-3">Preview, as participants will see it</p>
          <ProblemStatement question={values} />
        </div>
      </div>
    </div>
  );
}
