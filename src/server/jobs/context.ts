import type { Logger } from 'pino';
import type { Clock } from '../clock';
import type { DB } from '../db';
import type { EventBus } from '../events';
import type { Runner } from '../runner/types';
import type { ExecutionPool } from './pool';

/** Everything a background job needs; shared by the run processor and the judge. */
export interface JobContext {
  db: DB;
  runner: Runner;
  pool: ExecutionPool;
  clock: Clock;
  events: EventBus;
  log: Logger;
}

const PREVIEW_LIMIT = 64 * 1024;

/** Shortens long text for storage/display; full output is only kept where needed. */
export function clip(text: string, limit = PREVIEW_LIMIT) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… truncated (${text.length.toLocaleString('en')} characters in total)`;
}
