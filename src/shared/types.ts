import type { LanguageId, LanguageLimitOverride } from './languages';

export type Role = 'admin' | 'creator' | 'participant';

/** Overall verdicts. OLE = output limit exceeded, IE = internal (runner) error. */
export const VERDICTS = ['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'OLE', 'IE'] as const;
export type Verdict = (typeof VERDICTS)[number];
/** Per-test verdicts add SK: not run because judging stopped early. */
export type TestVerdict = Verdict | 'SK';

export const VERDICT_LABELS: Record<TestVerdict, string> = {
  AC: 'Accepted',
  WA: 'Wrong answer',
  TLE: 'Time limit exceeded',
  MLE: 'Memory limit exceeded',
  RE: 'Runtime error',
  CE: 'Compilation error',
  OLE: 'Output limit exceeded',
  IE: 'Internal error',
  SK: 'Skipped',
};

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export const CHECKER_TYPES = ['exact', 'trim', 'tokens', 'float'] as const;
export type CheckerType = (typeof CHECKER_TYPES)[number];
export interface CheckerConfig {
  type: CheckerType;
  /** Absolute/relative tolerance for the float checker. */
  epsilon?: number;
}

export interface Sample {
  input: string;
  output: string;
  explanation?: string;
}

/**
 * Contest rule for editor autocompletion: forced off, forced on, or left to
 * each participant (practice always behaves like user_choice).
 */
export const AUTOCOMPLETE_RULES = ['off', 'on', 'user_choice'] as const;
export type AutocompleteRule = (typeof AUTOCOMPLETE_RULES)[number];

export type Difficulty = 'easy' | 'medium' | 'hard';
export type ScoringMode = 'tests' | 'groups';

export interface SourceInfo {
  adapter: string;
  externalId: string;
  url?: string;
  license?: string;
  attribution?: string;
  importedAt: string;
}

export interface ReferenceSolution {
  language: LanguageId;
  code: string;
}

export type LanguageLimits = Partial<Record<LanguageId, LanguageLimitOverride>>;

/** Result of one execution of a program against one input. */
export interface ExecutionSummary {
  status: 'ok' | 'runtime_error' | 'time_limit' | 'memory_limit' | 'output_limit' | 'compile_error' | 'internal_error';
  stdout: string;
  stderr: string;
  compileOutput: string | null;
  exitCode: number | null;
  signal: string | null;
  timeMs: number | null;
  memoryKb: number | null;
  message: string | null;
}

/** One judged test inside a submission. Never contains hidden test data. */
export interface TestResult {
  index: number;
  testId: number | null;
  sample: boolean;
  hidden: boolean;
  group: string | null;
  verdict: TestVerdict;
  timeMs: number | null;
  memoryKb: number | null;
  points: number;
  maxPoints: number;
  message?: string;
}

export interface ValidationCase {
  testId: number | null;
  sample: boolean;
  label: string;
  verdict: TestVerdict;
  timeMs: number | null;
  memoryKb: number | null;
  message?: string;
}

export interface ValidationReport {
  ranAt: string;
  language: LanguageId;
  ok: boolean;
  timeLimitMs: number;
  maxTimeMs: number | null;
  cases: ValidationCase[];
}
