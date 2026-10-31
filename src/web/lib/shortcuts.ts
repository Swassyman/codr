// Workspace shortcuts. Each is matched by physical key (code), so they work on
// any layout and with Option on macOS, where the Alt combinations type
// characters such as "Ω". AltGr (Ctrl+Alt on Windows) never matches.
//
// The editor reserves these before Vim or Emacs key bindings see them (see
// Workspace), so neither keymap can swallow Run, Submit or the layout keys.

export type WorkspaceShortcut = 'run' | 'submit' | 'zen' | 'fullscreen' | 'peek';

export interface KeyLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export const SHORTCUT_LABELS: Record<WorkspaceShortcut, { mac: string; other: string }> = {
  run: { mac: '⌘↵', other: 'Ctrl+Enter' },
  submit: { mac: '⌘⇧↵', other: 'Ctrl+Shift+Enter' },
  zen: { mac: '⌥Z', other: 'Alt+Z' },
  fullscreen: { mac: '⌥⇧F', other: 'Alt+Shift+F' },
  peek: { mac: '⌥P', other: 'Alt+P' },
};

export function matchShortcut(e: KeyLike): WorkspaceShortcut | null {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter')) return e.shiftKey ? 'submit' : 'run';
  if (e.altKey && !mod) {
    if (e.code === 'KeyZ' && !e.shiftKey) return 'zen';
    if (e.code === 'KeyP' && !e.shiftKey) return 'peek';
    if (e.code === 'KeyF' && e.shiftKey) return 'fullscreen';
  }
  return null;
}
