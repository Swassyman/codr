// Zig syntax highlighting. Monaco ships no Zig grammar, so this is a small
// Monarch tokenizer covering keywords, types, builtins, literals and comments.
import type * as Monaco from 'monaco-editor/editor';

export function registerZig(monaco: typeof Monaco) {
  monaco.languages.register({ id: 'zig', extensions: ['.zig'], aliases: ['Zig', 'zig'] });
  monaco.languages.setLanguageConfiguration('zig', {
    comments: { lineComment: '//' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] },
    ],
  });
  monaco.languages.setMonarchTokensProvider('zig', {
    keywords: [
      'addrspace', 'align', 'allowzero', 'and', 'anyframe', 'anytype', 'asm', 'async', 'await', 'break', 'callconv', 'catch',
      'comptime', 'const', 'continue', 'defer', 'else', 'enum', 'errdefer', 'error', 'export', 'extern', 'fn', 'for', 'if',
      'inline', 'linksection', 'noalias', 'noinline', 'nosuspend', 'opaque', 'or', 'orelse', 'packed', 'pub', 'resume',
      'return', 'struct', 'suspend', 'switch', 'test', 'threadlocal', 'try', 'union', 'unreachable', 'usingnamespace', 'var',
      'volatile', 'while', 'true', 'false', 'null', 'undefined',
    ],
    typeKeywords: [
      'bool', 'void', 'noreturn', 'type', 'anyerror', 'anyopaque', 'comptime_int', 'comptime_float', 'isize', 'usize',
      'c_short', 'c_ushort', 'c_int', 'c_uint', 'c_long', 'c_ulong', 'c_longlong', 'c_ulonglong', 'c_char', 'f16', 'f32', 'f64', 'f80', 'f128',
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/@[a-zA-Z_]\w*/, 'predefined'],
        [/\b[iu]\d+\b/, 'type'],
        [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@default': 'identifier' } }],
        [/0x[0-9a-fA-F_]+/, 'number.hex'],
        [/0b[01_]+/, 'number.binary'],
        [/0o[0-7_]+/, 'number.octal'],
        [/\d[\d_]*(\.\d[\d_]*)?([eE][-+]?\d+)?/, 'number'],
        [/\\\\.*$/, 'string'],
        [/"/, 'string', '@string'],
        [/'(\\.|[^\\'])+'/, 'string'],
        [/[{}()[\]]/, '@brackets'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
    },
  });
}
