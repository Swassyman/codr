import { EventEmitter } from 'node:events';

/** Events pushed to a user's browser over SSE. */
export type ServerEvent =
  | { type: 'run'; runId: number; status: string }
  | { type: 'submission'; submissionId: number; questionId: number; contestId: number | null; status: string }
  | { type: 'contest'; contestId: number; reason: string; questionId?: number };

/**
 * In-process pub/sub keyed by user. Codr runs as a single web process; a
 * multi-instance deployment would swap this for Postgres LISTEN/NOTIFY.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(userId: number, event: ServerEvent) {
    this.emitter.emit(`user:${userId}`, event);
  }

  subscribe(userId: number, listener: (event: ServerEvent) => void) {
    const key = `user:${userId}`;
    this.emitter.on(key, listener);
    return () => {
      this.emitter.off(key, listener);
    };
  }
}
