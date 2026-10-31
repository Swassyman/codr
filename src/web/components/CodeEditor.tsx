import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { monaco } from '../lib/monaco';
import type { KeyBindings, TabWidth } from '../lib/editor-settings';
import { monacoThemeName, type EditorThemeId } from '../lib/editor-themes';
import { useResolvedTheme } from '../lib/theme';
import { cn } from '../lib/cn';
import { Spinner } from './ui';

export type MonacoEditor = Parameters<OnMount>[0];

// Only word-based suggestions exist (no language services are bundled), but
// "off" closes every completion path Monaco has: suggestions while typing, on
// trigger characters and on demand, inline suggestions, parameter hints,
// snippets, and accepting with Tab or Enter.
const COMPLETION_ON = {
  quickSuggestions: true,
  wordBasedSuggestions: 'currentDocument',
  suggestOnTriggerCharacters: true,
  parameterHints: { enabled: true },
  inlineSuggest: { enabled: true },
  snippetSuggestions: 'inline',
  tabCompletion: 'off',
  acceptSuggestionOnEnter: 'on',
  suggest: { showWords: true, showSnippets: true },
} as const;

const COMPLETION_OFF = {
  quickSuggestions: false,
  wordBasedSuggestions: 'off',
  suggestOnTriggerCharacters: false,
  parameterHints: { enabled: false },
  inlineSuggest: { enabled: false },
  snippetSuggestions: 'none',
  tabCompletion: 'off',
  acceptSuggestionOnEnter: 'off',
  suggest: { showWords: false, showSnippets: false },
} as const;

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language: string;
  readOnly?: boolean;
  /** Called with the editor instance, e.g. to register shortcuts or paste tracking. */
  onReady?: (editor: MonacoEditor) => void;
  className?: string;
  ariaLabel?: string;
  minimal?: boolean;
  /** Editor autocompletion; off unless the caller turns it on. */
  autocomplete?: boolean;
  /** Presentation and input settings; each applies live, without remounting the editor. */
  tabWidth?: TabWidth;
  keyBindings?: KeyBindings;
  editorTheme?: EditorThemeId;
}

interface KeymapMode {
  dispose(): void;
}

/**
 * Vim or Emacs key bindings, loaded on first use so the main bundle doesn't
 * carry them. Resolves to null if the editor moved on before loading finished.
 */
async function startKeymap(editor: MonacoEditor, kind: 'vim' | 'emacs', status: HTMLElement, alive: () => boolean): Promise<KeymapMode | null> {
  if (kind === 'vim') {
    const { initVimMode } = await import('monaco-vim');
    // Vim writes its mode and the ":" command line into the status element.
    return alive() ? initVimMode(editor, status) : null;
  }
  const { EmacsExtension } = await import('monaco-emacs');
  if (!alive()) return null;
  const emacs = new EmacsExtension(editor);
  // Pending prefixes such as "C-x" show in the status line.
  emacs.onDidChangeKey((keys) => {
    status.textContent = keys ? `Emacs  ${keys}` : 'Emacs';
  });
  status.textContent = 'Emacs';
  emacs.start();
  return emacs;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly,
  onReady,
  className,
  ariaLabel = 'Code editor',
  minimal,
  autocomplete = false,
  tabWidth = 4,
  keyBindings = 'default',
  editorTheme = 'codr',
}: CodeEditorProps) {
  const appTheme = useResolvedTheme();
  const themeName = monacoThemeName(editorTheme, appTheme);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const [editor, setEditor] = useState<MonacoEditor | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    monaco.editor.setTheme(themeName);
  }, [themeName]);

  // Indentation lives on the model, so it changes without touching the cursor,
  // the undo stack or the text. Go is indented with tabs (gofmt), shown at the
  // chosen width; everything else gets spaces.
  const insertSpaces = language !== 'go';
  useEffect(() => {
    if (!editor) return;
    const apply = () => editor.getModel()?.updateOptions({ tabSize: tabWidth, indentSize: tabWidth, insertSpaces });
    apply();
    const sub = editor.onDidChangeModel(apply);
    return () => sub.dispose();
  }, [editor, tabWidth, insertSpaces]);

  // One key binding mode at a time; switching or unmounting disposes it, which
  // removes its listeners and restores Monaco's own cursor and keys.
  useEffect(() => {
    const status = statusRef.current;
    if (!editor || keyBindings === 'default' || !status) return;
    let alive = true;
    let mode: KeymapMode | null = null;
    startKeymap(editor, keyBindings, status, () => alive)
      .then((m) => {
        mode = m;
      })
      .catch((err) => {
        console.error(`Could not load ${keyBindings} key bindings`, err);
        status.textContent = `${keyBindings === 'vim' ? 'Vim' : 'Emacs'} key bindings failed to load`;
      });
    return () => {
      alive = false;
      mode?.dispose();
    };
  }, [editor, keyBindings]);

  return (
    <div className={cn('flex flex-col', className)}>
      <Editor
        height="auto"
        wrapperProps={{ className: 'min-h-0 flex-1' }}
        value={value}
        language={language}
        theme={themeName}
        loading={<Spinner />}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={(mounted) => {
          readyRef.current?.(mounted);
          setEditor(mounted);
        }}
        options={{
          readOnly,
          ariaLabel,
          fontFamily: '"Atkinson Hyperlegible Mono Variable", ui-monospace, monospace',
          fontSize: 14,
          lineHeight: 22,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          // Indentation comes from the tab width setting, not from guessing at the starter code.
          detectIndentation: false,
          renderLineHighlight: 'line',
          padding: { top: 10, bottom: 10 },
          lineNumbers: minimal ? 'off' : 'on',
          folding: !minimal,
          glyphMargin: false,
          ...(autocomplete ? COMPLETION_ON : COMPLETION_OFF),
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          fixedOverflowWidgets: true,
        }}
      />
      {keyBindings !== 'default' && (
        // A fresh element per mode: Vim fills it with its own nodes.
        <div
          key={keyBindings}
          ref={statusRef}
          className="codr-keymap-status flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface px-3 font-mono text-xs whitespace-pre text-ink-2"
          aria-label={keyBindings === 'vim' ? 'Vim status' : 'Emacs status'}
          role="status"
        />
      )}
    </div>
  );
}
