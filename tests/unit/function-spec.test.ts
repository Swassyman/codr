import { describe, expect, it } from 'vitest';
import { literalToJson, parseNamedArgs, parsePythonSignature, toStdinTest, unsupportedType } from '../../src/shared/function-spec';

describe('literal parsing', () => {
  it('turns Python and JSON literals into compact JSON', () => {
    expect(literalToJson('[1, 2, [3, 4]]')).toBe('[1,2,[3,4]]');
    expect(literalToJson('(1, 2)')).toBe('[1,2]');
    expect(literalToJson('None')).toBe('null');
    expect(literalToJson('True')).toBe('true');
    expect(literalToJson('false')).toBe('false');
    expect(literalToJson("'it\\'s'")).toBe('"it\'s"');
    expect(literalToJson('"a\\nb"')).toBe('"a\\nb"');
    expect(literalToJson('{"a": [1], \'b\': None}')).toBe('{"a":[1],"b":null}');
    expect(literalToJson('[]')).toBe('[]');
  });

  it('keeps numbers exact, including 64-bit integers, and normalises float spellings', () => {
    expect(literalToJson('9223372036854775807')).toBe('9223372036854775807');
    expect(literalToJson('[-5, 225.0, 1e-05, .5, 3.]')).toBe('[-5,225.0,1e-05,0.5,3.0]');
  });

  it('rejects what is not a plain value', () => {
    expect(() => literalToJson('foo')).toThrow();
    expect(() => literalToJson('[1, 2')).toThrow();
    expect(() => literalToJson('1 2')).toThrow();
    expect(() => literalToJson('"open')).toThrow();
  });
});

describe('named arguments', () => {
  it('reads "name = value" lists, with commas inside values', () => {
    expect(parseNamedArgs('nums = [3,3], target = 6')).toEqual({ nums: '[3,3]', target: '6' });
    expect(parseNamedArgs('s = "a, b = c", k = 2')).toEqual({ s: '"a, b = c"', k: '2' });
    expect(parseNamedArgs('grid = [[1,0],[0,1]]')).toEqual({ grid: '[[1,0],[0,1]]' });
    expect(parseNamedArgs('words = []')).toEqual({ words: '[]' });
  });

  it('rejects text that is not name = value', () => {
    expect(() => parseNamedArgs('[1,2,3]')).toThrow();
  });
});

describe('stdin tests', () => {
  const spec = { params: [{ name: 'nums', type: 'List[int]' }, { name: 'target', type: 'int' }] };

  it('puts one JSON value per parameter on its own line, in signature order', () => {
    expect(toStdinTest(spec, 'target = 9, nums = [2, 7, 11, 15]', '[0, 1]')).toEqual({ input: '[2,7,11,15]\n9\n', output: '[0,1]\n' });
    expect(toStdinTest(spec, 'nums = [1], target = 2', 'None').output).toBe('null\n');
  });

  it('fails on a missing argument', () => {
    expect(() => toStdinTest(spec, 'nums = [1]', '0')).toThrow(/target/);
  });
});

describe('Python signatures', () => {
  it('reads the method of class Solution', () => {
    const spec = parsePythonSignature('class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        ');
    expect(spec).toEqual({
      className: 'Solution',
      name: 'twoSum',
      params: [{ name: 'nums', type: 'List[int]' }, { name: 'target', type: 'int' }],
      returnType: 'List[int]',
      unsupported: null,
    });
  });

  it('skips the commented helper class and handles Optional and nested lists', () => {
    const spec = parsePythonSignature(
      '# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\nclass Solution:\n    def mergeTwoLists(self, list1: Optional[ListNode], list2: Optional[ListNode]) -> Optional[ListNode]:\n        ',
    );
    expect(spec?.name).toBe('mergeTwoLists');
    expect(spec?.params.map((p) => p.type)).toEqual(['Optional[ListNode]', 'Optional[ListNode]']);
    expect(spec?.unsupported).toBeNull();
    expect(parsePythonSignature('class Solution:\n    def f(self, g: List[List[str]], k: int = 3) -> float:\n        ')?.params).toHaveLength(2);
  });

  it('flags what the wrappers cannot drive', () => {
    expect(parsePythonSignature('class Solution:\n    def rotate(self, nums: List[int], k: int) -> None:\n        ')?.unsupported).toMatch(/in place/);
    expect(parsePythonSignature('class Solution:\n    def copy(self, head: Optional[Node]) -> Optional[Node]:\n        ')?.unsupported).toMatch(/Node/);
  });

  it('finds no method for design questions', () => {
    expect(parsePythonSignature('class MinStack:\n    def __init__(self):\n        ')).toBeNull();
    expect(parsePythonSignature('')).toBeNull();
  });

  it('classifies types', () => {
    expect(unsupportedType('List[List[int]]')).toBeNull();
    expect(unsupportedType('Optional[TreeNode]')).toBeNull();
    expect(unsupportedType('Dict[str, int]')).toMatch(/not supported/);
  });
});

describe('raw string results', () => {
  const spec = { params: [{ name: 's', type: 'str' }] };

  it('quotes a bare string result, and keeps literals as they are otherwise', () => {
    expect(toStdinTest(spec, 's = "abc"', 'MCDXXIII', { rawText: true }).output).toBe('"MCDXXIII"\n');
    expect(toStdinTest(spec, 's = "abc"', '43/120', { rawText: true }).output).toBe('"43/120"\n');
    expect(toStdinTest(spec, 's = "abc"', '"quoted"').output).toBe('"quoted"\n');
    expect(() => toStdinTest(spec, 's = "abc"', 'MCDXXIII')).toThrow();
  });
});
