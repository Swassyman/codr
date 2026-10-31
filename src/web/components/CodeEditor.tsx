import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { monaco } from '../lib/monaco';
import { useResolvedTheme } from '../lib/theme';
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
}

export function CodeEditor({ value, onChange, language, readOnly, onReady, className, ariaLabel = 'Code editor', minimal, autocomplete = false }: CodeEditorProps) {
  const theme = useResolvedTheme();
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    monaco.editor.setTheme(theme === 'dark' ? 'codr-dark' : 'codr-light');
  }, [theme]);

  return (
    <div className={className}>
      <Editor
        value={value}
        language={language}
        theme={theme === 'dark' ? 'codr-dark' : 'codr-light'}
        loading={<Spinner />}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={(editor) => readyRef.current?.(editor)}
        options={{
          readOnly,
          ariaLabel,
          fontFamily: '"Atkinson Hyperlegible Mono Variable", ui-monospace, monospace',
          fontSize: 14,
          lineHeight: 22,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
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
    </div>
  );
}
