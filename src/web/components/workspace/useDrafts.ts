import { useCallback, useEffect, useRef, useState } from 'react';
import { LANGUAGES, type LanguageId } from '../../../shared/languages';
import type { DraftDTO } from '../../../shared/api';
import { api, ApiError } from '../../lib/api';
import { serverClock } from '../../lib/server-time';

export type DraftState = 'saved' | 'saving' | 'pending' | 'local' | 'blocked';

interface LocalDraft {
  code: string;
  /** Estimated server time of the edit, so it can be compared with server drafts. */
  at: number;
}

const storageKey = (scope: string, language: LanguageId) => `codr-draft:${scope}:${language}`;

function readLocal(scope: string, language: LanguageId): LocalDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(scope, language));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

function writeLocal(scope: string, language: LanguageId, code: string) {
  try {
    localStorage.setItem(storageKey(scope, language), JSON.stringify({ code, at: serverClock.now() } satisfies LocalDraft));
  } catch {
    // Storage full or disabled: the server copy still exists.
  }
}

/**
 * Editor content per language. The server keeps the authoritative draft
 * (debounced saves); localStorage keeps a copy so a dropped connection or a
 * closed tab loses nothing. Whichever copy is newer wins on load.
 */
export function useDrafts(opts: {
  scope: string;
  serverDrafts: DraftDTO[];
  starterCode: Partial<Record<LanguageId, string>>;
  draftUrl: string;
  /** Contest rules can stop saving (question locked or time up). */
  disabled?: boolean;
  onBlocked?: (err: ApiError) => void;
}) {
  const { scope, draftUrl, disabled } = opts;
  const initialCode = useCallback(
    (language: LanguageId) => {
      const server = opts.serverDrafts.find((d) => d.language === language);
      const local = readLocal(scope, language);
      if (server && local) return local.at > Date.parse(server.updatedAt) + 1000 ? local.code : server.code;
      return local?.code ?? server?.code ?? opts.starterCode[language] ?? LANGUAGES[language].template;
    },
    // Initial values only; later server drafts never overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope],
  );

  const [codes, setCodes] = useState<Partial<Record<LanguageId, string>>>({});
  const [state, setState] = useState<DraftState>('saved');
  const pending = useRef<Map<LanguageId, string>>(new Map());
  const timer = useRef<number | undefined>(undefined);
  const blockedRef = useRef(false);
  const onBlockedRef = useRef(opts.onBlocked);
  onBlockedRef.current = opts.onBlocked;

  const codeFor = (language: LanguageId) => codes[language] ?? initialCode(language);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (blockedRef.current || disabled || pending.current.size === 0) return;
    const batch = [...pending.current.entries()];
    pending.current.clear();
    setState('saving');
    for (const [language, code] of batch) {
      try {
        await api.put(draftUrl, { language, code });
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          // Offline: keep it locally and retry later.
          pending.current.set(language, code);
          setState('local');
          timer.current = window.setTimeout(() => void flush(), 5000);
          return;
        }
        if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
          blockedRef.current = true;
          setState('blocked');
          onBlockedRef.current?.(err);
          return;
        }
        pending.current.set(language, code);
        setState('local');
        return;
      }
    }
    setState(pending.current.size ? 'pending' : 'saved');
  }, [draftUrl, disabled]);

  const setCode = useCallback(
    (language: LanguageId, code: string) => {
      setCodes((c) => ({ ...c, [language]: code }));
      writeLocal(scope, language, code);
      if (disabled || blockedRef.current) return;
      pending.current.set(language, code);
      setState('pending');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 1200);
    },
    [scope, disabled, flush],
  );

  // Save before the tab goes away or the component unmounts.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void flush();
    };
  }, [flush]);

  return { codeFor, setCode, flush, state };
}
