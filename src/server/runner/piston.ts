import { LANGUAGE_IDS, LANGUAGES, type LanguageId } from '../../shared/languages';
import type { ExecutionSummary } from '../../shared/types';
import { internalError, wallLimit, type ExecuteRequest, type Runner, type RuntimeInfo } from './types';

/** Shape of one stage (compile or run) in Piston's /execute response. */
export interface PistonStage {
  stdout?: string;
  stderr?: string;
  output?: string;
  code: number | null;
  signal: string | null;
  message?: string | null;
  /** isolate status: RE, SG, TO, XX; Piston adds OL/EL for output limits. */
  status?: string | null;
  cpu_time?: number | null;
  wall_time?: number | null;
  /** Peak memory in bytes (Piston reports KiB × 1000). */
  memory?: number | null;
}

export interface PistonExecuteResponse {
  language: string;
  version: string;
  compile?: PistonStage;
  run: PistonStage;
}

export interface PistonRuntime {
  language: string;
  version: string;
  aliases: string[];
  runtime?: string;
}

const COMPILE_TIMEOUT_MS = 15_000;
const COMPILE_MEMORY_MB = 1024;
// Piston's isolate passes memory/1000 as KiB to --cg-mem, so scale by 1000 to hit exact MiB.
const mib = (mb: number) => mb * 1024 * 1000;

const MEMORY_ERROR_PATTERN =
  /MemoryError|OutOfMemoryError|heap out of memory|std::bad_alloc|memory allocation of \d+ bytes failed|Cannot allocate memory|runtime: out of memory/;

/**
 * Piston's gcc package compiles without optimisation. A leading pragma enables
 * -O2 and `#line 1` keeps compiler messages pointing at the user's line numbers.
 */
export function prepareSource(language: LanguageId, source: string) {
  if (language === 'cpp' || language === 'c') return `#pragma GCC optimize("O2")\n#line 1\n${source}`;
  return source;
}

const SIGNAL_NAMES: Record<number, string> = {
  4: 'Illegal instruction (SIGILL)',
  6: 'Aborted (SIGABRT)',
  7: 'Bus error (SIGBUS)',
  8: 'Floating point exception (SIGFPE), often a division by zero',
  9: 'Killed (SIGKILL)',
  11: 'Segmentation fault (SIGSEGV)',
};

/** Human-readable reason for a non-zero exit; shells report signal N as 128+N. */
export function describeExit(code: number | null, signal: string | null) {
  if (signal) return `Killed by ${signal}`;
  if (code != null && code > 128 && SIGNAL_NAMES[code - 128]) return SIGNAL_NAMES[code - 128]!;
  return code != null ? `Exited with code ${code}` : 'The program stopped unexpectedly.';
}

/** Extension that Piston's compile scripts append to the submitted file name ("main.cpp" becomes "main.cpp.cpp"). */
const APPENDED_EXTENSION: Partial<Record<LanguageId, string>> = { cpp: '.cpp', c: '.c', zig: '.zig' };

/**
 * Makes compiler output refer to the user's file: strips Piston's renamed file
 * suffix and its chmod noise, and rewrites GCC's source snippets (which read the
 * physical file, shifted by the injected pragma) from the original source.
 */
export function cleanCompileOutput(output: string, language: LanguageId, originalSource: string) {
  const file = LANGUAGES[language].piston.fileName;
  const appended = APPENDED_EXTENSION[language];
  const lines = originalSource.split('\n');
  return output
    .split('\n')
    .filter((l) => !/^chmod: cannot access 'a\.out'/.test(l))
    .map((l) => (appended ? l.replaceAll(`${file}${appended}`, file) : l))
    .map((l) => {
      if (language !== 'cpp' && language !== 'c') return l;
      const m = /^(\s*)(\d+) \| (.*)$/.exec(l);
      if (!m) return l;
      const original = lines[Number(m[2]) - 1];
      return original === undefined ? l : `${m[1]}${m[2]} | ${original}`;
    })
    .join('\n')
    .trimEnd();
}

