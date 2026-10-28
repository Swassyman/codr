import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { monaco } from '../lib/monaco';
import { useResolvedTheme } from '../lib/theme';
import { Spinner } from './ui';

export type MonacoEditor = Parameters<OnMount>[0];

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
}

export function CodeEditor({ value, onChange, language, readOnly, onReady, className, ariaLabel = 'Code editor', minimal }: CodeEditorProps) {
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
          wordBasedSuggestions: 'off',
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          parameterHints: { enabled: false },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}
