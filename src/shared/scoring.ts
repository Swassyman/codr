import type { ScoringMode, TestVerdict, Verdict } from './types';

export interface ScoredCase {
  sample: boolean;
  /** Relative weight of the test (null weight means 1). Samples carry no weight. */
  weight: number;
  group: string | null;
  verdict: TestVerdict;
}

/**
 * Share of the question earned, 0..1, from the non-sample tests.
 * - tests: each passed test contributes its weight.
 * - groups: a group contributes its total weight only if every test in it passed.
 *   Tests without a group form their own single-test group.
 */
export function testFraction(cases: ScoredCase[], mode: ScoringMode): number {
  const tests = cases.filter((c) => !c.sample);
  if (tests.length === 0) return cases.length > 0 && cases.every((c) => c.verdict === 'AC') ? 1 : 0;
  const groups = new Map<string, { weight: number; passed: boolean }>();
  tests.forEach((c, i) => {
    const key = mode === 'groups' && c.group ? `g:${c.group}` : `t:${i}`;
    const g = groups.get(key) ?? { weight: 0, passed: true };
    g.weight += c.weight;
    g.passed &&= c.verdict === 'AC';
    groups.set(key, g);
  });
  let total = 0;
  let earned = 0;
  for (const g of groups.values()) {
    total += g.weight;
    if (g.passed) earned += g.weight;
  }
  if (total === 0) return tests.every((c) => c.verdict === 'AC') ? 1 : 0;
  return earned / total;
}

/** The overall verdict: the first failing case in judging order, otherwise AC. */
export function overallVerdict(cases: { verdict: TestVerdict | string }[]): Verdict {
  const failed = cases.find((c) => c.verdict !== 'AC' && c.verdict !== 'SK');
  return (failed?.verdict as Verdict | undefined) ?? 'AC';
}

export type ContestScoring = 'all_or_nothing' | 'partial';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Points for one submission under the contest's scoring rule. */
export function submissionPoints(maxPoints: number, fraction: number, verdict: Verdict, scoring: ContestScoring): number {
  if (scoring === 'all_or_nothing') return verdict === 'AC' ? maxPoints : 0;
  // A failing sample still allows partial credit from the real tests.
  return round2(maxPoints * fraction);
}

/** Splits a question's points across its tests for display (respecting weights). */
export function pointsPerTest(maxPoints: number, cases: Pick<ScoredCase, 'sample' | 'weight'>[]) {
  const total = cases.reduce((sum, c) => sum + (c.sample ? 0 : c.weight), 0);
  return cases.map((c) => (c.sample || total === 0 ? 0 : round2((maxPoints * c.weight) / total)));
}
