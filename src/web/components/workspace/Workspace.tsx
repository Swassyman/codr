import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { Dialog as RDialog } from 'radix-ui';
import { toast } from 'sonner';
import { FileText, Focus, Lock, Maximize, Minimize, WifiOff, X } from 'lucide-react';
import { autocompleteEnabled } from '../../../shared/autocomplete';
import { LANGUAGES, type LanguageId } from '../../../shared/languages';
import type { SubmissionDTO, WorkspaceQuestionDTO } from '../../../shared/api';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useUser } from '../../lib/auth';
import { useEditorSettings, zenStorage } from '../../lib/editor-settings';
import { useConnectionState } from '../../lib/events';
import { useFullscreen } from '../../lib/fullscreen';
import { useMediaQuery, modKey, isMac } from '../../lib/media';
import { useRun } from '../../lib/runs';
import { useLanguageLabel, useRuntimes } from '../../lib/runtimes';
import { serverClock } from '../../lib/server-time';
import { matchShortcut, SHORTCUT_LABELS, type WorkspaceShortcut } from '../../lib/shortcuts';
import { cn } from '../../lib/cn';
import { ThemeToggle } from '../AppShell';
import { CodeEditor, type MonacoEditor } from '../CodeEditor';
import { ProblemStatement } from '../ProblemStatement';
import { Button, IconButton, Kbd, Select, Switch, Tab, TabList, Tabs } from '../ui';
import { EditorSettingsButton } from './EditorSettings';
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
  /** The contest clock: in the header, or in the slim bar in zen mode. */
  clock?: ReactNode;
  /** Thin contest clock across the top edge. Shown in every layout. */
  fuse?: ReactNode;
  /** When set, work is no longer accepted and this explains why. */
  locked?: string | null;
  submissionLimit?: { used: number; max: number } | null;
  onPaste?: (chars: number) => void;
  /** Called when the server refuses work (time up, question locked). */
  onRefused?: (err: ApiError) => void;
  /** Work deadline: the latest draft is saved just before it so the auto-submit has it. */
  deadline?: string | null;
}

const draftText: Record<DraftState, string> = {
  saved: 'Draft saved',
  saving: 'Saving draft',
  pending: 'Editing',
  local: 'Saved on this device',
  blocked: 'Not saving',
};

const LANG_KEY = 'codr-lang';

type BottomTab = 'custom' | 'examples' | 'submissions';

const shortcutLabel = (id: WorkspaceShortcut) => SHORTCUT_LABELS[id][isMac ? 'mac' : 'other'];

/** Where Esc and the workspace shortcuts belong to the editor (and Vim's command line), not the page. */
const inEditor = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.('.monaco-editor, .codr-keymap-status');

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

const FORCED_REASON = { on: 'This contest keeps autocomplete on.', off: 'This contest turns autocomplete off.' } as const;

/** The participant's own autocomplete choice, per account on this device. Off until they turn it on. */
function useAutocompletePreference(userId: number | null) {
  const key = `codr-autocomplete:u${userId ?? 0}`;
  const [value, setValue] = useState<boolean | null>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored == null ? null : stored === 'on';
    } catch {
      return null;
    }
  });
  const set = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? 'on' : 'off');
    } catch {
      // Not persisted; the choice still applies until the page closes.
    }
  };
  return [value, set] as const;
}

