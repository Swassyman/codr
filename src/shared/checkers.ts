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

type JsonValue = null | boolean | string | { num: string } | JsonValue[] | { [key: string]: JsonValue };

/** Strict JSON parser that keeps number text, so 64-bit integers compare exactly. */
function parseJson(text: string): JsonValue {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const value = (): JsonValue => {
    ws();
    const c = text[i];
    if (c === '[') {
      i++;
      const out: JsonValue[] = [];
      ws();
      if (text[i] === ']') return i++, out;
      for (;;) {
        out.push(value());
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === ']') return i++, out;
        else throw new Error('bad array');
      }
    }
    if (c === '{') {
      i++;
      const out: { [key: string]: JsonValue } = {};
      ws();
      if (text[i] === '}') return i++, out;
      for (;;) {
        ws();
        const key = value();
        if (typeof key !== 'string') throw new Error('bad key');
        ws();
        if (text[i++] !== ':') throw new Error('bad object');
        out[key] = value();
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === '}') return i++, out;
        else throw new Error('bad object');
      }
    }
    if (c === '"') {
      const m = /^"(?:[^"\\\u0000-\u001f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/.exec(text.slice(i));
      if (!m) throw new Error('bad string');
      i += m[0].length;
      return JSON.parse(m[0]) as string;
    }
    const lit = /^(true|false|null)/.exec(text.slice(i))?.[1];
    if (lit) return (i += lit.length), lit === 'null' ? null : lit === 'true';
    const num = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))?.[0];
    if (!num) throw new Error('bad value');
    i += num.length;
    return { num };
  };
  const v = value();
  ws();
  if (i < text.length) throw new Error('trailing text');
  return v;
}

const isNum = (v: JsonValue): v is { num: string } => typeof v === 'object' && v !== null && !Array.isArray(v) && 'num' in v && typeof v.num === 'string';

/** First difference as a path like "[2][0]", or null when equal. Integers compare exactly, other numbers within eps. */
function jsonDiff(e: JsonValue, a: JsonValue, eps: number, path: string): string | null {
  if (isNum(e) && isNum(a)) {
    const integers = /^-?\d+$/.test(e.num) && /^-?\d+$/.test(a.num);
    if (integers) return BigInt(e.num) === BigInt(a.num) ? null : path || 'value';
    const ev = Number(e.num);
    const diff = Math.abs(ev - Number(a.num));
    return diff <= eps || diff <= eps * Math.abs(ev) ? null : path || 'value';
  }
  if (Array.isArray(e) && Array.isArray(a)) {
    if (e.length !== a.length) return path || 'value';
    for (let i = 0; i < e.length; i++) {
      const d = jsonDiff(e[i]!, a[i]!, eps, `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (e && a && typeof e === 'object' && typeof a === 'object' && !Array.isArray(e) && !Array.isArray(a) && !isNum(e) && !isNum(a)) {
    const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
    for (const k of keys) {
      if (!(k in e) || !(k in a)) return `${path}.${k}`;
      const d = jsonDiff(e[k]!, a[k]!, eps, `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return e === a ? null : path || 'value';
}

/**
 * Function-style questions: both outputs are one JSON value. Whitespace and
 * number spelling do not matter (2 = 2.0), integers compare exactly and other
 * numbers within the tolerance. The message names where they differ, never what is expected.
 */
const json: CheckerFn = (expected, actual, config) => {
  let e: JsonValue;
  try {
    e = parseJson(expected);
  } catch {
    return exact(expected, actual, config);
  }
  let a: JsonValue;
  try {
    a = parseJson(actual);
  } catch {
    return { ok: false, message: 'The program did not print a single valid JSON value.' };
  }
  const where = jsonDiff(e, a, config.epsilon ?? DEFAULT_FLOAT_EPSILON, '');
  return where ? { ok: false, message: where === 'value' ? 'The returned value differs.' : `The returned value differs at ${where}.` } : { ok: true };
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
  ['json', json],
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
  json: 'JSON value (function-style questions)',
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
