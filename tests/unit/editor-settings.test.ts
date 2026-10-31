import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  readSettings,
  readZen,
  settingsKey,
  writeSettings,
  writeZen,
  zenKey,
  type StorageLike,
} from '../../src/web/lib/editor-settings';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('editor settings parsing', () => {
  it('gives the defaults for nothing stored', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ keyBindings: 'default', tabWidth: 4, theme: 'codr', alwaysShowTimer: false });
  });

  it('keeps valid values', () => {
    const stored = { keyBindings: 'vim', tabWidth: 2, theme: 'dracula', alwaysShowTimer: true };
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
    expect(parseSettings(JSON.stringify({ keyBindings: 'emacs', tabWidth: 8, theme: 'solarized-light' }))).toMatchObject({
      keyBindings: 'emacs',
      tabWidth: 8,
      theme: 'solarized-light',
    });
  });

  it('falls back to defaults for anything that is not a settings object', () => {
    for (const raw of ['', 'not json', '{', 'null', '42', '"vim"', '[1,2]', 'true']) {
      expect(parseSettings(raw), raw).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('replaces each invalid field on its own and keeps the valid ones', () => {
    const parsed = parseSettings(JSON.stringify({ keyBindings: 'nano', tabWidth: 3, theme: 'monokai', alwaysShowTimer: true }));
    expect(parsed).toEqual({ ...DEFAULT_SETTINGS, alwaysShowTimer: true });
    expect(parseSettings(JSON.stringify({ tabWidth: '2', keyBindings: 'vim' }))).toEqual({ ...DEFAULT_SETTINGS, keyBindings: 'vim' });
    expect(parseSettings(JSON.stringify({ alwaysShowTimer: 'yes' })).alwaysShowTimer).toBe(false);
    expect(parseSettings(JSON.stringify({ theme: { id: 'dracula' } })).theme).toBe('codr');
  });

  it('ignores unknown fields', () => {
    expect(parseSettings(JSON.stringify({ fontSize: 30, tabWidth: 8 }))).toEqual({ ...DEFAULT_SETTINGS, tabWidth: 8 });
  });
});

describe('settings persistence', () => {
  it('stores per account and reads back what was written', () => {
    const storage = memoryStorage();
    const next = { ...DEFAULT_SETTINGS, keyBindings: 'vim' as const, theme: 'github-dark' as const };
    expect(writeSettings(storage, 12, next)).toBe(true);
    expect(Object.keys(storage.data)).toEqual([settingsKey(12)]);
    expect(readSettings(storage, 12)).toEqual(next);
    expect(readSettings(storage, 13)).toEqual(DEFAULT_SETTINGS);
  });

  it('validates stored values on read', () => {
    const storage = memoryStorage({ [settingsKey(1)]: JSON.stringify({ keyBindings: 'vim', tabWidth: 5 }) });
    expect(readSettings(storage, 1)).toEqual({ ...DEFAULT_SETTINGS, keyBindings: 'vim' });
  });

  it('survives storage that is missing or throws', () => {
    expect(readSettings(null, 1)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(throwing, 1)).toEqual(DEFAULT_SETTINGS);
    expect(writeSettings(null, 1, DEFAULT_SETTINGS)).toBe(false);
    expect(writeSettings(throwing, 1, DEFAULT_SETTINGS)).toBe(false);
  });

  it('remembers zen per account, off unless stored as on', () => {
    const storage = memoryStorage();
    expect(readZen(storage, 4)).toBe(false);
    expect(writeZen(storage, 4, true)).toBe(true);
    expect(storage.data[zenKey(4)]).toBe('on');
    expect(readZen(storage, 4)).toBe(true);
    expect(readZen(storage, 5)).toBe(false);
    writeZen(storage, 4, false);
    expect(readZen(storage, 4)).toBe(false);
    expect(readZen(memoryStorage({ [zenKey(4)]: 'yes' }), 4)).toBe(false);
    expect(readZen(throwing, 4)).toBe(false);
    expect(writeZen(throwing, 4, true)).toBe(false);
  });
});
