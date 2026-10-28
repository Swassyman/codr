import { describe, expect, it } from 'vitest';
import { splitStatement } from '../../src/shared/statement-split';
import { parseRobots, robotsAllows } from '../../src/server/importers/http';
import { htmlToMarkdown } from '../../src/server/importers/html';
import { parseTaskList, parseTaskPage } from '../../src/server/importers/cses';
import { clipDifficulty } from '../../src/server/importers/atcoder';

describe('statement splitter', () => {
  it('splits Codeforces/dataset style text with an Examples section', () => {
    const text = [
      'You are given n numbers. Find their sum.',
      '',
      'Input',
      '',
      'The first line contains n (1 ≤ n ≤ 10^5).',
      '',
      'Output',
      '',
      'Print the sum.',
      '',
      'Examples',
      '',
      'Input',
      '',
      '',
      '3',
      '1 2 3',
      '',
      '',
      'Output',
      '',
      '',
      '6',
      '',
      'Input',
      '',
      '1',
      '5',
      '',
      'Output',
      '',
      '5',
      '',
      'Note',
      '',
      'In the first example 1 + 2 + 3 = 6.',
    ].join('\n');
    const s = splitStatement(text);
    expect(s.statement).toBe('You are given n numbers. Find their sum.');
    expect(s.inputFormat).toBe('The first line contains n (1 ≤ n ≤ 10^5).');
    expect(s.outputFormat).toBe('Print the sum.');
    expect(s.samples).toEqual([
      { input: '3\n1 2 3\n', output: '6\n' },
      { input: '1\n5\n', output: '5\n' },
    ]);
    expect(s.notes).toBe('In the first example 1 + 2 + 3 = 6.');
  });

  it('understands AtCoder style numbered samples and constraints', () => {
    const text = [
      'Problem Statement',
      'Takahashi has N cards.',
      'Constraints',
      '- 1 \\leq N \\leq 100',
      '- All values are integers.',
      'Input',
      'Input is given in the following format:',
      'N',
      'Output',
      'Print the answer.',
      'Sample Input 1',
      '3',
      'Sample Output 1',
      '6',
      'Sample Input 2',
      '1',
      'Sample Output 2',
      '1',
    ].join('\n');
    const s = splitStatement(text);
    expect(s.constraints).toEqual(['1 \\leq N \\leq 100', 'All values are integers.']);
    expect(s.samples).toEqual([
      { input: '3\n', output: '6\n' },
      { input: '1\n', output: '1\n' },
    ]);
    expect(s.statement).toContain('Takahashi has N cards.');
  });

  it('leaves unstructured text in the statement', () => {
    expect(splitStatement('Just a paragraph.\nAnother line.')).toMatchObject({ statement: 'Just a paragraph.\nAnother line.', samples: [] });
  });
});

describe('robots.txt', () => {
  it('applies the rules for every agent and the longest match', () => {
    const rules = parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nAllow: /private/ok\n');
    expect(robotsAllows(rules, '/problemset/task/1')).toBe(true);
    expect(robotsAllows(rules, '/private/x')).toBe(false);
    expect(robotsAllows(rules, '/private/ok/1')).toBe(true);
  });

  it('treats a missing robots.txt as allowing everything', () => {
    expect(robotsAllows(parseRobots(''), '/anything')).toBe(true);
  });
});

describe('HTML to markdown', () => {
  it('keeps math, emphasis, lists and links', () => {
    const md = htmlToMarkdown(
      '<p>Given <span class="math math-inline">n \\le 10^5</span> and <b>bold</b> &amp; <i>italic</i>.</p><ul><li>one</li><li>two</li></ul><p><a href="/x">link</a></p>',
      'https://example.org/task/1',
    );
    expect(md).toBe('Given $n \\le 10^5$ and **bold** & *italic*.\n\n- one\n- two\n\n[link](https://example.org/x)');
  });
});

describe('CSES pages', () => {
  const page = `<html><head><title>CSES - Counting Things</title></head><body>
<ul class="task-constraints"><li><b>Time limit:</b> 1.00 s</li><li><b>Memory limit:</b> 512 MB</li></ul>
<div class="md"><p>Count the things up to <span class="math math-inline">n</span>.</p>
<h1 id="input">Input</h1><p>One integer <span class="math math-inline">n</span>.</p>
<h1 id="output">Output</h1><p>Print the count.</p>
<h1 id="constraints">Constraints</h1><ul><li><span class="math math-inline">1 \\le n \\le 10^6</span></li></ul>
<h1 id="example">Example</h1><p>Input:</p><pre>5
</pre><p>Output:</p><pre>3
</pre><p>Three things are counted.</p></div></body></html>`;

  it('parses statement, limits, constraints and examples', () => {
    const q = parseTaskPage(page, '9999');
    expect(q).toMatchObject({
      title: 'Counting Things',
      timeLimitMs: 1000,
      memoryLimitMb: 512,
      statement: 'Count the things up to $n$.',
      inputFormat: 'One integer $n$.',
      outputFormat: 'Print the count.',
      constraints: ['$1 \\le n \\le 10^6$'],
      samples: [{ input: '5\n', output: '3\n' }],
      notes: 'Three things are counted.',
      url: 'https://cses.fi/problemset/task/9999',
    });
    expect(q.tests).toEqual([]);
    expect(q.attribution).toContain('CSES');
  });

  it('lists tasks with their categories', () => {
    const list = parseTaskList('<h2>General</h2><a href="/problemset/text/1">Intro</a><h2>Sorting</h2><a href="/problemset/task/1621">Distinct Numbers</a><a href="/problemset/task/1084">Apartments</a>');
    expect(list).toEqual([
      { id: '1621', name: 'Distinct Numbers', category: 'Sorting' },
      { id: '1084', name: 'Apartments', category: 'Sorting' },
    ]);
  });
});

describe('AtCoder difficulty', () => {
  it('clips low difficulties the way AtCoder Problems shows them', () => {
    expect(clipDifficulty(1200)).toBe(1200);
    expect(clipDifficulty(-400)).toBe(54);
    expect(clipDifficulty(undefined)).toBeNull();
  });
});