export function Workspace({ question, endpoints, scope, bar, barRight, clock, fuse, locked, submissionLimit, onPaste, onRefused, deadline }: WorkspaceProps) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const runtimes = useRuntimes();
  const languageLabel = useLanguageLabel();
  const user = useUser();
  const [autocompletePreference, setAutocompletePreference] = useAutocompletePreference(user?.id ?? null);
  // The server decides whether the contest forces it; the stored choice only applies otherwise.
  const policy = question.autocomplete;
  const autocomplete = autocompleteEnabled(policy, autocompletePreference);
  const connection = useConnectionState();
  const [language, setLanguageState] = useState<LanguageId>(() => pickLanguage(question, runtimes.installed));
  const [bottomTab, setBottomTab] = useState<BottomTab>(question.samples.length ? 'examples' : 'custom');
  const [customInput, setCustomInput] = useState(question.samples[0]?.input ?? '');
  const [runId, setRunId] = useState<number | null>(null);
  const [runKind, setRunKind] = useState<'samples' | 'custom' | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const [settings, updateSettings] = useEditorSettings(user?.id ?? null);
  const fullscreen = useFullscreen();

  // Zen: only the editor and a slim bar. Remembered per account, so it
  // carries over to the next question and the next visit.
  const [zen, setZenState] = useState(() => zenStorage.read(user?.id ?? null));
  // The peek sheet brings the hidden panels back over the editor in zen:
  // 'problem' is the statement, 'io' the run and submission tabs. `focus`
  // says whether opening it moves focus (not when a run opens it mid-typing).
  const [peek, setPeek] = useState<{ view: 'problem' | 'io'; focus: boolean } | null>(null);
  const setZen = (on: boolean) => {
    setZenState(on);
    zenStorage.write(user?.id ?? null, on);
    if (!on) setPeek(null);
  };
  const [sheetHost, setSheetHost] = useState<HTMLDivElement | null>(null);
  const statementPanel = usePanelRef();
  const bottomPanel = usePanelRef();
  useLayoutEffect(() => {
    for (const panel of [statementPanel.current, bottomPanel.current]) {
      if (!panel) continue;
      if (zen) panel.collapse();
      else if (panel.isCollapsed()) panel.expand();
    }
    // Again when the layout flips between side by side and stacked.
  }, [zen, wide, statementPanel, bottomPanel]);

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

  // Save the latest edits just before the deadline (the server keeps whatever it has by then).
  const { setCode: saveCode, flush: flushDrafts } = drafts;
  useEffect(() => {
    if (!deadline || locked) return;
    const wait = Date.parse(deadline) - serverClock.now() - 1500;
    if (wait < 0) return;
    const t = window.setTimeout(() => {
      const model = editorRef.current?.getModel();
      if (model) saveCode(language, model.getValue());
      void flushDrafts();
    }, wait);
    return () => window.clearTimeout(t);
  }, [deadline, locked, language, saveCode, flushDrafts]);

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
      // Zen hides the results panel, so show the result over the editor (without taking focus).
      if (zen) setPeek({ view: 'io', focus: false });
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
      if (zen) setPeek({ view: 'io', focus: false });
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

  const toggleZen = () => setZen(!zen);
  const togglePeek = () => {
    if (!zen) return; // The statement is already on screen.
    setPeek((p) => (p?.view === 'problem' ? null : { view: 'problem', focus: true }));
  };

  // Shortcuts work whether or not the editor has focus. Zen and fullscreen are
  // independent: each shortcut toggles only its own state, so zen inside
  // fullscreen stays fullscreen when zen is left, and the other way round.
  const actions: Record<WorkspaceShortcut, () => void> = { run: doRun, submit: doSubmit, zen: toggleZen, fullscreen: fullscreen.toggle, peek: togglePeek };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const zenRef = useRef(zen);
  zenRef.current = zen;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inEditor(e.target)) return; // The editor reserves its own (onEditorReady).
      const shortcut = matchShortcut(e);
      if (shortcut) {
        e.preventDefault();
        actionsRef.current[shortcut]();
        return;
      }
      // Esc leaves zen, one layer at a time: an open popover, dialog or the
      // peek sheet closes first (they mark the event handled), and in
      // fullscreen the browser takes Esc to leave fullscreen. Inside the
      // editor Esc stays with the editor (Vim needs it); Alt+Z or the visible
      // button leave zen from there.
      if (e.key === 'Escape' && !e.defaultPrevented && zenRef.current && !document.fullscreenElement) {
        e.preventDefault();
        actionsRef.current.zen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onEditorReady = (editor: MonacoEditor) => {
    editorRef.current = editor;
    // Reserved before anything else listens: this runs at mount, so it sees
    // keys before Vim or Emacs bindings (loaded later) and before Monaco's
    // own keybindings. Marking the event handled makes both keymaps skip it,
    // so they can't swallow Run, Submit or the layout shortcuts. Everything
    // else (including Esc) goes to the editor and the keymap untouched.
    editor.onKeyDown((e) => {
      const shortcut = matchShortcut(e.browserEvent);
      if (!shortcut) return;
      e.preventDefault();
      e.stopPropagation();
      actionsRef.current[shortcut]();
    });
    // In the command palette (F1). Keys come from the handler above.
    editor.addAction({ id: 'codr.run', label: 'Run', run: () => actionsRef.current.run() });
    editor.addAction({ id: 'codr.submit', label: 'Submit', run: () => actionsRef.current.submit() });
    editor.addAction({ id: 'codr.zen', label: 'Toggle zen mode', run: () => actionsRef.current.zen() });
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

  const runLabel = bottomTab === 'custom' || question.samples.length === 0 ? 'Run custom input' : 'Run examples';
  const reconnecting = connection === 'reconnecting' && (
    <span className="inline-flex items-center gap-1.5 text-sm text-warn" role="status">
      <WifiOff className="size-4" /> <span className={cn(zen && 'sr-only')}>Reconnecting</span>
    </span>
  );

  const editorPane = (
    <div className="flex h-full min-h-0 flex-col">
      {/* The editor toolbar; in zen it is the slim bar, the only chrome left. On narrow screens it wraps rather than pushing controls off-screen. */}
      <div
        className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line bg-surface px-3 py-1.5"
        role={zen ? 'toolbar' : undefined}
        aria-label={zen ? 'Zen mode' : undefined}
      >
        {zen && (
          <Button size="sm" variant="ghost" onClick={togglePeek} aria-expanded={peek?.view === 'problem'} aria-haspopup="dialog" title={`Problem statement (${shortcutLabel('peek')})`}>
            <FileText className="size-4" aria-hidden />
            <span className="hidden sm:inline">Problem</span>
            <span className="sr-only sm:hidden">Problem statement</span>
          </Button>
        )}
        <Select aria-label="Language" className="h-8 w-36 sm:w-auto sm:max-w-52 sm:min-w-36" value={language} disabled={!!locked} onChange={(e) => setLanguage(e.target.value as LanguageId)}>
          {usable.map((l) => (
            <option key={l} value={l}>
              {languageLabel(l)}
            </option>
          ))}
        </Select>
        {!zen && (
          <span className="flex items-center gap-2" title={policy.forced == null ? 'Word suggestions while you type' : FORCED_REASON[policy.forced ? 'on' : 'off']}>
            <Switch
              id="codr-autocomplete"
              checked={autocomplete}
              disabled={policy.forced != null}
              onCheckedChange={setAutocompletePreference}
            />
            <label htmlFor="codr-autocomplete" className={cn('text-xs whitespace-nowrap', policy.forced == null ? 'cursor-pointer text-ink-2' : 'text-ink-3')}>
              Autocomplete
              {policy.forced != null && (
                <>
                  <span className="hidden sm:inline"> · contest rule</span>
                  <span className="sr-only">. {FORCED_REASON[policy.forced ? 'on' : 'off']}</span>
                </>
              )}
            </label>
          </span>
        )}
        <span className={cn('hidden text-xs whitespace-nowrap xl:inline', drafts.state === 'local' ? 'text-warn' : 'text-ink-3')} role="status">
          {locked ? '' : draftText[drafts.state]}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {zen && reconnecting}
          {zen && clock}
          <EditorSettingsButton settings={settings} onChange={updateSettings} language={language} />
          {fullscreen.supported && (
            <IconButton label={`${fullscreen.active ? 'Exit fullscreen' : 'Fullscreen'} (${shortcutLabel('fullscreen')})`} aria-pressed={fullscreen.active} onClick={fullscreen.toggle}>
              {fullscreen.active ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </IconButton>
          )}
          {!zen && (
            <IconButton label={`Zen mode (${shortcutLabel('zen')})`} onClick={toggleZen}>
              <Focus className="size-4" />
            </IconButton>
          )}
          <Button size="sm" className="ml-1" onClick={doRun} disabled={!canWork} loading={startRun.isPending || runBusy} title={`${runLabel} (${modKey}+Enter)`}>
            <span className="hidden sm:inline">{runLabel}</span>
            <span className="sm:hidden">Run</span>
            <Kbd className="hidden md:inline">{modKey}↵</Kbd>
          </Button>
          <Button size="sm" variant="primary" onClick={doSubmit} disabled={!canWork} loading={submit.isPending} title={`Submit (${modKey}+Shift+Enter)`}>
            Submit
            <Kbd className="hidden border-on-accent/30 bg-transparent text-on-accent/80 md:inline">{modKey}⇧↵</Kbd>
          </Button>
          {zen && (
            <Button size="sm" variant="ghost" onClick={toggleZen} title={`Exit zen mode (Esc or ${shortcutLabel('zen')})`}>
              <X className="size-4" aria-hidden />
              <span className="hidden sm:inline">Exit zen</span>
              <span className="sr-only sm:hidden">Exit zen mode</span>
            </Button>
          )}
        </div>
      </div>
      {locked && (
        <div className="flex items-center gap-2 border-b border-line bg-raised px-3 py-2 text-sm text-ink-2" role="status">
          <Lock className="size-4" /> {locked}
        </div>
      )}
      {/* The peek sheet opens in here, so it never covers the slim bar however tall that wraps. */}
      <div ref={setSheetHost} className="relative flex min-h-0 flex-1 flex-col">
        <CodeEditor
          key={language}
          className="min-h-0 flex-1"
          language={LANGUAGES[language].monaco}
          value={code}
          readOnly={!!locked}
          onChange={(next) => drafts.setCode(language, next)}
          onReady={onEditorReady}
          ariaLabel={`${languageLabel(language)} solution`}
          autocomplete={autocomplete}
          tabWidth={settings.tabWidth}
          keyBindings={settings.keyBindings}
          editorTheme={settings.theme}
        />
      </div>
    </div>
  );

  const bottomTabs = (
    <>
      <Tab value="custom">Custom input</Tab>
      <Tab value="examples">Example results</Tab>
      <Tab value="submissions">
        Submissions
        {(submissionsQuery.data?.submissions.length ?? 0) > 0 && <span className="text-ink-3 tabular-nums">{submissionsQuery.data!.submissions.length}</span>}
      </Tab>
    </>
  );
  const bottomContent = (
    <div className="min-h-0 flex-1">
      {bottomTab === 'custom' && (
        <CustomInputPanel input={customInput} onInput={setCustomInput} run={runKind === 'custom' ? run.data : undefined} running={runKind === 'custom' && runBusy} onRun={doRun} />
      )}
      {bottomTab === 'examples' && <ExampleResultsPanel run={runKind === 'samples' ? run.data : undefined} running={runKind === 'samples' && runBusy} hasSamples={question.samples.length > 0} />}
      {bottomTab === 'submissions' && (
        <SubmissionsPanel submissions={submissionsQuery.data?.submissions ?? []} loading={submissionsQuery.isPending} limit={submissionLimit} />
      )}
    </div>
  );

  const bottomPane = (
    <Tabs value={bottomTab} onValueChange={(v) => setBottomTab(v as BottomTab)} className="flex h-full min-h-0 flex-col bg-surface">
      <TabList className="shrink-0 px-2">{bottomTabs}</TabList>
      {bottomContent}
    </Tabs>
  );

  // The peek sheet: non-modal, so the editor stays usable beside it. Esc
  // closes it (but not Esc typed in the editor, which belongs to Vim and
  // Monaco's widgets), and focus goes back to the editor.
  const peekSheet = zen && (
    <RDialog.Root open={peek != null} onOpenChange={(open) => !open && setPeek(null)} modal={false}>
      <RDialog.Portal container={sheetHost}>
        <RDialog.Content
          className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-line bg-surface shadow-pop sm:w-[min(36rem,90%)]"
          onOpenAutoFocus={(e) => {
            if (!peek?.focus) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            editorRef.current?.focus();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            if (inEditor(e.target)) e.preventDefault();
          }}
        >
          <RDialog.Title className="sr-only">{peek?.view === 'problem' ? 'Problem statement' : 'Runs and submissions'}</RDialog.Title>
          <RDialog.Description className="sr-only">Press Escape to close and return to the editor.</RDialog.Description>
          {/* The page bar (question navigator, way back) lives here while zen hides the header, so switching questions doesn't mean leaving zen. */}
          <div className="flex h-12 shrink-0 items-center overflow-x-auto border-b border-line px-3">{bar}</div>
          <Tabs
            value={peek?.view === 'problem' ? 'problem' : bottomTab}
            onValueChange={(v) => {
              if (v === 'problem') setPeek({ view: 'problem', focus: true });
              else {
                setBottomTab(v as BottomTab);
                setPeek({ view: 'io', focus: true });
              }
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-end border-b border-line pr-1 pl-2">
              <TabList className="min-w-0 flex-1 overflow-x-auto border-b-0 whitespace-nowrap">
                <Tab value="problem">Problem</Tab>
                {bottomTabs}
              </TabList>
              <RDialog.Close asChild>
                <IconButton label="Close (Esc)" className="mb-0.5">
                  <X className="size-4" />
                </IconButton>
              </RDialog.Close>
            </div>
            {peek?.view === 'problem' ? <div className="min-h-0 flex-1">{statement}</div> : bottomContent}
          </Tabs>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );

  const handle = 'bg-line transition-colors data-[separator=hover]:bg-accent data-[separator=active]:bg-accent data-[separator=focus]:bg-accent';

  return (
    <div className="flex h-dvh flex-col bg-canvas" data-zen={zen || undefined}>
      {fuse}
      <header className={cn('flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3', zen && 'hidden')}>
        {bar}
        <div className="ml-auto flex items-center gap-2">
          {!zen && reconnecting}
          {!zen && clock}
          {barRight}
          <ThemeToggle />
        </div>
      </header>
      {/* Zen collapses the side panels instead of re-rendering the layout, so the editor (cursor, undo history) stays mounted. */}
      <Group orientation={wide ? 'horizontal' : 'vertical'} className="min-h-0 flex-1">
        <Panel panelRef={statementPanel} defaultSize={wide ? '42%' : '40%'} minSize="20%" collapsible collapsedSize="0%" className="bg-surface">
          {!zen && statement}
        </Panel>
        <Separator className={cn(handle, wide ? 'w-px' : 'h-px', zen && 'hidden')} />
        <Panel minSize="30%">
          <Group orientation="vertical" className="h-full">
            <Panel defaultSize="62%" minSize="20%">
              {editorPane}
            </Panel>
            <Separator className={cn(handle, 'h-px', zen && 'hidden')} />
            <Panel panelRef={bottomPanel} minSize="12%" collapsible collapsedSize="0%">
              {!zen && bottomPane}
            </Panel>
          </Group>
        </Panel>
      </Group>
      {peekSheet}
    </div>
  );
}
