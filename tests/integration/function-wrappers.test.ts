import { describe, expect, it } from 'vitest';
import { PistonRunner } from '../../src/server/runner/piston';
import { runChecker } from '../../src/shared/checkers';
import type { FunctionSpec } from '../../src/shared/function-spec';
import { FUNCTION_LANGUAGES, parsePythonSignature } from '../../src/shared/function-spec';
import { starterFor, wrapSource, type FunctionLanguage } from '../../src/shared/function-wrappers';

// Real programs, in every language the wrappers drive, through the real
// sandbox: starter code from the template, a solution filled into it, the
// hidden driver around it. Skipped when no runner is reachable.
const RUNNER_URL = process.env.RUNNER_URL ?? 'http://localhost:2000';
const live = await fetch(`${RUNNER_URL}/api/v2/runtimes`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);

const spec = (name: string, params: [string, string][], returnType: string, wide = false): FunctionSpec => ({
  className: 'Solution',
  name,
  params: params.map(([n, type]) => ({ name: n, type })),
  returnType,
  wide,
  unsupported: null,
});

type Bodies = Record<FunctionLanguage, string>;
interface Case {
  title: string;
  spec: FunctionSpec;
  tests: { input: string; output: string }[];
  /** The method body, per language, as it goes between the braces of the starter. */
  bodies: Bodies;
}