export function compareVersions(a: string, b: string) {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The package a runtime comes from: `runtime` for multi-language packages (gcc, node), else its language. */
export const runtimePackage = (rt: PistonRuntime) => rt.runtime ?? rt.language;

/**
 * Picks the newest installed runtime for each catalog language, only from the
 * package the catalog names: Deno also provides "typescript" and "javascript",
 * but runs them differently from the tsc and Node.js packages.
 */
export function matchRuntimes(installed: PistonRuntime[]): Map<LanguageId, PistonRuntime> {
  const result = new Map<LanguageId, PistonRuntime>();
  for (const id of LANGUAGE_IDS) {
    const { language, package: pkg } = LANGUAGES[id].piston;
    const candidates = installed.filter((rt) => rt.language === language && runtimePackage(rt) === pkg);
    candidates.sort((a, b) => compareVersions(b.version, a.version));
    if (candidates[0]) result.set(id, candidates[0]);
  }
  return result;
}

/** Turns Piston's raw response into the engine-neutral summary. Pure, unit-tested. */
export function mapPistonResult(response: PistonExecuteResponse, request: ExecuteRequest): ExecutionSummary {
  const compile = response.compile;
  const compileError = (output: string, code: number | null, signal: string | null, message: string | null): ExecutionSummary => ({
    status: 'compile_error',
    stdout: '',
    stderr: '',
    compileOutput: cleanCompileOutput(output, request.language, request.source) || message || 'Compilation failed.',
    exitCode: code,
    signal,
    timeMs: null,
    memoryKb: null,
    message,
  });
  if (compile && (compile.code !== 0 || compile.status)) {
    const output = compile.output || [compile.stdout, compile.stderr].filter(Boolean).join('\n') || '';
    return compileError(output, compile.code, compile.signal, compile.status === 'TO' ? 'Compilation took too long.' : 'Compilation failed.');
  }

  const run = response.run;
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  // Java's single-file launcher compiles at run time, so its errors arrive here.
  if (request.language === 'java' && run.code !== 0 && /^error: compilation failed$/m.test(stderr)) {
    return compileError(stderr, run.code, run.signal, 'Compilation failed.');
  }
  const timeMs = run.cpu_time != null ? Math.round(run.cpu_time) : null;
  const memoryKb = run.memory != null ? Math.round(run.memory / 1000) : null;
  const memoryExhausted =
    (memoryKb != null && memoryKb >= request.memoryLimitMb * 1024 * 0.97) || MEMORY_ERROR_PATTERN.test(stderr);

  let status: ExecutionSummary['status'];
  switch (run.status) {
    case 'TO':
      status = 'time_limit';
      break;
    case 'OL':
    case 'EL':
      status = 'output_limit';
      break;
    case 'XX':
      status = 'internal_error';
      break;
    case 'SG':
    case 'RE':
      status = memoryExhausted ? 'memory_limit' : 'runtime_error';
      break;
    default:
      status = run.code === 0 ? 'ok' : memoryExhausted ? 'memory_limit' : 'runtime_error';
  }
  if (status === 'ok' && timeMs != null && timeMs > request.timeLimitMs) status = 'time_limit';

  let message = run.message ?? null;
  if (status === 'runtime_error') message = describeExit(run.code, run.signal);
  if (status === 'memory_limit') message = 'Memory limit exceeded.';

  return {
    status,
    stdout,
    stderr,
    compileOutput: compile?.output?.trim() ? cleanCompileOutput(compile.output, request.language, request.source) : null,
    exitCode: run.code,
    signal: run.signal,
    timeMs,
    memoryKb,
    message,
  };
}

export class PistonRunner implements Runner {
  readonly engine = 'piston';
  private cache: { at: number; list: PistonRuntime[] } | null = null;

  constructor(private readonly baseUrl: string) {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, '')}/api/v2${path}`;
  }

  async pistonRuntimes(force = false): Promise<PistonRuntime[]> {
    if (!force && this.cache && Date.now() - this.cache.at < 15_000) return this.cache.list;
    const res = await fetch(this.url('/runtimes'), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Runner responded ${res.status} to /runtimes`);
    const list = (await res.json()) as PistonRuntime[];
    this.cache = { at: Date.now(), list };
    return list;
  }

  async runtimes(): Promise<RuntimeInfo[]> {
    const matched = matchRuntimes(await this.pistonRuntimes());
    return [...matched.entries()].map(([language, rt]) => ({ language, version: rt.version }));
  }

  async execute(request: ExecuteRequest): Promise<ExecutionSummary> {
    let runtime: PistonRuntime | undefined;
    try {
      runtime = matchRuntimes(await this.pistonRuntimes()).get(request.language);
    } catch (err) {
      return internalError(`The code runner is unreachable: ${(err as Error).message}`);
    }
    if (!runtime) return internalError(`${LANGUAGES[request.language].label} is not installed on the code runner.`);

    const wall = wallLimit(request);
    const body = {
      language: runtime.language,
      version: runtime.version,
      files: [{ name: LANGUAGES[request.language].piston.fileName, content: prepareSource(request.language, request.source) }],
      stdin: request.stdin,
      compile_timeout: COMPILE_TIMEOUT_MS,
      compile_cpu_time: COMPILE_TIMEOUT_MS,
      compile_memory_limit: mib(COMPILE_MEMORY_MB),
      run_timeout: wall,
      run_cpu_time: request.timeLimitMs,
      run_memory_limit: mib(request.memoryLimitMb),
    };

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(this.url('/execute'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(COMPILE_TIMEOUT_MS + wall + 30_000),
        });
        const json = (await res.json().catch(() => null)) as (PistonExecuteResponse & { message?: string }) | null;
        if (!res.ok || !json?.run) {
          return internalError(`The code runner rejected the job: ${json?.message ?? res.statusText}`);
        }
        return mapPistonResult(json, request);
      } catch (err) {
        // A connection failure is retried once (the runner may be restarting);
        // executions are side-effect free, so retrying is safe.
        if (attempt >= 1) return internalError(`The code runner failed: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}
