import type { ExecutionSummary } from '../../src/shared/types';
import type { LanguageId } from '../../src/shared/languages';
import type { ExecuteRequest, Runner, RuntimeInfo } from '../../src/server/runner/types';

/**
 * Deterministic stand-in for Piston. Programs are directives in the source:
 *   fake:sum   prints the sum of all integers in stdin
 *   fake:echo  prints stdin unchanged
 *   fake:wa    prints "wrong"
 *   fake:tle / fake:mle / fake:re / fake:ce  fail in that way
 *   fake:slow=<ms> waits before answering (simulates a runner backlog)
 */
export class FakeRunner implements Runner {
  readonly engine = 'fake';
  executions: ExecuteRequest[] = [];

  constructor(private readonly languages: LanguageId[] = ['cpp', 'python', 'java', 'javascript', 'c']) {}

  async runtimes(): Promise<RuntimeInfo[]> {
    return this.languages.map((language) => ({ language, version: '1.0.0' }));
  }

  async execute(req: ExecuteRequest): Promise<ExecutionSummary> {
    this.executions.push(req);
    const base: ExecutionSummary = {
      status: 'ok',
      stdout: '',
      stderr: '',
      compileOutput: null,
      exitCode: 0,
      signal: null,
      timeMs: 12,
      memoryKb: 2048,
      message: null,
    };
    const slow = /fake:slow=(\d+)/.exec(req.source);
    if (slow) await new Promise((r) => setTimeout(r, Number(slow[1])));
    if (req.source.includes('fake:ce')) return { ...base, status: 'compile_error', compileOutput: 'main.cpp:1:1: error: expected program', exitCode: 1, timeMs: null };
    if (req.source.includes('fake:tle')) return { ...base, status: 'time_limit', exitCode: null, signal: 'SIGKILL', timeMs: req.timeLimitMs + 5, message: 'Time limit exceeded' };
    if (req.source.includes('fake:mle')) return { ...base, status: 'memory_limit', exitCode: 137, memoryKb: req.memoryLimitMb * 1024, message: 'Memory limit exceeded.' };
    if (req.source.includes('fake:re')) return { ...base, status: 'runtime_error', exitCode: 1, stderr: 'boom', message: 'Exited with code 1' };
    if (req.source.includes('fake:wa')) return { ...base, stdout: 'wrong\n' };
    if (req.source.includes('fake:echo')) return { ...base, stdout: req.stdin };
    if (req.source.includes('fake:sum')) {
      const sum = (req.stdin.match(/-?\d+/g) ?? []).reduce((acc, n) => acc + BigInt(n), 0n);
      return { ...base, stdout: `${sum}\n` };
    }
    return { ...base, stdout: '' };
  }
}
