import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { questionLetter } from '../../../../shared/letters';
import type { ContestEditorDTO, QuestionListItemDTO } from '../../../../shared/api';
import { api, errorMessage } from '../../../lib/api';
import { Button, Dialog, EmptyState, IconButton, Input, Spinner } from '../../../components/ui';

type Item = { questionId: number; points: number | null; durationMinutes: number | null };

function Picker({ existing, onAdd, onClose }: { existing: Set<number>; onAdd: (ids: number[]) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const bank = useQuery({
    queryKey: ['manage-questions', search],
    queryFn: () => api.get<{ questions: QuestionListItemDTO[] }>(`/api/manage/questions${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    placeholderData: (prev) => prev,
  });
  const list = (bank.data?.questions ?? []).filter((q) => !existing.has(q.id));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add questions" description="Published questions from the bank, plus your own drafts." wide>
      <Input autoFocus aria-label="Search questions" placeholder="Search by title, slug or tag" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-md border border-line">
        {bank.isPending ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <p className="p-4 text-sm text-ink-3">No more questions to add. Publish questions in the bank first.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((q) => (
              <li key={q.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-raised">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={chosen.has(q.id)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(q.id);
                      else next.delete(q.id);
                      setChosen(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{q.title}</span>
                    <span className="text-xs text-ink-3">
                      {q.testCount} tests{q.tags.length ? `, ${q.tags.join(', ')}` : ''}
                    </span>
                  </span>
                  {q.status === 'draft' && <span className="rounded bg-raised px-1.5 text-xs text-ink-2">draft</span>}
                  {q.validationState !== 'passed' && q.status === 'published' && <span className="text-xs text-warn">not validated</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={chosen.size === 0} onClick={() => onAdd([...chosen])}>
          Add {chosen.size || ''} question{chosen.size === 1 ? '' : 's'}
        </Button>
      </div>
    </Dialog>
  );
}

function NumberCell({ value, placeholder, label, onCommit, disabled }: { value: number | null; placeholder: string; label: string; onCommit: (v: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setText(value == null ? '' : String(value)), [value]);
  return (
    <Input
      aria-label={label}
      type="number"
      min={0}
      disabled={disabled}
      className="h-8 w-20 px-2"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        window.clearTimeout(timer.current);
        const v = e.target.value;
        timer.current = window.setTimeout(() => onCommit(v === '' ? null : Number(v)), 600);
      }}
    />
  );
}

export function QuestionsSection({ contest, perQuestion, defaultMinutes }: { contest: ContestEditorDTO; perQuestion: boolean; defaultMinutes: number | null }) {
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const items: Item[] = contest.questions.map((q) => ({ questionId: q.questionId, points: q.points, durationMinutes: q.durationMinutes }));

  const save = async (next: Item[]) => {
    setSaving(true);
    try {
      qc.setQueryData(['manage-contest', contest.id], await api.put<ContestEditorDTO>(`/api/manage/contests/${contest.id}/questions`, { items: next }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    void save(next);
  };
  const locked = contest.started;

  return (
    <>
      {contest.questions.length === 0 ? (
        <EmptyState title="No questions in this contest yet." action={<Button variant="primary" onClick={() => setPicking(true)}>Add questions</Button>} />
      ) : (
        <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
          {contest.questions.map((q, i) => (
            <li key={q.questionId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="w-6 font-mono font-semibold">{questionLetter(i)}</span>
              <span className="min-w-0 flex-1">
                <Link to={`/manage/questions/${q.questionId}`} className="block truncate font-medium hover:text-accent">
                  {q.title}
                </Link>
                <span className="text-xs text-ink-3">
                  {q.testCount} tests
                  {q.status === 'draft' && <span className="ml-2 text-warn">draft: publish it before the contest</span>}
                </span>
              </span>
              <label className="flex items-center gap-1.5 text-sm text-ink-2">
                Points
                <NumberCell
                  label={`Points for question ${questionLetter(i)}`}
                  value={q.points}
                  placeholder={String(q.questionPoints)}
                  onCommit={(points) => void save(items.map((it, j) => (j === i ? { ...it, points } : it)))}
                />
              </label>
              {perQuestion && (
                <label className="flex items-center gap-1.5 text-sm text-ink-2">
                  Minutes
                  <NumberCell
                    label={`Minutes for question ${questionLetter(i)}`}
                    value={q.durationMinutes}
                    disabled={locked}
                    placeholder={defaultMinutes ? String(defaultMinutes) : '—'}
                    onCommit={(durationMinutes) => void save(items.map((it, j) => (j === i ? { ...it, durationMinutes } : it)))}
                  />
                </label>
              )}
              <span className="flex">
                <IconButton label="Move up" disabled={locked || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="Move down" disabled={locked || i === contest.questions.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton label={`Remove question ${questionLetter(i)}`} disabled={locked} onClick={() => void save(items.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </IconButton>
              </span>
            </li>
          ))}
        </ol>
      )}
      {contest.questions.length > 0 && !locked && (
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => setPicking(true)}>
            <Plus className="size-3.5" /> Add questions
          </Button>
          {saving && <Spinner className="size-3.5" />}
        </div>
      )}
      {picking && (
        <Picker
          existing={new Set(items.map((i) => i.questionId))}
          onClose={() => setPicking(false)}
          onAdd={(ids) => {
            setPicking(false);
            void save([...items, ...ids.map((questionId) => ({ questionId, points: null, durationMinutes: null }))]);
          }}
        />
      )}
    </>
  );
}
