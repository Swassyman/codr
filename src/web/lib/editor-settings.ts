import { useCallback, useSyncExternalStore } from 'react';
import { EDITOR_THEMES, type EditorThemeId } from './editor-themes';

// Editor settings and the zen preference, per account on this device. They
// change presentation and input only: autocomplete and paste handling stay
// with the contest rules (Workspace), whatever is stored here.
//
// Stored in localStorage only. The app has no per-user preferences on the
// server (the autocomplete choice is kept the same way), and these are cheap
// to set again on another machine.

export type KeyBindings = 'default' | 'vim' | 'emacs';
export type TabWidth = 2 | 4 | 8;

export interface EditorSettings {
  keyBindings: KeyBindings;
  tabWidth: TabWidth;
  theme: EditorThemeId;
  /** Keep the contest timer visible instead of revealing it on hover or click. */
  alwaysShowTimer: boolean;
}

export const KEY_BINDINGS: readonly KeyBindings[] = ['default', 'vim', 'emacs'];
export const TAB_WIDTHS: readonly TabWidth[] = [2, 4, 8];

export const DEFAULT_SETTINGS: EditorSettings = Object.freeze({
  keyBindings: 'default',
  tabWidth: 4,
  theme: 'codr',
  alwaysShowTimer: false,
});

/** The subset of Storage the helpers use, so tests can pass a fake. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export const settingsKey = (userId: number | null) => `codr-editor:u${userId ?? 0}`;
export const zenKey = (userId: number | null) => `codr-zen:u${userId ?? 0}`;

const oneOf = <T>(options: readonly T[], value: unknown, fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);

/**
 * Settings from a stored value. Each field is checked on its own and falls
 * back to its default when missing or invalid, so one bad field (an old
 * version, a hand edit) doesn't reset the rest.
 */
export function parseSettings(raw: string | null): EditorSettings {
  let data: unknown = null;
  try {
    data = raw == null ? null : JSON.parse(raw);
  } catch {
    data = null;
  }
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return {
    keyBindings: oneOf(KEY_BINDINGS, obj.keyBindings, DEFAULT_SETTINGS.keyBindings),
    tabWidth: oneOf(TAB_WIDTHS, obj.tabWidth, DEFAULT_SETTINGS.tabWidth),
    theme: oneOf(
      EDITOR_THEMES.map((t) => t.id),
      obj.theme,
      DEFAULT_SETTINGS.theme,
    ),
    alwaysShowTimer: typeof obj.alwaysShowTimer === 'boolean' ? obj.alwaysShowTimer : DEFAULT_SETTINGS.alwaysShowTimer,
  };
}

/** Reads settings; unavailable storage (private mode, blocked) gives the defaults. */
export function readSettings(storage: StorageLike | null, userId: number | null): EditorSettings {
  try {
    return parseSettings(storage?.getItem(settingsKey(userId)) ?? null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Writes settings; returns false when storage refused (the change still applies until the page closes). */
export function writeSettings(storage: StorageLike | null, userId: number | null, settings: EditorSettings): boolean {
  try {
    if (!storage) return false;
    storage.setItem(settingsKey(userId), JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function readZen(storage: StorageLike | null, userId: number | null): boolean {
  try {
    return storage?.getItem(zenKey(userId)) === 'on';
  } catch {
    return false;
  }
}

export function writeZen(storage: StorageLike | null, userId: number | null, on: boolean): boolean {
  try {
    if (!storage) return false;
    storage.setItem(zenKey(userId), on ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// One shared copy per account, so the settings popover, the editor and the
// contest clock agree without remounting anything. Changes from another tab
// arrive through the storage event.
const cache = new Map<number, EditorSettings>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

function onStorage(e: StorageEvent) {
  if (e.key == null || e.key.startsWith('codr-editor:')) {
    cache.clear();
    notify();
  }
}

function snapshot(userId: number) {
  let value = cache.get(userId);
  if (!value) {
    value = readSettings(browserStorage(), userId);
    cache.set(userId, value);
  }
  return value;
}

export function useEditorSettings(userId: number | null) {
  const id = userId ?? 0;
  const settings = useSyncExternalStore(
    subscribe,
    () => snapshot(id),
    () => DEFAULT_SETTINGS,
  );
  const update = useCallback(
    (patch: Partial<EditorSettings>) => {
      const next = { ...snapshot(id), ...patch };
      cache.set(id, next);
      writeSettings(browserStorage(), id, next);
      notify();
    },
    [id],
  );
  return [settings, update] as const;
}

export const zenStorage = {
  read: (userId: number | null) => readZen(browserStorage(), userId),
  write: (userId: number | null, on: boolean) => writeZen(browserStorage(), userId, on),
};
