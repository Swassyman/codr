import type { LanguageId } from '../../shared/languages';
import type { ExecutionSummary } from '../../shared/types';

/**
 * Engine-neutral execution interface. The web server never runs user code
 * itself; every execution goes through a Runner (Piston by default).
 */
export interface ExecuteRequest {
  language: LanguageId;
  source: string;
  stdin: string;
  /** CPU time limit for the run stage. */
  timeLimitMs: number;
  memoryLimitMb: number;
  /** Wall-clock limit; defaults to twice the CPU limit plus one second. */
  wallTimeLimitMs?: number;
}

export interface RuntimeInfo {
  language: LanguageId;
  version: string;
}

export interface Runner {
  readonly engine: string;
  /** Languages from the catalog that the engine can currently run. */
  runtimes(): Promise<RuntimeInfo[]>;
  execute(request: ExecuteRequest): Promise<ExecutionSummary>;
}

export function wallLimit(request: ExecuteRequest) {
  return request.wallTimeLimitMs ?? request.timeLimitMs * 2 + 1000;
}

export function internalError(message: string): ExecutionSummary {
  return {
    status: 'internal_error',
    stdout: '',
    stderr: '',
    compileOutput: null,
    exitCode: null,
    signal: null,
    timeMs: null,
    memoryKb: null,
    message,
  };
}
