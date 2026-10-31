// Editor colour themes. Plain data (no Monaco import) so tests can check
// contrast and token coverage; monaco.ts registers them.
//
// Each theme is built from one palette, so every token category the Monarch
// grammars emit (including the Zig grammar's builtins and types) gets a colour
// from that theme instead of falling back to Monaco's vs/vs-dark defaults.
// Well-known palettes keep their hues, but colours that fell short of WCAG AA
// on their own background (Solarized accents, Dracula and One Dark comments)
// have their lightness adjusted: code text is at least 4.5:1, line numbers at
// least 3:1.

export type EditorThemeId = 'codr' | 'github-light' | 'github-dark' | 'solarized-light' | 'solarized-dark' | 'one-dark' | 'dracula';

export interface ThemeRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

/** The shape monaco.editor.defineTheme takes. */
export interface ThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: ThemeRule[];
  colors: Record<string, string>;
}

interface Palette {
  dark: boolean;
  bg: string;
  fg: string;
  lineHighlight: string;
  selection: string;
  cursor: string;
  lineNumber: string;
  lineNumberActive: string;
  indentGuide: string;
  comment: string;
  keyword: string;
  string: string;
  escape: string;
  number: string;
  type: string;
  /** Builtins and library names: Zig's @builtins, Python's predefined names, decorators. */
  predefined: string;
  constant: string;
}

const hex = (c: string) => c.replace('#', '');

function themeFromPalette(p: Palette): ThemeData {
  const rule = (token: string, color: string, fontStyle?: string): ThemeRule => ({ token, foreground: hex(color), ...(fontStyle ? { fontStyle } : {}) });
  return {
    base: p.dark ? 'vs-dark' : 'vs',
    inherit: true,
    // Monaco matches rules by prefix, so "keyword" covers "keyword.directive.cpp".
    rules: [
      rule('', p.fg),
      rule('identifier', p.fg),
      rule('variable', p.fg),
      rule('delimiter', p.fg),
      rule('operator', p.fg),
      rule('comment', p.comment, 'italic'),
      rule('keyword', p.keyword),
      rule('string', p.string),
      rule('string.escape', p.escape),
      rule('regexp', p.escape),
      rule('number', p.number),
      rule('type', p.type),
      rule('predefined', p.predefined),
      rule('annotation', p.predefined),
      rule('tag', p.predefined),
      rule('attribute', p.predefined),
      rule('metatag', p.keyword),
      rule('constant', p.constant),
    ],
    colors: {
      'editor.background': p.bg,
      'editor.foreground': p.fg,
      'editor.lineHighlightBackground': p.lineHighlight,
      'editor.selectionBackground': p.selection,
      'editorCursor.foreground': p.cursor,
      'editorLineNumber.foreground': p.lineNumber,
      'editorLineNumber.activeForeground': p.lineNumberActive,
      'editorIndentGuide.background1': p.indentGuide,
      'editorWhitespace.foreground': p.indentGuide,
    },
  };
}

