// Monaco is bundled locally (no CDN) so the editor works on an offline LAN.
// Only syntax highlighting is loaded: no IntelliSense or language services,
// which keeps the bundle small. The only completion is word-based, and each
// contest decides whether participants get it (CodeEditor's autocomplete).
import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/cpp/register';
import 'monaco-editor/languages/definitions/python/register';
import 'monaco-editor/languages/definitions/java/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/go/register';
import 'monaco-editor/languages/definitions/rust/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { loader } from '@monaco-editor/react';
import { registerZig } from './monaco-zig';
import { MONACO_THEMES } from './editor-themes';

registerZig(monaco);

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Codr's own light and dark themes plus the named ones offered in editor settings.
for (const [name, data] of Object.entries(MONACO_THEMES)) monaco.editor.defineTheme(name, data);

loader.config({ monaco: monaco as never });

// Monaco measures glyphs once; remeasure after the self-hosted mono font loads.
void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());

export { monaco };
