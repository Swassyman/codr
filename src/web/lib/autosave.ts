import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { ApiError } from './api';
import type { SaveState } from '../components/form-bits';

/**
 * Debounced autosave for a form whose fields can be saved independently.
 * Each field is validated on its own; invalid fields stay local (with an inline
 * error) while valid ones are sent. Field errors from the server are merged in.
 */
export function useAutosave<T extends Record<string, unknown>>(opts: {
  initial: T;
  shape: Partial<Record<keyof T, z.ZodType>>;
  save: (patch: Partial<T>) => Promise<unknown>;
  delayMs?: number;
}) {
  const { shape, save, delayMs = 700 } = opts;
  const [values, setValues] = useState<T>(opts.initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<SaveState>('saved');
  const [lastError, setLastError] = useState<string | null>(null);
  const pending = useRef<Partial<T>>({});
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    const valid: Partial<T> = {};
    const nextErrors: Record<string, string> = {};
    for (const [key, value] of Object.entries(patch)) {
      const schema = shape[key as keyof T];
      const result = schema ? schema.safeParse(value) : { success: true as const, data: value };
      if (result.success) valid[key as keyof T] = result.data as T[keyof T];
      else nextErrors[key] = result.error.issues[0]?.message ?? 'Invalid value.';
    }
    setErrors((prev) => {
      const merged = { ...prev };
      for (const key of Object.keys(patch)) delete merged[key];
      return { ...merged, ...nextErrors };
    });
    if (Object.keys(valid).length === 0) {
      setState(Object.keys(nextErrors).length ? 'error' : 'saved');
      setLastError(Object.keys(nextErrors).length ? 'Fix the highlighted fields' : null);
      return;
    }
    setState('saving');
    try {
      await saveRef.current(valid);
      setLastError(null);
      setState(Object.keys(nextErrors).length ? 'error' : Object.keys(pending.current).length ? 'dirty' : 'saved');
      if (Object.keys(nextErrors).length) setLastError('Fix the highlighted fields');
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Offline: put the patch back and retry shortly.
        pending.current = { ...valid, ...pending.current };
        setState('offline');
        timer.current = window.setTimeout(() => void flush(), 3000);
        return;
      }
      if (err instanceof ApiError) setErrors((prev) => ({ ...prev, ...err.fieldErrors }));
      setLastError(err instanceof Error ? err.message : 'Not saved');
      setState('error');
    }
  }, [shape]);

  const update = useCallback(
    (patch: Partial<T>) => {
      setValues((v) => ({ ...v, ...patch }));
      Object.assign(pending.current, patch);
      setState('dirty');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), delayMs);
    },
    [delayMs, flush],
  );

  // Warn before closing the tab with unsaved edits, and flush on unmount.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (Object.keys(pending.current).length) void flush();
    };
  }, [flush]);

  return { values, update, errors, state, lastError, flush, setValues };
}
