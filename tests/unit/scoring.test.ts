import { describe, expect, it } from 'vitest';
import { overallVerdict, pointsPerTest, submissionPoints, testFraction, type ScoredCase } from '../../src/shared/scoring';

const c = (verdict: ScoredCase['verdict'], weight = 1, group: string | null = null, sample = false): ScoredCase => ({ verdict, weight, group, sample });

describe('testFraction', () => {
  it('weights passed tests and ignores samples', () => {
    expect(testFraction([c('WA', 0, null, true), c('AC', 1), c('AC', 1), c('WA', 2)], 'tests')).toBe(0.5);
  });

  it('gives a group its weight only when every test in it passes', () => {
    const cases = [c('AC', 1, 'small'), c('WA', 1, 'small'), c('AC', 2, 'large'), c('AC', 2, 'large')];
    expect(testFraction(cases, 'groups')).toBeCloseTo(4 / 6);
    expect(testFraction(cases, 'tests')).toBeCloseTo(5 / 6);
  });

  it('treats ungrouped tests as their own group', () => {
    expect(testFraction([c('AC', 1, null), c('WA', 1, null)], 'groups')).toBe(0.5);
  });

  it('handles all-zero weights and sample-only questions', () => {
    expect(testFraction([c('AC', 0), c('AC', 0)], 'tests')).toBe(1);
    expect(testFraction([c('AC', 0, null, true)], 'tests')).toBe(1);
    expect(testFraction([], 'tests')).toBe(0);
  });
});

describe('overallVerdict', () => {
  it('reports the first failure in judging order', () => {
    expect(overallVerdict([c('AC'), c('TLE'), c('WA')])).toBe('TLE');
    expect(overallVerdict([c('AC'), c('AC')])).toBe('AC');
    expect(overallVerdict([c('AC'), c('SK')])).toBe('AC');
  });
});

describe('submissionPoints', () => {
  it('gives all or nothing', () => {
    expect(submissionPoints(100, 0.99, 'WA', 'all_or_nothing')).toBe(0);
    expect(submissionPoints(100, 1, 'AC', 'all_or_nothing')).toBe(100);
  });

  it('gives partial credit rounded to two decimals', () => {
    expect(submissionPoints(100, 1 / 3, 'WA', 'partial')).toBe(33.33);
    expect(submissionPoints(250, 0.5, 'TLE', 'partial')).toBe(125);
  });

  it('splits points across tests by weight', () => {
    expect(pointsPerTest(100, [{ sample: true, weight: 0 }, { sample: false, weight: 1 }, { sample: false, weight: 3 }])).toEqual([0, 25, 75]);
  });
});
