import { describe, expect, it } from 'vitest';
import {
  cleanCompileOutput,
  compareVersions,
  describeExit,
  mapPistonResult,
  matchRuntimes,
  prepareSource,
  type PistonStage,
} from '../../src/server/runner/piston';
import { isPackageInstalled, parsePackageSpec } from '../../src/server/runner/setup';
import { DEFAULT_LANGUAGES, LANGUAGES, LANGUAGE_IDS, effectiveLimits, languageLabel } from '../../src/shared/languages';
import type { ExecuteRequest } from '../../src/server/runner/types';

const req = (over: Partial<ExecuteRequest> = {}): ExecuteRequest => ({
  language: 'cpp',
  source: 'int main(){}',
  stdin: '',
  timeLimitMs: 1000,
  memoryLimitMb: 128,
  ...over,
});

const stage = (over: Partial<PistonStage> = {}): PistonStage => ({
  stdout: '',
  stderr: '',
  output: '',
  code: 0,
  signal: null,
  message: null,
  status: null,
  cpu_time: 10,
  wall_time: 20,
  memory: 2_048_000,
  ...over,
});

const map = (run: PistonStage, compile?: PistonStage, request = req()) =>
  mapPistonResult({ language: 'c++', version: '10.2.0', run, compile }, request);

describe('mapPistonResult', () => {
  it('maps a clean exit to ok with time and memory', () => {
    const r = map(stage({ stdout: '42\n' }), stage());
    expect(r.status).toBe('ok');
    expect(r.stdout).toBe('42\n');
    expect(r.timeMs).toBe(10);
    expect(r.memoryKb).toBe(2048);
  });

  it('maps isolate timeouts to time_limit', () => {
    expect(map(stage({ status: 'TO', code: null, signal: 'SIGKILL' })).status).toBe('time_limit');
  });

  it('treats an ok run that used more CPU than allowed as time_limit', () => {
    expect(map(stage({ cpu_time: 1500 })).status).toBe('time_limit');
  });

  it('maps output caps to output_limit', () => {
    expect(map(stage({ status: 'OL' })).status).toBe('output_limit');
    expect(map(stage({ status: 'EL' })).status).toBe('output_limit');
  });

  it('detects memory exhaustion from peak memory or error text', () => {
    expect(map(stage({ status: 'RE', code: 137, memory: 128 * 1024 * 1000 })).status).toBe('memory_limit');
    expect(map(stage({ status: 'RE', code: 1, stderr: 'MemoryError' })).status).toBe('memory_limit');
    expect(map(stage({ status: 'RE', code: 1, stderr: 'java.lang.OutOfMemoryError: Java heap space' })).status).toBe('memory_limit');
  });

  it('maps other failures to runtime_error with a readable reason', () => {
    const segv = map(stage({ status: 'RE', code: 139 }));
    expect(segv.status).toBe('runtime_error');
    expect(segv.message).toMatch(/Segmentation fault/);
    expect(map(stage({ status: 'RE', code: 3 })).message).toBe('Exited with code 3');
  });

  it('maps runner internal errors', () => {
    expect(map(stage({ status: 'XX' })).status).toBe('internal_error');
  });

  it('reports compile failures with cleaned output', () => {
    const r = map(stage(), stage({ code: 1, output: "main.cpp.cpp:1:14: error: 'x' was not declared\nchmod: cannot access 'a.out': No such file or directory\n" }));
    expect(r.status).toBe('compile_error');
    expect(r.compileOutput).toBe("main.cpp:1:14: error: 'x' was not declared");
  });

  it('treats a Java run-time compilation failure as a compile error', () => {
    const r = map(
      stage({ status: 'RE', code: 1, stderr: 'Main.java:1: error: ; expected\n1 error\nerror: compilation failed\n' }),
      undefined,
      req({ language: 'java' }),
    );
    expect(r.status).toBe('compile_error');
    expect(r.compileOutput).toContain('Main.java:1: error');
  });
});

describe('compiler output cleanup', () => {
  it('rewrites GCC source snippets from the original source', () => {
    const source = '#include <cstdio>\nint main(){\n  return x;\n}';
    const output = "main.cpp.cpp:3:10: error: 'x' was not declared in this scope\n    3 | #include <cstdio>\n      |          ^";
    expect(cleanCompileOutput(output, 'cpp', source)).toBe(
      "main.cpp:3:10: error: 'x' was not declared in this scope\n    3 |   return x;\n      |          ^",
    );
  });

  it("strips the extension Zig's compile script appends", () => {
    const output = 'main.zig.zig:3:11: error: unused local constant\n    const x: u32 = "a";\n          ^';
    expect(cleanCompileOutput(output, 'zig', '')).toBe('main.zig:3:11: error: unused local constant\n    const x: u32 = "a";\n          ^');
  });

  it('leaves tsc output alone (the file is already main.ts)', () => {
    const output = "main.ts(1,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    expect(cleanCompileOutput(output, 'typescript', 'let x: number = "s";')).toBe(output);
  });

  it('prepends the optimisation pragma and resets line numbers for C/C++ only', () => {
    expect(prepareSource('cpp', 'int main(){}')).toBe('#pragma GCC optimize("O2")\n#line 1\nint main(){}');
    expect(prepareSource('python', 'print(1)')).toBe('print(1)');
  });

  it('names common signals', () => {
    expect(describeExit(136, null)).toMatch(/SIGFPE/);
    expect(describeExit(null, 'SIGKILL')).toBe('Killed by SIGKILL');
  });
});

