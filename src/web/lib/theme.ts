import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const KEY = 'codr-theme';

function systemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  window.dispatchEvent(new CustomEvent('codr-theme'));
}

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function useThemePreference() {
  const [pref, setPref] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    apply(pref);
    try {
      if (pref === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch {
      // Storage unavailable (private mode): the choice lasts for this page only.
    }
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  return [pref, setPref] as const;
}

/** The theme actually in effect, for components that need it in JS (Monaco). */
export function useResolvedTheme(): 'light' | 'dark' {
  const read = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const update = () => setTheme(read());
    window.addEventListener('codr-theme', update);
    return () => window.removeEventListener('codr-theme', update);
  }, []);
  return theme;
}
