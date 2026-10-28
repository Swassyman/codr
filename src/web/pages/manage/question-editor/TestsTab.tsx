import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, Download, FileUp, GripVertical, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { TestCaseDTO } from '../../../../shared/api';
import type { ImportedTest } from '../../../../shared/test-import';
import { api, errorMessage } from '../../../lib/api';
import { cn } from '../../../lib/cn';
import { AutoTextarea } from '../../../components/form-bits';
import { Button, ConfirmDialog, EmptyState, ErrorNote, IconButton, Input, Spinner, Switch } from '../../../components/ui';
import type { TabProps } from './QuestionEditorPage';
import { ImportTestsDialog } from './ImportTestsDialog';
import { GenerateOutputsDialog } from './GenerateOutputsDialog';

type TestPatch = Partial<Pick<TestCaseDTO, 'input' | 'expectedOutput' | 'hidden' | 'points' | 'label' | 'groupName'>>;

function formatSize(chars: number) {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / 1024 / 1024).toFixed(1)} MB`;
}

function LargeText({ questionId, test, part, onReplace }: { questionId: number; test: TestCaseDTO; part: 'input' | 'output'; onReplace: (text: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const size = part === 'input' ? test.inputSize : test.outputSize;
  return (
    <div className="flex h-full min-h-20 flex-col justify-between rounded-md border border-dashed border-line-strong bg-well px-3 py-2 text-sm">
      <span className="text-ink-2">
        Large {part}: <span className="tabular-nums">{formatSize(size)}</span>
      </span>
      <div className="flex gap-3">
        <a className="inline-flex items-center gap-1 text-accent hover:underline" href={`/api/manage/questions/${questionId}/tests/${test.id}/raw?part=${part}`}>
          <Download className="size-3.5" /> Download
        </a>
        <button type="button" className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => fileRef.current?.click()}>
          <FileUp className="size-3.5" /> Replace
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) onReplace(await file.text());
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

interface RowProps {
  test: TestCaseDTO;
  index: number;
  total: number;
  questionId: number;
  groupsMode: boolean;
  onSaved: (test: TestCaseDTO) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (to: number) => void;
  drag: { onDragStart: () => void; onDragOver: (e: DragEvent) => void; onDrop: () => void; onDragEnd: () => void; dropTarget: boolean };
  autoFocus: boolean;
}

function TestRow({ test, index, total, questionId, groupsMode, onSaved, onDuplicate, onDelete, onMove, drag, autoFocus }: RowProps) {
  const fromTest = (t: TestCaseDTO) => ({
    input: t.input,
    expectedOutput: t.expectedOutput,
    hidden: t.hidden,
    points: t.points,
    label: t.label ?? '',
    groupName: t.groupName ?? '',
  });
  const [local, setLocal] = useState(() => fromTest(test));
  const pending = useRef<TestPatch>({});
  const timer = useRef<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Pick up changes made elsewhere (e.g. generated outputs) when nothing is pending here.
  useEffect(() => {
    if (Object.keys(pending.current).length === 0) setLocal(fromTest(test));
  }, [test]);

  const flush = async () => {
    window.clearTimeout(timer.current);
    const body = pending.current;
    if (Object.keys(body).length === 0) return;
    pending.current = {};
    setSaving(true);
    try {
      onSaved(await api.patch<TestCaseDTO>(`/api/manage/questions/${questionId}/tests/${test.id}`, body));
    } catch (err) {
      pending.current = { ...body, ...pending.current };
      toast.error(`Test ${index + 1} was not saved: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  const change = (patch: TestPatch, immediate = false) => {
    setLocal((l) => ({ ...l, ...patch, label: patch.label ?? l.label, groupName: patch.groupName ?? l.groupName }));
    Object.assign(pending.current, patch);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), immediate ? 0 : 600);
  };

  return (
    <li
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      className={cn(
        'grid gap-3 border-b border-line py-3 lg:grid-cols-[20px_28px_minmax(0,1fr)_minmax(0,1fr)_200px_32px]',
        drag.dropTarget && 'border-t-2 border-t-accent',
      )}
    >
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          drag.onDragStart();
        }}
        onDragEnd={drag.onDragEnd}
        aria-label={`Drag to reorder test ${index + 1}`}
        className="hidden h-8 cursor-grab items-center text-ink-3 hover:text-ink active:cursor-grabbing lg:flex"
      >
        <GripVertical className="size-4" />
      </button>
      <div className="flex h-8 items-center text-sm font-medium tabular-nums text-ink-2">
        {index + 1}
        {saving && <Spinner className="ml-1 size-3" />}
      </div>
      <div className="min-w-0">
        <span className="mb-1 block text-xs text-ink-3 lg:hidden">Input</span>
        {test.truncated ? (
          <LargeText questionId={questionId} test={test} part="input" onReplace={(input) => change({ input }, true)} />
        ) : (
          <AutoTextarea
            mono
            autoFocus={autoFocus}
            aria-label={`Test ${index + 1} input`}
            minRows={3}
            maxRows={12}
            value={local.input}
            onChange={(e) => change({ input: e.target.value })}
            onBlur={() => void flush()}
          />
        )}
      </div>
      <div className="min-w-0">
        <span className="mb-1 block text-xs text-ink-3 lg:hidden">Expected output</span>
        {test.truncated ? (
          <LargeText questionId={questionId} test={test} part="output" onReplace={(expectedOutput) => change({ expectedOutput }, true)} />
        ) : (
          <AutoTextarea
            mono
            aria-label={`Test ${index + 1} expected output`}
            minRows={3}
            maxRows={12}
            value={local.expectedOutput}
            placeholder="Fill in, or generate from a reference solution"
            onChange={(e) => change({ expectedOutput: e.target.value })}
            onBlur={() => void flush()}
          />
        )}
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <Input aria-label={`Test ${index + 1} label`} placeholder="Label (optional)" className="h-8" value={local.label} onChange={(e) => change({ label: e.target.value })} onBlur={() => void flush()} />
        <Switch label="Hidden" checked={local.hidden} onCheckedChange={(hidden) => change({ hidden }, true)} />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-ink-2">
            Weight
            <Input
              type="number"
              min={0}
              step="any"
              className="h-8 w-16 px-2"
              placeholder="1"
              value={local.points ?? ''}
              onChange={(e) => change({ points: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={() => void flush()}
            />
          </label>
          {groupsMode && (
            <label className="flex min-w-0 items-center gap-1.5 text-ink-2">
              Group
              <Input className="h-8 min-w-0 px-2" placeholder="1" value={local.groupName} onChange={(e) => change({ groupName: e.target.value })} onBlur={() => void flush()} />
            </label>
          )}
        </div>
      </div>
      <div className="flex gap-0.5 lg:flex-col">
        <IconButton label={`Duplicate test ${index + 1}`} onClick={onDuplicate}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton label={`Move test ${index + 1} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUp className="size-4" />
        </IconButton>
        <IconButton label={`Move test ${index + 1} down`} disabled={index === total - 1} onClick={() => onMove(index + 1)}>
          <ArrowDown className="size-4" />
        </IconButton>
        <IconButton label={`Delete test ${index + 1}`} className="hover:text-bad" onClick={onDelete}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

export function TestsTab({ questionId, values, update, setLocal }: TabProps & { questionId: number }) {
  const qc = useQueryClient();
  const key = ['tests', questionId];
  const tests = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ tests: TestCaseDTO[] }>(`/api/manage/questions/${questionId}/tests`),
  });
  const list = tests.data?.tests ?? [];
  const setList = (fn: (l: TestCaseDTO[]) => TestCaseDTO[]) => qc.setQueryData<{ tests: TestCaseDTO[] }>(key, (old) => ({ tests: fn(old?.tests ?? []) }));
  const refreshMeta = () => void qc.invalidateQueries({ queryKey: ['question', questionId] });

  const [focusId, setFocusId] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState<null | { file?: File }>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TestCaseDTO | null>(null);

  const addTests = useMutation({
    mutationFn: (items: Partial<TestCaseDTO>[]) => api.post<{ tests: TestCaseDTO[] }>(`/api/manage/questions/${questionId}/tests`, { tests: items }),
    onSuccess: (res) => {
      setList((l) => [...l, ...res.tests]);
      refreshMeta();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const saveOrder = async (ordered: TestCaseDTO[]) => {
    setList(() => ordered);
    try {
      await api.put(`/api/manage/questions/${questionId}/tests/order`, { ids: ordered.map((t) => t.id) });
      refreshMeta();
    } catch (err) {
      toast.error(errorMessage(err));
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    void saveOrder(next);
  };

  const duplicate = async (test: TestCaseDTO) => {
    try {
      const copy = await api.post<TestCaseDTO>(`/api/manage/questions/${questionId}/tests/${test.id}/duplicate`);
      setList((l) => {
        const i = l.findIndex((t) => t.id === test.id);
        return [...l.slice(0, i + 1), copy, ...l.slice(i + 1)];
      });
      refreshMeta();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const remove = async (test: TestCaseDTO) => {
    const index = list.findIndex((t) => t.id === test.id);
    try {
      await api.del(`/api/manage/questions/${questionId}/tests/${test.id}`);
      setList((l) => l.filter((t) => t.id !== test.id));
      refreshMeta();
      if (!test.truncated) {
        toast(`Test ${index + 1} deleted.`, {
          action: {
            label: 'Undo',
            onClick: async () => {
              const res = await api.post<{ tests: TestCaseDTO[] }>(`/api/manage/questions/${questionId}/tests`, {
                tests: [{ input: test.input, expectedOutput: test.expectedOutput, hidden: test.hidden, points: test.points, label: test.label, groupName: test.groupName }],
              });
              const current = qc.getQueryData<{ tests: TestCaseDTO[] }>(key)?.tests ?? [];
              const restored = [...current];
              restored.splice(Math.min(index, restored.length), 0, res.tests[0]!);
              await saveOrder(restored);
            },
          },
        });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onFileDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setFileOver(false);
    const file = e.dataTransfer.files[0];
    if (file) setImportOpen({ file });
  };

  const hidden = list.filter((t) => t.hidden).length;
  const totalWeight = list.reduce((sum, t) => sum + (t.points ?? 1), 0);
  const groupsMode = values.scoringMode === 'groups';

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setFileOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setFileOver(false);
      }}
      onDrop={onFileDrop}
      className={cn('relative rounded-lg', fileOver && 'outline-2 outline-offset-4 outline-accent outline-dashed')}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={addTests.isPending}
            onClick={() =>
              addTests.mutate([{}], {
                onSuccess: (res) => setFocusId(res.tests[0]?.id ?? null),
              })
            }
          >
            <Plus className="size-4" /> Add test
          </Button>
          <Button onClick={() => setImportOpen({})}>
            <Upload className="size-4" /> Import zip or paste
          </Button>
          <Button onClick={() => setGenerateOpen(true)} disabled={list.length === 0}>
            <Sparkles className="size-4" /> Fill outputs from a reference solution
          </Button>
        </div>
        {list.length > 0 && (
          <p className="text-sm text-ink-2 tabular-nums">
            {list.length} test{list.length === 1 ? '' : 's'}, {hidden} hidden, total weight {Number(totalWeight.toFixed(2))}
          </p>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-raised px-3 py-2 text-sm text-ink-2">
        <span>Partial credit</span>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="scoring" checked={!groupsMode} onChange={() => update({ scoringMode: 'tests' })} className="accent-[var(--accent)]" />
          per test, by weight
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="scoring" checked={groupsMode} onChange={() => update({ scoringMode: 'groups' })} className="accent-[var(--accent)]" />
          per group: every test in a group must pass
        </label>
        <span className="text-xs text-ink-3">Examples are judged first and count for nothing.</span>
      </div>

      {tests.isPending ? (
        <Spinner />
      ) : tests.error ? (
        <ErrorNote>{errorMessage(tests.error)}</ErrorNote>
      ) : list.length === 0 ? (
        <EmptyState title="No test cases yet." action={<p className="text-sm text-ink-3">You can also drop a .zip of 1.in / 1.out files anywhere here.</p>}>
          Add tests one by one, import a zip of input/output pairs, or paste several at once. Leave expected outputs empty and fill them from a reference solution.
        </EmptyState>
      ) : (
        <>
          <div className="hidden border-b border-line pb-2 text-xs text-ink-3 lg:grid lg:grid-cols-[20px_28px_minmax(0,1fr)_minmax(0,1fr)_200px_32px] lg:gap-3">
            <span />
            <span>#</span>
            <span>Input</span>
            <span>Expected output</span>
            <span>Options</span>
            <span />
          </div>
          <ol>
            {list.map((test, i) => (
              <TestRow
                key={test.id}
                test={test}
                index={i}
                total={list.length}
                questionId={questionId}
                groupsMode={groupsMode}
                autoFocus={focusId === test.id}
                onSaved={(updated) => {
                  setList((l) => l.map((t) => (t.id === updated.id ? updated : t)));
                  refreshMeta();
                }}
                onDuplicate={() => void duplicate(test)}
                onDelete={() => (test.truncated ? setPendingDelete(test) : void remove(test))}
                onMove={(to) => move(i, to)}
                drag={{
                  onDragStart: () => setDragFrom(i),
                  onDragOver: (e) => {
                    if (dragFrom == null) return;
                    e.preventDefault();
                    setDropAt(i);
                  },
                  onDrop: () => {
                    if (dragFrom != null) move(dragFrom, i);
                    setDragFrom(null);
                    setDropAt(null);
                  },
                  onDragEnd: () => {
                    setDragFrom(null);
                    setDropAt(null);
                  },
                  dropTarget: dropAt === i && dragFrom !== i,
                }}
              />
            ))}
          </ol>
        </>
      )}

      {importOpen && (
        <ImportTestsDialog
          initialFile={importOpen.file}
          onClose={() => setImportOpen(null)}
          onImport={async (items: ImportedTest[], hiddenByDefault: boolean) => {
            await addTests.mutateAsync(items.map((t) => ({ input: t.input, expectedOutput: t.output, hidden: hiddenByDefault })));
            toast.success(`Added ${items.length} test${items.length === 1 ? '' : 's'}.`);
            setImportOpen(null);
          }}
        />
      )}
      {generateOpen && (
        <GenerateOutputsDialog
          questionId={questionId}
          tests={list}
          reference={values.referenceSolution}
          allowedLanguages={values.allowedLanguages}
          onReferenceSaved={(referenceSolution) => setLocal({ referenceSolution })}
          onClose={() => setGenerateOpen(false)}
          onApplied={() => {
            void qc.invalidateQueries({ queryKey: key });
            refreshMeta();
          }}
        />
      )}
      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete this large test?"
        description="Large tests cannot be restored with undo."
        confirmLabel="Delete test"
        tone="danger"
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
