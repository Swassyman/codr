// Monaco is bundled locally (no CDN) so the editor works on an offline LAN.
// Only syntax highlighting is loaded: no IntelliSense, which keeps contests
// fair and the bundle small.
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/java/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/go/register';
import 'monaco-editor/languages/definitions/rust/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { loader } from '@monaco-editor/react';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.editor.defineTheme('codr-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b717d', fontStyle: 'italic' },
    { token: 'keyword', foreground: '2b3bd6' },
    { token: 'string', foreground: '157a4a' },
    { token: 'number', foreground: 'a84a0c' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f4f5f7',
    'editorLineNumber.foreground': '#a2a8b3',
    'editorLineNumber.activeForeground': '#484e59',
    'editor.selectionBackground': '#d5dafb',
    'editorCursor.foreground': '#2b3bd6',
    'editorIndentGuide.background1': '#eceef1',
  },
});

monaco.editor.defineTheme('codr-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '7d8490', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8d9aff' },
    { token: 'string', foreground: '6fd3a0' },
    { token: 'number', foreground: 'f59a62' },
  ],
  colors: {
    'editor.background': '#1a1d23',
    'editor.lineHighlightBackground': '#20242b',
    'editorLineNumber.foreground': '#535a67',
    'editorLineNumber.activeForeground': '#a8aeba',
    'editor.selectionBackground': '#323a6a',
    'editorCursor.foreground': '#8d9aff',
    'editorIndentGuide.background1': '#242830',
  },
});

loader.config({ monaco: monaco as never });

// Monaco measures glyphs once; remeasure after the self-hosted mono font loads.
void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());

export { monaco };