const cases: Case[] = [
  {
    title: 'ints and lists: twoSum',
    spec: spec('twoSum', [['nums', 'List[int]'], ['target', 'int']], 'List[int]'),
    tests: [
      { input: '[2,7,11,15]\n9\n', output: '[0,1]\n' },
      { input: '[3,3]\n6\n', output: '[0,1]\n' },
      { input: '[1,2]\n99\n', output: '[]\n' },
    ],
    bodies: {
      python: '        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n        return []',
      cpp: '        unordered_map<int,int> m; for (int i = 0; i < (int)nums.size(); i++) { auto it = m.find(target - nums[i]); if (it != m.end()) return {it->second, i}; m[nums[i]] = i; } return {};',
      java: '        Map<Integer,Integer> m = new HashMap<>(); for (int i = 0; i < nums.length; i++) { Integer j = m.get(target - nums[i]); if (j != null) return new int[]{j, i}; m.put(nums[i], i); } return new int[0];',
      javascript: '    const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } return [];',
      typescript: '    const m = new Map<number, number>(); for (let i = 0; i < nums.length; i++) { const j = m.get(target - nums[i]); if (j !== undefined) return [j, i]; m.set(nums[i], i); } return [];',
    },
  },
  {
    title: 'strings with escapes, control characters and non-ASCII: concat',
    spec: spec('doubled', [['s', 'str']], 'str'),
    tests: [
      { input: '"héllo \\"q\\"\\n\\u0001 \\\\ 😀"\n', output: '"héllo \\"q\\"\\n\\u0001 \\\\ 😀héllo \\"q\\"\\n\\u0001 \\\\ 😀"\n' },
      { input: '""\n', output: '""\n' },
    ],
    bodies: {
      python: '        return s + s',
      cpp: '        return s + s;',
      java: '        return s + s;',
      javascript: '    return s + s;',
      typescript: '    return s + s;',
    },
  },
  {
    title: '64-bit integers in nested lists: matrixSum',
    spec: spec('matrixSum', [['grid', 'List[List[int]]']], 'int', true),
    tests: [
      { input: '[[3000000000,4000000000],[-1,2]]\n', output: '7000000001\n' },
      { input: '[[]]\n', output: '0\n' },
    ],
    bodies: {
      python: '        return sum(sum(r) for r in grid)',
      cpp: '        long long t = 0; for (auto& r : grid) for (auto x : r) t += x; return t;',
      java: '        long t = 0; for (long[] r : grid) for (long x : r) t += x; return t;',
      javascript: '    let t = 0; for (const r of grid) for (const x of r) t += x; return t;',
      typescript: '    let t = 0; for (const r of grid) for (const x of r) t += x; return t;',
    },
  },
  {
    title: 'floats and booleans: mean',
    spec: spec('mean', [['nums', 'List[int]']], 'float'),
    tests: [
      { input: '[1,2,3,4]\n', output: '2.5\n' },
      { input: '[2,2]\n', output: '2.0\n' },
    ],
    bodies: {
      python: '        return sum(nums) / len(nums)',
      cpp: '        double t = 0; for (int x : nums) t += x; return t / nums.size();',
      java: '        double t = 0; for (int x : nums) t += x; return t / nums.length;',
      javascript: '    return nums.reduce((a, b) => a + b, 0) / nums.length;',
      typescript: '    return nums.reduce((a, b) => a + b, 0) / nums.length;',
    },
  },
  {
    title: 'booleans: isSorted',
    spec: spec('isSorted', [['nums', 'List[int]']], 'bool'),
    tests: [
      { input: '[1,2,2,3]\n', output: 'true\n' },
      { input: '[3,1]\n', output: 'false\n' },
    ],
    bodies: {
      python: '        return nums == sorted(nums)',
      cpp: '        return is_sorted(nums.begin(), nums.end());',
      java: '        for (int i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) return false; return true;',
      javascript: '    return nums.every((x, i) => i === 0 || nums[i - 1] <= x);',
      typescript: '    return nums.every((x, i) => i === 0 || nums[i - 1] <= x);',
    },
  },
  {
    title: 'linked lists: reverseList',
    spec: spec('reverseList', [['head', 'Optional[ListNode]']], 'Optional[ListNode]'),
    tests: [
      { input: '[1,2,3,4,5]\n', output: '[5,4,3,2,1]\n' },
      { input: '[]\n', output: '[]\n' },
    ],
    bodies: {
      python: '        prev = None\n        while head:\n            head.next, prev, head = prev, head, head.next\n        return prev',
      cpp: '        ListNode* prev = nullptr; while (head) { ListNode* nx = head->next; head->next = prev; prev = head; head = nx; } return prev;',
      java: '        ListNode prev = null; while (head != null) { ListNode nx = head.next; head.next = prev; prev = head; head = nx; } return prev;',
      javascript: '    let prev = null; while (head) { const nx = head.next; head.next = prev; prev = head; head = nx; } return prev;',
      typescript: '    let prev: ListNode | null = null; while (head) { const nx: ListNode | null = head.next; head.next = prev; prev = head; head = nx; } return prev;',
    },
  },
  {
    title: 'binary trees: invertTree',
    spec: spec('invertTree', [['root', 'Optional[TreeNode]']], 'Optional[TreeNode]'),
    tests: [
      { input: '[1,2,3,4,null,null,7]\n', output: '[1,3,2,7,null,null,4]\n' },
      { input: '[]\n', output: '[]\n' },
      { input: '[1]\n', output: '[1]\n' },
    ],
    bodies: {
      python: '        if root:\n            root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)\n        return root',
      cpp: '        if (root) { TreeNode* l = invertTree(root->left); TreeNode* r = invertTree(root->right); root->left = r; root->right = l; } return root;',
      java: '        if (root != null) { TreeNode l = invertTree(root.left); TreeNode r = invertTree(root.right); root.left = r; root.right = l; } return root;',
      javascript: '    if (root) { const l = invertTree(root.left); const r = invertTree(root.right); root.left = r; root.right = l; } return root;',
      typescript: '    if (root) { const l: TreeNode | null = invertTree(root.left); const r: TreeNode | null = invertTree(root.right); root.left = r; root.right = l; } return root;',
    },
  },
];

/** The starter with its empty body replaced by a solution. */
const fill = (starter: string, body: string) => starter.replace(/^[ ]+\n/m, `${body}\n`);

