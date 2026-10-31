import { describe, expect, it } from 'vitest';
import { normalizeRow, parseDescription, repairExponents, type LeetCodeRow } from '../../src/server/importers/leetcode-dataset';
import { SourceError } from '../../src/server/importers/types';

const TWO_SUM = [
  'Given an array of integers nums and an integer target, return indices of the two numbers.',
  'You can return the answer in any order.',
  ' ',
  'Example 1:',
  '',
  'Input: nums = [2,7,11,15], target = 9',
  'Output: [0,1]',
  'Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].',
  '',
  'Example 2:',
  '',
  'Input: nums = [3,2,4], target = 6',
  'Output: [1,2]',
  '',
  ' ',
  'Constraints:',
  '',
  '2 <= nums.length <= 104',
  '-109 <= nums[i] <= 109',
  'Only one valid answer exists.',
  '',
  ' ',
  'Follow-up: Can you come up with an algorithm that is less than O(n2) time complexity?',
].join('\n');

const row = (over: Partial<LeetCodeRow> = {}): LeetCodeRow => ({
  task_id: 'two-sum',
  question_id: 1,
  difficulty: 'Easy',
  tags: ['Array', 'Hash Table'],
  problem_description: TWO_SUM,
  starter_code: 'class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        ',
  completion: 'class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]',
  input_output: [
    { input: 'nums = [3,3], target = 6', output: '[0, 1]' },
    { input: 'nums = [-1,-2,-3,-4], target = -8', output: 'None' },
  ],
  ...over,
});

describe('LeetCode description parsing', () => {
  it('splits statement, examples, constraints and follow-up', () => {
    const p = parseDescription(TWO_SUM);
    expect(p.statement).toBe('Given an array of integers nums and an integer target, return indices of the two numbers.\nYou can return the answer in any order.');
    expect(p.examples).toEqual([
      { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].' },
      { input: 'nums = [3,2,4], target = 6', output: '[1,2]', explanation: '' },
    ]);
    expect(p.constraints).toEqual(['2 <= nums.length <= 10^4', '-10^9 <= nums[i] <= 10^9', 'Only one valid answer exists.']);
    expect(p.followUp).toMatch(/^Can you come up with an algorithm/);
  });

  it('copes with descriptions that have no examples, constraints or follow-up', () => {
    expect(parseDescription('Just text.')).toEqual({ statement: 'Just text.', examples: [], constraints: [], followUp: '' });
  });

  it('restores flattened powers of ten only in comparisons', () => {
    expect(repairExponents('1 <= n <= 105')).toBe('1 <= n <= 10^5');
    expect(repairExponents('-1018 <= x <= 1018')).toBe('-10^18 <= x <= 10^18');
    expect(repairExponents('1 <= k <= 100')).toBe('1 <= k <= 100');
    expect(repairExponents('The answer is at most 104 characters')).toBe('The answer is at most 104 characters');
  });
});

describe('LeetCode row normalisation', () => {
  it('produces stdin-form tests and samples and a function spec', () => {
    const n = normalizeRow(row());
    expect(n).toMatchObject({
      externalId: 'two-sum',
      title: 'Two Sum',
      difficulty: 'easy',
      url: 'https://leetcode.com/problems/two-sum/',
      functionSpec: { name: 'twoSum', returnType: 'List[int]', params: [{ name: 'nums' }, { name: 'target' }] },
      referenceSolution: { language: 'python' },
    });
    expect(n.tests).toEqual([
      { input: '[3,3]\n6\n', output: '[0,1]\n' },
      { input: '[-1,-2,-3,-4]\n-8\n', output: 'null\n' },
    ]);
    expect(n.samples[0]).toMatchObject({ input: '[2,7,11,15]\n9\n', output: '[0,1]\n' });
    expect(n.samples[0]!.explanation).toContain('`nums = [2,7,11,15], target = 9`');
    expect(n.notes).toMatch(/^\*\*Follow-up:\*\*/);
    expect(n.checker).toBeUndefined();
    expect(n.license).toMatch(/Apache-2.0/);
  });

  it('reads str results as bare text, and compares float results within a tolerance', () => {
    const str = normalizeRow(
      row({ starter_code: 'class Solution:\n    def intToRoman(self, num: int) -> str:\n        ', input_output: [{ input: 'num = 1423', output: 'MCDXXIII' }] }),
    );
    expect(str.tests).toEqual([{ input: '1423\n', output: '"MCDXXIII"\n' }]);
    const flt = normalizeRow(row({ starter_code: 'class Solution:\n    def f(self, a: List[int]) -> float:\n        ', input_output: [{ input: 'a = [1]', output: '2.0' }] }));
    expect(flt.checker).toEqual({ type: 'float', epsilon: 1e-5 });
  });

  it('skips unreadable tests, and uses tests as samples when the examples are free-form', () => {
    const n = normalizeRow(
      row({
        problem_description: 'Do the thing.\n\nExample 1:\n\nInput: nums = [1], target = 2\nOutput: 3, nums = [_]\n',
        input_output: [{ input: 'nums = [1], target = 2', output: '[0]' }, { input: 'nums = [1], target = 2', output: 'Error: boom' }, { input: null, output: null } as never],
      }),
    );
    expect(n.tests).toHaveLength(1);
    expect(n.samples).toEqual([{ input: '[1]\n2\n', output: '[0]\n' }]);
  });

  it('refuses design questions, in-place edits and rows without readable tests', () => {
    expect(() => normalizeRow(row({ starter_code: 'class MinStack:\n    def __init__(self):\n        ' }))).toThrow(SourceError);
    expect(() => normalizeRow(row({ starter_code: 'class Solution:\n    def rotate(self, nums: List[int]) -> None:\n        ' }))).toThrow(/in place/);
    expect(() => normalizeRow(row({ input_output: [] }))).toThrow(/tests/);
  });
});
