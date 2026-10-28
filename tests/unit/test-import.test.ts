import { describe, expect, it } from 'vitest';
import { classifyTestFile, pairTestFiles, parsePastedTests } from '../../src/shared/test-import';

describe('zip test pairing', () => {
  it('pairs .in with .out/.ans and sorts naturally', () => {
    const { tests, unmatched } = pairTestFiles({
      '10.in': 'ten',
      '10.out': 'TEN',
      '2.in': 'two',
      '2.ans': 'TWO',
      '1.in': 'one',
      '1.out': 'ONE',
    });
    expect(tests.map((t) => [t.input, t.output])).toEqual([
      ['one', 'ONE'],
      ['two', 'TWO'],
      ['ten', 'TEN'],
    ]);
    expect(unmatched).toEqual([]);
  });

  it('understands input/ and output/ folders with prefixed names', () => {
    const { tests } = pairTestFiles({
      'pack/input/input00.txt': 'a',
      'pack/output/output00.txt': 'A',
      'pack/input/input01.txt': 'b',
      'pack/output/output01.txt': 'B',
    });
    expect(tests.map((t) => t.output)).toEqual(['A', 'B']);
  });

  it('understands Polygon-style 01 / 01.a pairs', () => {
    const { tests } = pairTestFiles({ '01': 'x', '01.a': 'y' });
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({ input: 'x', output: 'y' });
  });

  it('reports files without a partner and ignores junk', () => {
    const { tests, unmatched } = pairTestFiles({
      '1.in': 'a',
      '1.out': 'A',
      '2.in': 'b',
      '3.out': 'C',
      'README.md': '# tests',
      '__MACOSX/._1.in': 'junk',
      '.DS_Store': 'junk',
      'dir/': '',
    });
    expect(tests).toHaveLength(1);
    expect(unmatched).toEqual(['2.in', '3', 'README.md']);
  });

  it('classifies common names', () => {
    expect(classifyTestFile('tests/5.in')).toEqual({ key: '5@tests', kind: 'input' });
    expect(classifyTestFile('tests/5.ok')).toEqual({ key: '5@tests', kind: 'output' });
    expect(classifyTestFile('input/7.in')?.key).toBe(classifyTestFile('output/7.out')?.key);
    expect(classifyTestFile('notes.pdf')).toBeNull();
  });
});

describe('pasted tests', () => {
  it('splits cases on === and input/output on ---', () => {
    const tests = parsePastedTests('1 2\n---\n3\n===\n5 7\n---\n12\n');
    expect(tests.map((t) => [t.input, t.output])).toEqual([
      ['1 2\n', '3\n'],
      ['5 7\n', '12\n'],
    ]);
  });

  it('keeps input-only cases with an empty output', () => {
    expect(parsePastedTests('4\n1 2 3 4\n===\n2\n9 9')).toEqual([
      { key: 'Pasted 1', input: '4\n1 2 3 4\n', output: '' },
      { key: 'Pasted 2', input: '2\n9 9\n', output: '' },
    ]);
  });

  it('tolerates CRLF, longer separators and blank blocks', () => {
    const tests = parsePastedTests('a\r\n-----\r\nb\r\n=====\r\n\r\n=====\r\nc\r\n---\r\nd');
    expect(tests.map((t) => [t.input, t.output])).toEqual([
      ['a\n', 'b\n'],
      ['c\n', 'd\n'],
    ]);
  });
});
