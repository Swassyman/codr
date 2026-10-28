// Pure helpers for bulk test import (zip archives and pasted text).

export interface ImportedTest {
  key: string;
  input: string;
  output: string;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const OUTPUT_EXTENSIONS = ['out', 'ans', 'answer', 'output', 'a', 'ok', 'sol'];
const INPUT_EXTENSIONS = ['in', 'input', 'inp'];

function isJunk(path: string) {
  return path.endsWith('/') || path.startsWith('__MACOSX/') || /(^|\/)\.[^/]*$/.test(path);
}

/**
 * Normalises a file path into (key, kind). Understands the common layouts:
 *   1.in / 1.out (or .ans, .a, .ok), test1.input / test1.output,
 *   input/input01.txt / output/output01.txt, and Polygon's "01" / "01.a".
 */
export function classifyTestFile(path: string): { key: string; kind: 'input' | 'output' } | null {
  const lower = path.toLowerCase();
  const slash = lower.lastIndexOf('/');
  const dir = slash >= 0 ? lower.slice(0, slash) : '';
  const file = lower.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot + 1) : '';
  const dirName = dir.split('/').pop() ?? '';
  // "input/" and "output/" sibling folders pair up, so both normalise to "#".
  const dirKey = dir.replace(/(^|\/)(in|input|inputs|out|output|outputs|ans|answers)$/, '$1#');

  let kind: 'input' | 'output' | null = null;
  if (INPUT_EXTENSIONS.includes(ext)) kind = 'input';
  else if (OUTPUT_EXTENSIONS.includes(ext)) kind = 'output';
  else if (ext === 'txt' || ext === '') {
    if (/^input/.test(base) || /^(in|input|inputs)$/.test(dirName)) kind = 'input';
    else if (/^output/.test(base) || /^(out|output|outputs|ans|answers)$/.test(dirName)) kind = 'output';
    // Polygon style: extension-less "01" whose answer is "01.a".
    else if (ext === '' && /^\d+$/.test(base)) kind = 'input';
  }
  if (!kind) return null;
  return { key: `${base.replace(/^(input|output)[_-]?/, '')}@${dirKey}`, kind };
}

export function pairTestFiles(files: Record<string, string>): { tests: ImportedTest[]; unmatched: string[] } {
  const inputs = new Map<string, string>();
  const outputs = new Map<string, string>();
  const names = new Map<string, string>();
  const unmatched: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (isJunk(path)) continue;
    const c = classifyTestFile(path);
    if (!c) {
      unmatched.push(path);
      continue;
    }
    (c.kind === 'input' ? inputs : outputs).set(c.key, content);
    if (c.kind === 'input') names.set(c.key, path);
  }
  const tests: ImportedTest[] = [];
  for (const [key, input] of inputs) {
    const output = outputs.get(key);
    if (output === undefined) {
      unmatched.push(names.get(key) ?? key);
      continue;
    }
    tests.push({ key: names.get(key) ?? key, input, output });
    outputs.delete(key);
  }
  for (const key of outputs.keys()) unmatched.push(key.replace(/@.*$/, ''));
  tests.sort((a, b) => collator.compare(a.key, b.key));
  return { tests, unmatched: unmatched.sort(collator.compare) };
}

/**
 * Pasted tests: cases separated by a line of "===", input and expected output
 * separated by a line of "---". A case without "---" is input only (its
 * output can be generated from the reference solution afterwards).
 */
export function parsePastedTests(text: string): ImportedTest[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/^={3,}[ \t]*$/m);
  const tests: ImportedTest[] = [];
  blocks.forEach((block, i) => {
    const trimmed = block.replace(/^\n+/, '').replace(/\n+$/, '');
    if (!trimmed.trim()) return;
    const parts = trimmed.split(/^-{3,}[ \t]*$/m);
    const input = (parts[0] ?? '').replace(/^\n+/, '').replace(/\n*$/, '\n');
    const output = parts.length > 1 ? parts.slice(1).join('---').replace(/^\n+/, '').replace(/\n*$/, '\n') : '';
    tests.push({ key: `Pasted ${i + 1}`, input, output: output === '\n' ? '' : output });
  });
  return tests;
}
