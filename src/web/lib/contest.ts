import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContestLobbyDTO, ContestStateDTO } from '../../shared/api';
import { api } from './api';

export function useContestLobby(id: number) {
  return useQuery({
    queryKey: ['contest', id],
    queryFn: () => api.get<ContestLobbyDTO>(`/api/contests/${id}`),
    refetchInterval: 30_000,
  });
}

/** Navigator state; refreshed by SSE contest events and periodically as a fallback. */
export function useContestState(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ['contest-state', id],
    queryFn: () => api.get<ContestStateDTO>(`/api/contests/${id}/state`),
    enabled,
    refetchInterval: 20_000,
  });
}

interface PendingEvent {
  type: 'blur' | 'focus' | 'paste';
  at: string;
  questionId?: number | null;
  chars?: number;
}

/**
 * Records tab switches and pastes for the organizer when the contest enables
 * it. Informational only: it cannot prevent cheating, and participants are
 * told it is on.
 */
export function useIntegrityTracker(contestId: number, enabled: boolean, questionId: number | null) {
  const queue = useRef<PendingEvent[]>([]);
  const questionRef = useRef(questionId);
  questionRef.current = questionId;

  const flush = useCallback(
    (keepalive = false) => {
      if (!enabled || queue.current.length === 0) return;
      const events = queue.current.splice(0, 200);
      const csrf = document.cookie.split('; ').find((c) => c.startsWith('codr_csrf='))?.slice('codr_csrf='.length) ?? '';
      void fetch(`/api/contests/${contestId}/integrity`, {
        method: 'POST',
        keepalive,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(csrf) },
        body: JSON.stringify({ events }),
      }).catch(() => {
        queue.current.unshift(...events);
      });
    },
    [contestId, enabled],
  );

  const record = useCallback(
    (type: PendingEvent['type'], chars?: number) => {
      if (!enabled) return;
      queue.current.push({ type, at: new Date().toISOString(), questionId: questionRef.current, ...(chars != null ? { chars } : {}) });
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => record(document.visibilityState === 'hidden' ? 'blur' : 'focus');
    const onBlur = () => record('blur');
    const onFocus = () => record('focus');
    const onHide = () => flush(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onHide);
    const timer = window.setInterval(() => flush(), 5000);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onHide);
      window.clearInterval(timer);
      flush(true);
    };
  }, [enabled, record, flush]);

  return { recordPaste: (chars: number) => record('paste', chars) };
}

export function timingSentence(c: Pick<ContestLobbyDTO, 'timingMode' | 'durationMinutes' | 'defaultQuestionMinutes'>, endsAtText: string) {
  switch (c.timingMode) {
    case 'fixed_window':
      return `Everyone works until ${endsAtText}.`;
    case 'personal_window':
      return `You get ${c.durationMinutes} minutes from the moment you press Start. You can start until ${endsAtText}.`;
    case 'per_question':
      return `Each question has its own timer${c.defaultQuestionMinutes ? ` (${c.defaultQuestionMinutes} minutes unless stated)` : ''}, starting when you first open it. When it runs out, your last saved code is submitted and the question locks. The contest closes at ${endsAtText}.`;
  }
}
