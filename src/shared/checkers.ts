import type { CheckerConfig, CheckerType, ExecutionSummary, TestVerdict, Verdict } from './types';

/**
 * Output checkers. Messages are positional only ("line 3 differs") and never
 * quote expected output, so they are safe to show even for hidden tests.
 */
export interface CheckResult {
  ok: boolean;
  message?: string;
}

export type CheckerFn = (expected: string, actual: string, config: CheckerConfig) => CheckResult;

export const DEFAULT_FLOAT_EPSILON = 1e-6;

const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n');

const exact: CheckerFn = (expected, actual) =>
  expected === actual ? { ok: true } : { ok: false, message: 'Output differs from the expected output byte-for-byte.' };

/** Default: ignore trailing whitespace on each line and trailing blank lines. */
const trim: CheckerFn = (expected, actual) => {
  const lines = (s: string) => {
    const out = normalizeNewlines(s)
      .split('\n')
      .map((l) => l.replace(/[ \t\f\v]+$/, ''));
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out;
  };
  const e = lines(expected);
  const a = lines(actual);
  const n = Math.min(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] !== a[i]) return { ok: false, message: `Line ${i + 1} differs.` };
  }
  if (e.length !== a.length) {
    return { ok: false, message: `Expected ${e.length} line${e.length === 1 ? '' : 's'}, got ${a.length}.` };
  }
  return { ok: true };
};

const tokenize = (s: string) => s.split(/\s+/).filter(Boolean);

const tokens: CheckerFn = (expected, actual) => {
  const e = tokenize(expected);
  const a = tokenize(actual);
  const n = Math.min(e.length, a.length);
  for (let i = 0; i < n; i++) {
    if (e[i] !== a[i]) return { ok: false, message: `Token ${i + 1} differs.` };
  }
  if (e.length !== a.length) return { ok: false, message: `Expected ${e.length} tokens, got ${a.length}.` };
  return { ok: true };
};

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Token-wise; numeric tokens match within absolute or relative epsilon. */
const float: CheckerFn = (expected, actual, config) => {
  const eps = config.epsilon ?? DEFAULT_FLOAT_EPSILON;
  const e = tokenize(expected);
  const a = tokenize(actual);
  const n = Math.min(e.length, a.length);
  for (let i = 0; i < n; i++) {
    const et = e[i]!;
    const at = a[i]!;
    if (NUMBER.test(et) && NUMBER.test(at)) {
      const ev = Number(et);
      const av = Number(at);
      const diff = Math.abs(ev - av);
      if (!(diff <= eps || diff <= eps * Math.abs(ev))) {
        return { ok: false, message: `Number ${i + 1} is outside the allowed error of ${eps}.` };
      }
    } else if (et !== at) {
      return { ok: false, message: `Token ${i + 1} differs.` };
    }
  }
  if (e.length !== a.length) return { ok: false, message: `Expected ${e.length} tokens, got ${a.length}.` };
  return { ok: true };
};

/**
 * Registry so new checkers can be added in one place. A future "custom checker
 * program" type would register here too, but needs the runner, so the judge
 * will call it asynchronously instead of through this synchronous map.
 */
const registry = new Map<string, CheckerFn>([
  ['exact', exact],
  ['trim', trim],
  ['tokens', tokens],
  ['float', float],
]);

export function registerChecker(type: string, fn: CheckerFn) {
  registry.set(type, fn);
}

export function runChecker(config: CheckerConfig, expected: string, actual: string): CheckResult {
  const fn = registry.get(config.type);
  if (!fn) return { ok: false, message: `Unknown checker "${config.type}".` };
  return fn(expected, actual, config);
}

export const CHECKER_LABELS: Record<CheckerType, string> = {
  exact: 'Exact match',
  trim: 'Ignore trailing whitespace',
  tokens: 'Token by token',
  float: 'Numbers within tolerance',
};

/** Verdict implied by how the program ended, before looking at its output. */
export function executionVerdict(status: ExecutionSummary['status']): Verdict | null {
  switch (status) {
    case 'ok':
      return null;
    case 'runtime_error':
      return 'RE';
    case 'time_limit':
      return 'TLE';
    case 'memory_limit':
      return 'MLE';
    case 'output_limit':
      return 'OLE';
    case 'compile_error':
      return 'CE';
    case 'internal_error':
      return 'IE';
  }
}

export function judgeExecution(
  execution: ExecutionSummary,
  expected: string,
  checker: CheckerConfig,
): { verdict: TestVerdict; message?: string } {
  const v = executionVerdict(execution.status);
  if (v) return { verdict: v, message: execution.message ?? undefined };
  const result = runChecker(checker, expected, execution.stdout);
  return result.ok ? { verdict: 'AC' } : { verdict: 'WA', message: result.message };
}
