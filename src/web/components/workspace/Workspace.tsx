import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { toast } from 'sonner';
import { Lock, WifiOff } from 'lucide-react';
import { LANGUAGES, type LanguageId } from '../../../shared/languages';
import type { SubmissionDTO, WorkspaceQuestionDTO } from '../../../shared/api';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useConnectionState } from '../../lib/events';
import { useMediaQuery, modKey } from '../../lib/media';
import { monaco } from '../../lib/monaco';
import { useRun } from '../../lib/runs';
import { useRuntimes } from '../../lib/runtimes';
import { cn } from '../../lib/cn';
import { ThemeToggle } from '../AppShell';
import { CodeEditor, type MonacoEditor } from '../CodeEditor';
import { ProblemStatement } from '../ProblemStatement';
import { Button, Kbd, Select, Tab, TabList, Tabs } from '../ui';
import { CustomInputPanel, ExampleResultsPanel } from './RunPanels';
import { SubmissionsPanel } from './SubmissionsPanel';
import { useDrafts, type DraftState } from './useDrafts';

export interface WorkspaceEndpoints {
  draft: string;
  run: string;
  submit: string;
  submissions: string;
}

export interface WorkspaceProps {
  question: WorkspaceQuestionDTO;
  endpoints: WorkspaceEndpoints;
  /** Namespace for local draft copies, e.g. "u12:practice:7". */
  scope: string;
  bar: ReactNode;
  barRight?: ReactNode;
  /** Thin contest clock across the top edge. */
  fuse?: ReactNode;
  /** When set, work is no longer accepted and this explains why. */
  locked?: string | null;
  submissionLimit?: { used: number; max: number } | null;
  onPaste?: (chars: number) => void;
  /** Called when the server refuses work (time up, question locked). */
  onRefused?: (err: ApiError) => void;
}

const draftText: Record<DraftState, string> = {
  saved: 'Draft saved',
  saving: 'Saving draft',
  pending: 'Editing',
  local: 'Saved on this device',
  blocked: 'Not saving',
};

const LANG_KEY = 'codr-lang';

function pickLanguage(q: WorkspaceQuestionDTO, installed: Set<LanguageId>): LanguageId {
  const usable = q.languages.filter((l) => installed.size === 0 || installed.has(l));
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANG_KEY);
  } catch {
    stored = null;
  }
  const fromDraft = [...q.drafts].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]?.language;
  return (
    (fromDraft && usable.includes(fromDraft) ? fromDraft : null) ??
    (stored && usable.includes(stored as LanguageId) ? (stored as LanguageId) : null) ??
    usable[0] ??
    q.languages[0] ??
    'cpp'
  );
}