describe('runtime and package selection', () => {
  it('orders versions numerically', () => {
    expect(compareVersions('3.10.0', '3.9.4')).toBeGreaterThan(0);
    expect(compareVersions('1.68.2', '1.68.2')).toBe(0);
  });

  it('picks the newest installed runtime per language', () => {
    const m = matchRuntimes([
      { language: 'python', version: '3.9.4', aliases: [] },
      { language: 'python', version: '3.12.0', aliases: [] },
      { language: 'c++', version: '10.2.0', aliases: [], runtime: 'gcc' },
    ]);
    expect(m.get('python')?.version).toBe('3.12.0');
    expect(m.get('cpp')?.version).toBe('10.2.0');
    expect(m.has('java')).toBe(false);
  });

  it('maps Zig and TypeScript to their own packages, never to Deno', () => {
    const installed = [
      { language: 'typescript', version: '1.32.3', aliases: [], runtime: 'deno' },
      { language: 'javascript', version: '1.32.3', aliases: [], runtime: 'deno' },
      { language: 'javascript', version: '20.11.1', aliases: [], runtime: 'node' },
      { language: 'zig', version: '0.10.1', aliases: [] },
    ];
    let m = matchRuntimes(installed);
    expect(m.has('typescript')).toBe(false);
    expect(m.get('javascript')).toMatchObject({ version: '20.11.1', runtime: 'node' });
    expect(m.get('zig')?.version).toBe('0.10.1');
    m = matchRuntimes([...installed, { language: 'typescript', version: '5.0.3', aliases: ['ts'] }]);
    expect(m.get('typescript')).toEqual({ language: 'typescript', version: '5.0.3', aliases: ['ts'] });
  });

  it('keeps matching every existing catalog language to its package', () => {
    const live = [
      { language: 'c', version: '10.2.0', aliases: [], runtime: 'gcc' },
      { language: 'c++', version: '10.2.0', aliases: [], runtime: 'gcc' },
      { language: 'java', version: '15.0.2', aliases: [] },
      { language: 'javascript', version: '20.11.1', aliases: [], runtime: 'node' },
      { language: 'python', version: '3.12.0', aliases: [] },
      { language: 'go', version: '1.16.2', aliases: [] },
      { language: 'rust', version: '1.68.2', aliases: [] },
    ];
    expect([...matchRuntimes(live).keys()].sort()).toEqual(['c', 'cpp', 'go', 'java', 'javascript', 'python', 'rust']);
  });

  it('parses the package list and recognises installed packages', () => {
    expect(parsePackageSpec('python, gcc=10.2.0,,node')).toEqual([
      { name: 'python', version: null },
      { name: 'gcc', version: '10.2.0' },
      { name: 'node', version: null },
    ]);
    const runtimes = [{ language: 'javascript', version: '20.11.1', aliases: [], runtime: 'node' }];
    expect(isPackageInstalled('node', runtimes)).toBe(true);
    expect(isPackageInstalled('python', runtimes)).toBe(false);
    // Deno provides a "typescript" language, but it is not the typescript package.
    expect(isPackageInstalled('typescript', [{ language: 'typescript', version: '1.32.3', aliases: [], runtime: 'deno' }])).toBe(false);
    expect(isPackageInstalled('typescript', [{ language: 'typescript', version: '5.0.3', aliases: [] }])).toBe(true);
  });
});

describe('language catalog', () => {
  it('names languages with the installed version, or the toolchain alone', () => {
    expect(languageLabel('cpp', '10.2.0')).toBe('C++17 (gcc 10.2.0)');
    expect(languageLabel('typescript', '5.0.3')).toBe('TypeScript (tsc 5.0.3)');
    expect(languageLabel('zig', '0.10.1')).toBe('Zig (zig 0.10.1)');
    expect(languageLabel('python')).toBe('Python 3 (CPython)');
  });

  it('installs Zig and TypeScript by default and gives every language a runner mapping', () => {
    expect(DEFAULT_LANGUAGES).toEqual(expect.arrayContaining(['typescript', 'zig']));
    for (const id of LANGUAGE_IDS) {
      const info = LANGUAGES[id];
      expect(info.id).toBe(id);
      expect(info.piston.package && info.piston.fileName && info.hello && info.template && info.monaco).toBeTruthy();
    }
    expect(LANGUAGES.typescript.piston).toEqual({ language: 'typescript', package: 'typescript', fileName: 'main' });
    expect(LANGUAGES.zig.piston).toEqual({ language: 'zig', package: 'zig', fileName: 'main.zig' });
  });

  it('scales limits for TypeScript like JavaScript (tsc compiles in a separate, uncounted stage)', () => {
    const base = { timeLimitMs: 1000, memoryLimitMb: 256 };
    expect(effectiveLimits(base, 'typescript')).toEqual(effectiveLimits(base, 'javascript'));
    expect(effectiveLimits(base, 'zig')).toEqual({ timeLimitMs: 1000, memoryLimitMb: 256 });
  });
});
