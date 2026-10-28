import { useEffect, useState } from 'react';

/**
 * Tracks the offset between this browser's clock and the server's. The server
 * is the only authority on time; this exists purely so countdowns display the
 * right value. Samples come from the x-server-time response header (corrected
 * by half the round trip) and from SSE time events.
 */
let offsetMs = 0;
let bestRtt = Number.POSITIVE_INFINITY;
let lastSampleAt = 0;
const listeners = new Set<() => void>();

function setOffset(next: number) {
  if (Math.abs(next - offsetMs) < 50) return;
  offsetMs = next;
  listeners.forEach((l) => l());
}

export const serverClock = {
  now: () => Date.now() + offsetMs,
  offset: () => offsetMs,

  /** From an HTTP response: serverMs was stamped while the request was in flight. */
  observeResponse(serverMs: number, sentAt: number, receivedAt: number) {
    const rtt = receivedAt - sentAt;
    const stale = Date.now() - lastSampleAt > 30_000;
    // Prefer low-latency samples; a slow response's timestamp is less precise.
    if (rtt <= bestRtt * 1.5 + 20 || stale) {
      bestRtt = stale ? rtt : Math.min(bestRtt, rtt);
      lastSampleAt = Date.now();
      setOffset(serverMs + rtt / 2 - receivedAt);
    }
  },

  /** From an SSE event: on a LAN the one-way delay is negligible. */
  observeEvent(serverIso: string) {
    const serverMs = Date.parse(serverIso);
    if (Number.isNaN(serverMs)) return;
    if (Date.now() - lastSampleAt > 30_000) {
      lastSampleAt = Date.now();
      setOffset(serverMs - Date.now());
    }
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Re-renders every `intervalMs` with the current server time in ms. */
export function useServerNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => serverClock.now());
  useEffect(() => {
    const tick = () => setNow(serverClock.now());
    const id = window.setInterval(tick, intervalMs);
    const unsubscribe = serverClock.subscribe(tick);
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, [intervalMs]);
  return now;
}