describe('starter code', () => {
  it('reads back as the signature it was made from, in every language', () => {
    for (const c of cases) {
      for (const language of FUNCTION_LANGUAGES) {
        const starter = starterFor(c.spec, language);
        expect(starter, `${c.title} / ${language}`).toContain(c.spec.name);
        expect(starter).toMatch(/\n\s+\n/);
      }
      expect(parsePythonSignature(starterFor(c.spec, 'python')!)).toMatchObject({ name: c.spec.name, returnType: c.spec.returnType });
    }
  });

  it('documents the node classes only where they are used, and gives nothing for other languages', () => {
    expect(starterFor(cases[5]!.spec, 'cpp')).toContain('struct ListNode');
    expect(starterFor(cases[6]!.spec, 'java')).toContain('TreeNode');
    expect(starterFor(cases[0]!.spec, 'cpp')).not.toContain('ListNode');
    expect(starterFor(cases[0]!.spec, 'zig')).toBeNull();
    expect(starterFor(cases[0]!.spec, 'c')).toBeNull();
  });

  it('uses 64-bit integers in the signature when the tests need them, and renames reserved parameter names', () => {
    expect(starterFor(cases[2]!.spec, 'java')).toContain('long[][] grid');
    expect(starterFor(cases[2]!.spec, 'cpp')).toContain('vector<vector<long long>>& grid');
    expect(starterFor(spec('f', [['new', 'int']], 'int'), 'java')).toContain('int new_');
  });
});

describe.runIf(live)('function wrappers on the real runner', () => {
  const runner = new PistonRunner(RUNNER_URL);

  for (const c of cases) {
    for (const language of FUNCTION_LANGUAGES) {
      it(`${c.title} (${language})`, async () => {
        const code = fill(starterFor(c.spec, language)!, c.bodies[language]);
        const source = wrapSource(c.spec, language, code);
        for (const t of c.tests) {
          const r = await runner.execute({ language, source, stdin: t.input, timeLimitMs: 5000, memoryLimitMb: 512 });
          expect({ status: r.status, compile: r.compileOutput, stderr: r.stderr.slice(0, 600) }, `${language} on ${JSON.stringify(t.input)}`).toEqual({ status: 'ok', compile: null, stderr: '' });
          const check = runChecker({ type: 'json', epsilon: 1e-9 }, t.output, r.stdout);
          expect({ ok: check.ok, got: r.stdout }, `expected ${t.output}`).toMatchObject({ ok: true });
        }
      }, 120_000);
    }
  }

  it('keeps the participant’s line numbers in compile and runtime errors', async () => {
    const s = cases[1]!.spec;
    const broken: Record<FunctionLanguage, { code: string; where: RegExp }> = {
      python: { code: '# one\nclass Solution:\n    def doubled(self, s: str) -> str:\n        return s +\n', where: /line 4|:4/ },
      cpp: { code: '// one\nclass Solution {\npublic:\n    string doubled(string s) { return nope(s); }\n};\n', where: /:4:\d+: error/ },
      java: { code: '// one\nclass Solution {\n    public String doubled(String s) {\n        return nope(s);\n    }\n}\n', where: /Main\.java:4: error/ },
      javascript: { code: '// one\n// two\nvar doubled = function(s) {\n    throw new Error("boom");\n};\n', where: /main\.js:4|:4:/ },
      typescript: { code: '// one\n// two\nfunction doubled(s: string): string {\n    return nope(s);\n};\n', where: /\(4,|:4:|\(4\)/ },
    };
    for (const language of FUNCTION_LANGUAGES) {
      const r = await runner.execute({ language, source: wrapSource(s, language, broken[language].code), stdin: '"x"\n', timeLimitMs: 5000, memoryLimitMb: 512 });
      expect(`${r.compileOutput ?? ''}${r.stderr}`, language).toMatch(broken[language].where);
      expect(r.status, language).not.toBe('ok');
    }
  }, 120_000);
});
