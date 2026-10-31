import { describe, expect, it } from 'vitest';
import { matchShortcut, type KeyLike } from '../../src/web/lib/shortcuts';

const key = (code: string, mods: Partial<KeyLike> = {}, k = code.replace(/^Key/, '').toLowerCase()): KeyLike => ({
  code,
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('workspace shortcuts', () => {
  it('runs and submits with Ctrl or Cmd + Enter', () => {
    expect(matchShortcut(key('Enter', { ctrlKey: true }, 'Enter'))).toBe('run');
    expect(matchShortcut(key('Enter', { metaKey: true }, 'Enter'))).toBe('run');
    expect(matchShortcut(key('NumpadEnter', { ctrlKey: true }, 'Enter'))).toBe('run');
    expect(matchShortcut(key('Enter', { ctrlKey: true, shiftKey: true }, 'Enter'))).toBe('submit');
    expect(matchShortcut(key('Enter', {}, 'Enter'))).toBeNull();
  });

  it('matches the layout keys by physical key, including macOS Option characters', () => {
    expect(matchShortcut(key('KeyZ', { altKey: true }))).toBe('zen');
    expect(matchShortcut(key('KeyZ', { altKey: true }, 'Ω'))).toBe('zen');
    expect(matchShortcut(key('KeyP', { altKey: true }, 'π'))).toBe('peek');
    expect(matchShortcut(key('KeyF', { altKey: true, shiftKey: true }, 'Ï'))).toBe('fullscreen');
  });

  it('leaves ordinary editing keys alone', () => {
    expect(matchShortcut(key('KeyZ', { ctrlKey: true }))).toBeNull(); // undo
    expect(matchShortcut(key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBeNull(); // redo
    expect(matchShortcut(key('KeyF', { altKey: true }))).toBeNull(); // browser menu on Windows and Linux
    expect(matchShortcut(key('KeyZ', { altKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(key('Escape', {}, 'Escape'))).toBeNull(); // Vim and Monaco need Esc
  });

  it('never matches AltGr (Ctrl+Alt), which types characters on many layouts', () => {
    expect(matchShortcut(key('KeyZ', { altKey: true, ctrlKey: true }, 'ż'))).toBeNull();
    expect(matchShortcut(key('KeyP', { altKey: true, ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key('Enter', { altKey: true, ctrlKey: true }, 'Enter'))).toBeNull();
  });
});
