import type { LanguageId } from '../../shared/languages';
import type { FunctionSpec } from '../../shared/function-spec';
import type { CheckerConfig, Difficulty, Sample } from '../../shared/types';
import type { PoliteHttp } from './http';

export interface SearchResult {
  externalId: string;
  title: string;
  url: string | null;
  rating: number | null;
  difficulty: Difficulty | null;
  tags: string[];
  /** Short extra context, e.g. "Codeforces Round 1575, problem A". */
  detail: string | null;
}

/** A problem in Codr's internal shape, ready to become a draft question. */
export interface NormalizedQuestion {
  externalId: string;
  title: string;
  url: string | null;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string[];
  samples: Sample[];
  notes: string;
  tags: string[];
  rating: number | null;
  difficulty: Difficulty | null;
  timeLimitMs: number | null;
  memoryLimitMb: number | null;
  tests: { input: string; output: string }[];
  referenceSolution: { language: LanguageId; code: string } | null;
  /** Function-style questions: the method to implement; tests are then in the stdin form of shared/function-spec. */
  functionSpec?: FunctionSpec | null;
  checker?: CheckerConfig;
  license: string;
  attribution: string;
}

export interface AdapterInfo {
  id: string;
  name: string;
  /** dataset: statements + tests; metadata: link-out only; scraper: best effort. */
  kind: 'dataset' | 'metadata' | 'scraper';
  description: string;
  /** Shown before importing: what the license allows and how to attribute. */
  licenseNote: string;
  provides: { statement: boolean; tests: boolean; solution: boolean };
}

export interface ImportContext {
  http: PoliteHttp;
  /** Options from the import form, e.g. how many generated tests to keep. */
  options: { extraTests?: number };
}

/**
 * Every source implements the same three steps. Adapters are isolated: one
 * failing (site down, blocked, format changed) never affects the others.
 */
export interface SourceAdapter<Raw = unknown> {
  info: AdapterInfo;
  search(query: string, ctx: ImportContext): Promise<{ results: SearchResult[]; note?: string }>;
  fetchProblem(externalId: string, ctx: ImportContext): Promise<Raw>;
  normalize(raw: Raw, ctx: ImportContext): NormalizedQuestion;
}

export class SourceError extends Error {
  constructor(
    readonly code: 'unavailable' | 'blocked' | 'robots' | 'not_found' | 'bad_data',
    message: string,
  ) {
    super(message);
  }
}