export function Workspace({ question, endpoints, scope, bar, barRight, fuse, locked, submissionLimit, onPaste, onRefused }: WorkspaceProps) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const runtimes = useRuntimes();
  const connection = useConnectionState();
  const [language, setLanguageState] = useState<LanguageId>(() => pickLanguage(question, runtimes.installed));
  const [bottomTab, setBottomTab] = useState<'custom' | 'examples' | 'submissions'>(question.samples.length ? 'examples' : 'custom');
  const [customInput, setCustomInput] = useState(question.samples[0]?.input ?? '');
  const [runId, setRunId] = useState<number | null>(null);
  const [runKind, setRunKind] = useState<'samples' | 'custom' | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);

  const drafts = useDrafts({
    scope,
    serverDrafts: question.drafts,
    starterCode: question.starterCode,
    draftUrl: endpoints.draft,
    disabled: !!locked,
    onBlocked: (err) => onRefused?.(err),
  });
  const code = drafts.codeFor(language);

  const setLanguage = (next: LanguageId) => {
    void drafts.flush();
    setLanguageState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // Not persisted; fine.
    }
  };

  const run = useRun(runId);
  const runBusy = runId != null && run.data?.status !== 'done' && run.data?.status !== 'failed';

  const submissionsQuery = useQuery({
    queryKey: ['submissions', endpoints.submissions],
    queryFn: () => api.get<{ submissions: SubmissionDTO[] }>(endpoints.submissions),
    refetchInterval: (q) => (q.state.data?.submissions.some((s) => s.status === 'queued' || s.status === 'running') ? 2000 : false),
  });

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && (err.status === 403 || err.status === 409) && onRefused) onRefused(err);
    toast.error(errorMessage(err));
  };

  // Keyboard shortcuts can fire before React re-renders with the last keystroke,
  // so Run and Submit always read the editor itself.
  const currentCode = () => editorRef.current?.getModel()?.getValue() ?? code;

  const startRun = useMutation({
    mutationFn: async (mode: 'samples' | 'custom') => {
      const source = currentCode();
      drafts.setCode(language, source);
      await drafts.flush();
      const body = mode === 'custom' ? { mode, language, code: source, input: customInput } : { mode, language, code: source };
      return { mode, res: await api.post<{ id: number }>(endpoints.run, body) };
    },
    onSuccess: ({ mode, res }) => {
      setRunKind(mode);
      setRunId(res.id);
    },
    onError: handleError,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const source = currentCode();
      drafts.setCode(language, source);
      await drafts.flush();
      // One key per click: a retried or doubled request maps to the same submission.
      return api.post<{ id: number }>(endpoints.submit, { language, code: source }, { headers: { 'idempotency-key': crypto.randomUUID() } });
    },
    onSuccess: () => {
      setBottomTab('submissions');
      void submissionsQuery.refetch();
    },
    onError: handleError,
  });

  const canWork = !locked && !!code.trim();
  const doRun = () => {
    if (locked || !currentCode().trim() || startRun.isPending || runBusy) return;
    const mode = bottomTab === 'custom' || question.samples.length === 0 ? 'custom' : 'samples';
    if (mode === 'samples') setBottomTab('examples');
    startRun.mutate(mode);
  };
  const doSubmit = () => {
    if (locked || !currentCode().trim() || submit.isPending) return;
    submit.mutate();
  };

  // Shortcuts work whether or not the editor has focus.
  const runRef = useRef(doRun);
  const submitRef = useRef(doSubmit);
  runRef.current = doRun;
  submitRef.current = doSubmit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return; // Monaco handles its own
      e.preventDefault();
      if (e.shiftKey) submitRef.current();
      else runRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onEditorReady = (editor: MonacoEditor) => {
    editorRef.current = editor;
    // Actions are per editor (addCommand is global and breaks when the editor remounts).
    editor.addAction({ id: 'codr.run', label: 'Run', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter], run: () => runRef.current() });
    editor.addAction({
      id: 'codr.submit',
      label: 'Submit',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => submitRef.current(),
    });
    editor.onDidPaste((e) => {
      const model = editor.getModel();
      if (model) onPaste?.(model.getValueInRange(e.range).length);
    });
  };

  const usable = useMemo(
    () => question.languages.filter((l) => runtimes.installed.size === 0 || runtimes.installed.has(l)),
    [question.languages, runtimes.installed],
  );

  const statement = (
    <div className="h-full overflow-y-auto px-6 pt-6">
      <ProblemStatement
        question={question}
        header={
          <p className="mb-2 text-sm text-ink-3 tabular-nums">
            {question.points} points{question.tags.length > 0 && <span className="ml-3">{question.tags.join(', ')}</span>}
          </p>
        }
      />
    </div>
  );

  const editorPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Select aria-label="Language" className="h-8 w-auto min-w-36" value={language} disabled={!!locked} onChange={(e) => setLanguage(e.target.value as LanguageId)}>
          {usable.map((l) => (
            <option key={l} value={l}>
              {LANGUAGES[l].label}
            </option>
          ))}
        </Select>
        <span className={cn('hidden text-xs sm:inline', drafts.state === 'local' ? 'text-warn' : 'text-ink-3')} role="status">
          {locked ? '' : draftText[drafts.state]}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={doRun} disabled={!canWork} loading={startRun.isPending || runBusy} title={`Run (${modKey}+Enter)`}>
            {bottomTab === 'custom' || question.samples.length === 0 ? 'Run custom input' : 'Run examples'}
            <Kbd>{modKey}↵</Kbd>
          </Button>
          <Button size="sm" variant="primary" onClick={doSubmit} disabled={!canWork} loading={submit.isPending} title={`Submit (${modKey}+Shift+Enter)`}>
            Submit
            <Kbd className="border-on-accent/30 bg-transparent text-on-accent/80">{modKey}⇧↵</Kbd>
          </Button>
        </div>
      </div>
      {locked && (
        <div className="flex items-center gap-2 border-b border-line bg-raised px-3 py-2 text-sm text-ink-2" role="status">
          <Lock className="size-4" /> {locked}
        </div>
      )}
      <CodeEditor
        key={language}
        className="min-h-0 flex-1"
        language={LANGUAGES[language].monaco}
        value={code}
        readOnly={!!locked}
        onChange={(next) => drafts.setCode(language, next)}
        onReady={onEditorReady}
        ariaLabel={`${LANGUAGES[language].label} solution`}
      />
    </div>
  );

  const bottomPane = (
    <Tabs value={bottomTab} onValueChange={(v) => setBottomTab(v as typeof bottomTab)} className="flex h-full min-h-0 flex-col bg-surface">
      <TabList className="shrink-0 px-2">
        <Tab value="custom">Custom input</Tab>
        <Tab value="examples">Example results</Tab>
        <Tab value="submissions">
          Submissions
          {(submissionsQuery.data?.submissions.length ?? 0) > 0 && <span className="text-ink-3 tabular-nums">{submissionsQuery.data!.submissions.length}</span>}
        </Tab>
      </TabList>
      <div className="min-h-0 flex-1">
        {bottomTab === 'custom' && (
          <CustomInputPanel input={customInput} onInput={setCustomInput} run={runKind === 'custom' ? run.data : undefined} running={runKind === 'custom' && runBusy} onRun={doRun} />
        )}
        {bottomTab === 'examples' && <ExampleResultsPanel run={runKind === 'samples' ? run.data : undefined} running={runKind === 'samples' && runBusy} hasSamples={question.samples.length > 0} />}
        {bottomTab === 'submissions' && (
          <SubmissionsPanel submissions={submissionsQuery.data?.submissions ?? []} loading={submissionsQuery.isPending} limit={submissionLimit} />
        )}
      </div>
    </Tabs>
  );

  const handle = 'bg-line transition-colors data-[separator=hover]:bg-accent data-[separator=active]:bg-accent data-[separator=focus]:bg-accent';

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {fuse}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        {bar}
        <div className="ml-auto flex items-center gap-2">
          {connection === 'reconnecting' && (
            <span className="inline-flex items-center gap-1.5 text-sm text-warn" role="status">
              <WifiOff className="size-4" /> Reconnecting
            </span>
          )}
          {barRight}
          <ThemeToggle />
        </div>
      </header>
      <Group orientation={wide ? 'horizontal' : 'vertical'} className="min-h-0 flex-1">
        <Panel defaultSize={wide ? '42%' : '40%'} minSize="20%" className="bg-surface">
          {statement}
        </Panel>
        <Separator className={cn(handle, wide ? 'w-px' : 'h-px')} />
        <Panel minSize="30%">
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize="62%" minSize="20%">
              {editorPane}
            </Panel>
            <Separator className={cn(handle, 'h-px')} />
            <Panel minSize="12%">{bottomPane}</Panel>
          </Group>
        </Panel>
      </Group>
    </div>
  );
}