const PALETTES: Record<string, Palette> = {
  'codr-light': {
    dark: false,
    bg: '#ffffff',
    fg: '#15171c',
    lineHighlight: '#f4f5f7',
    selection: '#d5dafb',
    cursor: '#2b3bd6',
    lineNumber: '#878d98',
    lineNumberActive: '#484e59',
    indentGuide: '#eceef1',
    comment: '#6b717d',
    keyword: '#2b3bd6',
    string: '#157a4a',
    escape: '#a0266d',
    number: '#a84a0c',
    type: '#8a2f8f',
    predefined: '#0f6f8a',
    constant: '#a84a0c',
  },
  'codr-dark': {
    dark: true,
    bg: '#1a1d23',
    fg: '#d4d7de',
    lineHighlight: '#20242b',
    selection: '#323a6a',
    cursor: '#8d9aff',
    lineNumber: '#6a7180',
    lineNumberActive: '#a8aeba',
    indentGuide: '#242830',
    comment: '#808792',
    keyword: '#8d9aff',
    string: '#6fd3a0',
    escape: '#f08cc0',
    number: '#f59a62',
    type: '#e08ad8',
    predefined: '#5fc6e0',
    constant: '#f59a62',
  },
  'github-light': {
    dark: false,
    bg: '#ffffff',
    fg: '#1f2328',
    lineHighlight: '#f6f8fa',
    selection: '#cfe3ff',
    cursor: '#0969da',
    lineNumber: '#8c959f',
    lineNumberActive: '#1f2328',
    indentGuide: '#eaeef2',
    comment: '#6e7781',
    keyword: '#cf222e',
    string: '#0a3069',
    escape: '#116329',
    number: '#0550ae',
    type: '#953800',
    predefined: '#8250df',
    constant: '#0550ae',
  },
  'github-dark': {
    dark: true,
    bg: '#0d1117',
    fg: '#e6edf3',
    lineHighlight: '#161b22',
    selection: '#264f78',
    cursor: '#58a6ff',
    lineNumber: '#6e7681',
    lineNumberActive: '#e6edf3',
    indentGuide: '#21262d',
    comment: '#8b949e',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    escape: '#7ee787',
    number: '#79c0ff',
    type: '#ffa657',
    predefined: '#d2a8ff',
    constant: '#79c0ff',
  },
  'solarized-light': {
    dark: false,
    bg: '#fdf6e3',
    fg: '#586e75',
    lineHighlight: '#eee8d5',
    selection: '#e4dcc4',
    cursor: '#586e75',
    lineNumber: '#808f8f',
    lineNumberActive: '#586e75',
    indentGuide: '#eee8d5',
    comment: '#637272',
    keyword: '#667500',
    string: '#207b74',
    escape: '#c24815',
    number: '#cb2c79',
    type: '#8c6a00',
    predefined: '#2074af',
    constant: '#6166c0',
  },
  'solarized-dark': {
    dark: true,
    bg: '#002b36',
    fg: '#93a1a1',
    lineHighlight: '#073642',
    selection: '#0e4a5a',
    cursor: '#93a1a1',
    lineNumber: '#62808a',
    lineNumberActive: '#93a1a1',
    indentGuide: '#073642',
    comment: '#7a939b',
    keyword: '#859900',
    string: '#2aa198',
    escape: '#e96833',
    number: '#de66a0',
    type: '#b58900',
    predefined: '#3295da',
    constant: '#858ace',
  },
  'one-dark': {
    dark: true,
    bg: '#282c34',
    fg: '#abb2bf',
    lineHighlight: '#2c313c',
    selection: '#3e4451',
    cursor: '#528bff',
    lineNumber: '#737b8c',
    lineNumberActive: '#abb2bf',
    indentGuide: '#3b4048',
    comment: '#8e95a2',
    keyword: '#c678dd',
    string: '#98c379',
    escape: '#56b6c2',
    number: '#d19a66',
    type: '#e5c07b',
    predefined: '#61afef',
    constant: '#e2747d',
  },
  dracula: {
    dark: true,
    bg: '#282a36',
    fg: '#f8f8f2',
    lineHighlight: '#303341',
    selection: '#44475a',
    cursor: '#f8f8f2',
    lineNumber: '#6f7db0',
    lineNumberActive: '#f8f8f2',
    indentGuide: '#3a3d4c',
    comment: '#8692b9',
    keyword: '#ff79c6',
    string: '#f1fa8c',
    escape: '#ffb86c',
    number: '#bd93f9',
    type: '#8be9fd',
    predefined: '#50fa7b',
    constant: '#bd93f9',
  },
};

/** Every Monaco theme to register, by Monaco theme name. */
export const MONACO_THEMES: Record<string, ThemeData> = Object.fromEntries(
  Object.entries(PALETTES).map(([name, palette]) => [name, themeFromPalette(palette)]),
);

/** The themes offered in editor settings, in menu order. */
export const EDITOR_THEMES: { id: EditorThemeId; label: string }[] = [
  { id: 'codr', label: 'Codr (follows app theme)' },
  { id: 'github-light', label: 'GitHub Light' },
  { id: 'github-dark', label: 'GitHub Dark' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'dracula', label: 'Dracula' },
];

/** The Monaco theme name for a setting; Codr follows the app's light or dark theme. */
export function monacoThemeName(id: EditorThemeId, app: 'light' | 'dark'): string {
  return id === 'codr' ? `codr-${app}` : id;
}

function luminance(color: string): number {
  const n = hex(color);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
