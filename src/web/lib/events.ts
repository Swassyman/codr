import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { serverClock } from './server-time';

type ConnectionState = 'connecting' | 'open' | 'reconnecting';
let state: ConnectionState = 'connecting';
const listeners = new Set<() => void>();
const setState = (next: ConnectionState) => {
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
};

/** Live connection status, for the "reconnecting" indicator. */
export function useConnectionState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/**
 * One SSE stream per signed-in tab. Events only invalidate queries; the data
 * itself is always re-read from the API so authorization rules apply.
 */
export function useServerEvents(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/api/events');
    const parse = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.serverTime) serverClock.observeEvent(data.serverTime);
        return data;
      } catch {
        return null;
      }
    };
    source.onopen = () => {
      // After a reconnect, anything may have changed while we were away.
      if (state === 'reconnecting') void qc.invalidateQueries();
      setState('open');
    };
    source.onerror = () => setState('reconnecting');
    source.addEventListener('time', (e) => parse(e as MessageEvent));
    source.addEventListener('run', (e) => {
      const data = parse(e as MessageEvent);
      if (data) void qc.invalidateQueries({ queryKey: ['run', data.runId] });
    });
    source.addEventListener('submission', (e) => {
      const data = parse(e as MessageEvent);
      if (!data) return;
      void qc.invalidateQueries({ queryKey: ['submission', data.submissionId] });
      void qc.invalidateQueries({ queryKey: ['submissions'] });
    });
    source.addEventListener('contest', (e) => {
      const data = parse(e as MessageEvent);
      if (!data) return;
      void qc.invalidateQueries({ queryKey: ['contest', data.contestId] });
      void qc.invalidateQueries({ queryKey: ['contest-state', data.contestId] });
    });
    return () => {
      source.close();
      setState('connecting');
    };
  }, [enabled, qc]);
}
