import { describe, expect, it } from 'vitest';
import * as cpp from 'monaco-editor/languages/definitions/cpp/cpp';
import * as go from 'monaco-editor/languages/definitions/go/go';
import * as java from 'monaco-editor/languages/definitions/java/java';
import * as rust from 'monaco-editor/languages/definitions/rust/rust';
import { EDITOR_THEMES, MONACO_THEMES, contrastRatio, monacoThemeName } from '../../src/web/lib/editor-themes';
import { registerZig } from '../../src/web/lib/monaco-zig';

/** Token classes a Monarch tokenizer can emit, e.g. "keyword", "string.escape". */
function monarchTokens(language: { tokenizer: Record<string, unknown[]> }): Set<string> {
  const out = new Set<string>();
  const visit = (action: unknown): void => {
    if (typeof action === 'string') {
      if (action === '@brackets') out.add('delimiter');
      else if (action && !action.startsWith('@') && !action.includes('$')) out.add(action);
      return;
    }
    if (Array.isArray(action)) return action.forEach(visit);
    if (action && typeof action === 'object') {
      const a = action as { token?: unknown; cases?: Record<string, unknown> };
      if (a.token !== undefined) visit(a.token);
      if (a.cases) Object.values(a.cases).forEach(visit);
    }
  };
  for (const rules of Object.values(language.tokenizer)) {
    for (const rule of rules) {
      if (Array.isArray(rule)) visit(rule[1]);
      else if (rule && typeof rule === 'object' && 'action' in rule) visit((rule as { action: unknown }).action);
    }
  }
  return out;
}

function zigLanguage() {
  let captured: { tokenizer: Record<string, unknown[]> } | null = null;
  const fake = {
    languages: {
      register: () => undefined,
      setLanguageConfiguration: () => undefined,
      setMonarchTokensProvider: (_id: string, def: typeof captured) => void (captured = def),
    },
  };
  registerZig(fake as never);
  return captured!;
}

const grammars: Record<string, { tokenizer: Record<string, unknown[]> }> = { zig: zigLanguage(), cpp: cpp.language, go: go.language, java: java.language, rust: rust.language };

// Monaco matches theme rules by prefix: "keyword" covers "keyword.directive".
const covered = (rules: { token: string }[], token: string) => rules.some((r) => r.token !== '' && (token === r.token || token.startsWith(`${r.token}.`)));

describe('editor themes', () => {
  it('offers Codr first and registers every offered theme in light and dark where it follows the app', () => {
    expect(EDITOR_THEMES[0]!.id).toBe('codr');
    for (const { id } of EDITOR_THEMES) {
      for (const app of ['light', 'dark'] as const) expect(MONACO_THEMES[monacoThemeName(id, app)], `${id} (${app})`).toBeDefined();
    }
    expect(monacoThemeName('codr', 'dark')).toBe('codr-dark');
    expect(monacoThemeName('dracula', 'light')).toBe('dracula');
  });

  for (const [name, theme] of Object.entries(MONACO_THEMES)) {
    describe(name, () => {
      const bg = theme.colors['editor.background']!;

      it('keeps code text at WCAG AA contrast (4.5:1)', () => {
        expect(contrastRatio(theme.colors['editor.foreground']!, bg)).toBeGreaterThanOrEqual(4.5);
        for (const rule of theme.rules) {
          if (rule.foreground) expect(contrastRatio(`#${rule.foreground}`, bg), `${rule.token || 'default'} #${rule.foreground}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrastRatio(theme.colors['editorLineNumber.activeForeground']!, bg)).toBeGreaterThanOrEqual(4.5);
      });

      it('keeps line numbers readable (3:1)', () => {
        expect(contrastRatio(theme.colors['editorLineNumber.foreground']!, bg)).toBeGreaterThanOrEqual(3);
      });

      it('colours every token the grammars emit, Zig included', () => {
        for (const [language, grammar] of Object.entries(grammars)) {
          for (const token of monarchTokens(grammar)) {
            if (token === 'white' || token === 'invalid' || token.startsWith('comment.') || token === 'source') continue;
            expect(covered(theme.rules, token), `${language}: ${token}`).toBe(true);
          }
        }
        for (const token of ['predefined', 'type', 'string.escape', 'number.hex', 'comment', 'keyword']) {
          expect(covered(theme.rules, token), `zig: ${token}`).toBe(true);
        }
      });
    });
  }
});
