import { describe, expect, it } from 'vitest';
import { judgeExecution, registerChecker, runChecker } from '../../src/shared/checkers';
import type { ExecutionSummary } from '../../src/shared/types';

const exact = { type: 'exact' as const };
const trim = { type: 'trim' as const };
const tokens = { type: 'tokens' as const };
const float = (epsilon?: number) => ({ type: 'float' as const, epsilon });

describe('exact checker', () => {
  it('accepts byte-identical output only', () => {
    expect(runChecker(exact, '1 2\n', '1 2\n').ok).toBe(true);
    expect(runChecker(exact, '1 2\n', '1 2').ok).toBe(false);
    expect(runChecker(exact, '1 2\n', '1 2 \n').ok).toBe(false);
  });
});

describe('trim checker (default)', () => {
  it('ignores trailing whitespace, trailing blank lines and CRLF', () => {
    expect(runChecker(trim, '1 2\n3\n', '1 2   \n3').ok).toBe(true);
    expect(runChecker(trim, 'a\nb', 'a\r\nb\r\n\r\n\n').ok).toBe(true);
    expect(runChecker(trim, '', '\n\n').ok).toBe(true);
  });

  it('keeps leading and inner whitespace significant', () => {
    expect(runChecker(trim, '1 2', '1  2').ok).toBe(false);
    expect(runChecker(trim, 'x', ' x').ok).toBe(false);
  });

  it('reports where the output differs without quoting it', () => {
    expect(runChecker(trim, 'a\nb\nc', 'a\nX\nc')).toEqual({ ok: false, message: 'Line 2 differs.' });
    expect(runChecker(trim, 'a\nb', 'a')).toEqual({ ok: false, message: 'Expected 2 lines, got 1.' });
  });
});

describe('token checker', () => {
  it('compares whitespace-separated tokens', () => {
    expect(runChecker(tokens, '1 2\n3', '1\n2   3\n').ok).toBe(true);
    expect(runChecker(tokens, '1 2 3', '1 2 4')).toEqual({ ok: false, message: 'Token 3 differs.' });
    expect(runChecker(tokens, '1 2 3', '1 2').ok).toBe(false);
  });
});

describe('float checker', () => {
  it('accepts numbers within absolute or relative tolerance', () => {
    expect(runChecker(float(), '0.333333333', '0.3333333').ok).toBe(true);
    expect(runChecker(float(1e-6), '1000000000', '1000000500').ok).toBe(true);
    expect(runChecker(float(1e-9), '1.0', '1.001').ok).toBe(false);
  });

  it('uses the configured epsilon', () => {
    expect(runChecker(float(0.01), '3.14', '3.149').ok).toBe(true);
    expect(runChecker(float(0.001), '3.14', '3.149').ok).toBe(false);
  });

  it('compares non-numeric tokens exactly and checks counts', () => {
    expect(runChecker(float(), 'YES 1.5', 'YES 1.5000001').ok).toBe(true);
    expect(runChecker(float(), 'YES 1.5', 'NO 1.5').ok).toBe(false);
    expect(runChecker(float(), '1.5 2.5', '1.5').ok).toBe(false);
  });

  it('handles exponents and signs', () => {
    expect(runChecker(float(), '-1e-3', '-0.001').ok).toBe(true);
    expect(runChecker(float(), '+2.5E2', '250').ok).toBe(true);
  });
});

describe('checker registry', () => {
  it('rejects unknown checker types', () => {
    expect(runChecker({ type: 'nope' as never }, 'a', 'a').ok).toBe(false);
  });

  it('accepts new checkers through the extension point', () => {
    registerChecker('case-insensitive' as never, (e, a) => ({ ok: e.toLowerCase() === a.toLowerCase() }));
    expect(runChecker({ type: 'case-insensitive' as never }, 'Yes', 'YES').ok).toBe(true);
  });
});

describe('judgeExecution', () => {
  const exec = (over: Partial<ExecutionSummary>): ExecutionSummary => ({
    status: 'ok',
    stdout: '',
    stderr: '',
    compileOutput: null,
    exitCode: 0,
    signal: null,
    timeMs: 1,
    memoryKb: 1,
    message: null,
    ...over,
  });

  it('lets execution failures win over output comparison', () => {
    expect(judgeExecution(exec({ status: 'time_limit', stdout: '3' }), '3', trim).verdict).toBe('TLE');
    expect(judgeExecution(exec({ status: 'memory_limit' }), '3', trim).verdict).toBe('MLE');
    expect(judgeExecution(exec({ status: 'runtime_error' }), '3', trim).verdict).toBe('RE');
    expect(judgeExecution(exec({ status: 'compile_error' }), '3', trim).verdict).toBe('CE');
    expect(judgeExecution(exec({ status: 'output_limit' }), '3', trim).verdict).toBe('OLE');
  });

  it('runs the checker on clean exits', () => {
    expect(judgeExecution(exec({ stdout: '3\n' }), '3', trim).verdict).toBe('AC');
    expect(judgeExecution(exec({ stdout: '4\n' }), '3', trim).verdict).toBe('WA');
  });
});

describe('json checker', () => {
  const check = (expected: string, actual: string, epsilon?: number) => runChecker({ type: 'json', epsilon }, expected, actual);

  it('ignores whitespace and the spelling of equal numbers', () => {
    expect(check('[0,1]\n', ' [ 0, 1 ]\n').ok).toBe(true);
    expect(check('2.0\n', '2\n').ok).toBe(true);
    expect(check('{"a":1,"b":[true,null]}', '{"b":[true,null],"a":1}').ok).toBe(true);
    expect(check('"héllo \\n"', '"héllo \\u000a"').ok).toBe(true);
  });

  it('compares integers exactly, even beyond 53 bits', () => {
    expect(check('9223372036854775807', '9223372036854775807').ok).toBe(true);
    expect(check('9223372036854775807', '9223372036854775806').ok).toBe(false);
    expect(check('[1,2]', '[1,3]').ok).toBe(false);
  });

  it('compares non-integers within the tolerance', () => {
    expect(check('0.1', '0.10000001', 1e-5).ok).toBe(true);
    expect(check('0.1', '0.11', 1e-5).ok).toBe(false);
    expect(check('[1.5,2.5]', '[1.5,2.5000001]', 1e-5).ok).toBe(true);
  });

  it('tells apart types and shapes, and says where, never what was expected', () => {
    expect(check('true', '1').ok).toBe(false);
    expect(check('null', '0').ok).toBe(false);
    expect(check('"1"', '1').ok).toBe(false);
    expect(check('[[1],[2]]', '[[1],[3]]')).toEqual({ ok: false, message: 'The returned value differs at [1][0].' });
    expect(check('[1,2]', '[1]').ok).toBe(false);
    const wrong = check('[42]', '[43]');
    expect(wrong.message).not.toMatch(/42/);
  });

  it('rejects output that is not one JSON value', () => {
    expect(check('[1]', 'hello')).toEqual({ ok: false, message: 'The program did not print a single valid JSON value.' });
    expect(check('[1]', '[1] [2]').ok).toBe(false);
    expect(check('[1]', '').ok).toBe(false);
  });
});
