import type { LanguageId } from './languages';
import type {
  CheckerConfig,
  Difficulty,
  ExecutionSummary,
  JobStatus,
  LanguageLimits,
  ReferenceSolution,
  Role,
  Sample,
  ScoringMode,
  SourceInfo,
  ValidationReport,
} from './types';

// Response shapes shared by the API and the web client.

export interface UserDTO {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  isGuest: boolean;
  guestContestId: number | null;
}

export interface MeResponse {
  user: UserDTO | null;
  serverTime: string;
  features: { registration: boolean; leaderboardUi: boolean };
}

export interface RuntimeDTO {
  id: LanguageId;
  label: string;
  version: string;
}

export interface RuntimesResponse {
  reachable: boolean;
  languages: RuntimeDTO[];
}

export interface RunCaseDTO {
  label: string;
  input: string;
  expected: string | null;
  testId?: number | null;
  sample?: boolean;
  verdict: string | null;
  execution: ExecutionSummary;
}

export interface RunDTO {
  id: number;
  kind: 'custom' | 'samples' | 'generate' | 'validate';
  language: LanguageId;
  status: JobStatus;
  results: RunCaseDTO[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  queuePosition: number | null;
}

export type ValidationState = 'missing' | 'stale' | 'passed' | 'failed';

export interface QuestionListItemDTO {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty | null;
  rating: number | null;
  tags: string[];
  status: 'draft' | 'published';
  practice: boolean;
  testCount: number;
  usedIn: number;
  validationState: ValidationState;
  updatedAt: string;
  authorName: string | null;
  canEdit: boolean;
  source: { adapter: string; url: string | null } | null;
}

export interface QuestionEditorDTO {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty | null;
  rating: number | null;
  tags: string[];
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string[];
  samples: Sample[];
  notes: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  languageLimits: LanguageLimits;
  allowedLanguages: LanguageId[];
  starterCode: Partial<Record<LanguageId, string>>;
  points: number;
  scoringMode: ScoringMode;
  checker: CheckerConfig;
  referenceSolution: ReferenceSolution | null;
  status: 'draft' | 'published';
  practice: boolean;
  source: SourceInfo | null;
  validation: ValidationReport | null;
  validationState: ValidationState;
  updatedAt: string;
  testCount: number;
  usedIn: number;
  canEdit: boolean;
}

export interface TestCaseDTO {
  id: number;
  position: number;
  input: string;
  expectedOutput: string;
  /** True when input/output are previews of a large test; fetch the raw endpoint for all of it. */
  truncated: boolean;
  inputSize: number;
  outputSize: number;
  hidden: boolean;
  points: number | null;
  label: string | null;
  groupName: string | null;
}

/** What participants see of a question (never tests or the reference solution). */
export interface StatementDTO {
  title: string;
  difficulty?: Difficulty | null;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string[];
  samples: Sample[];
  notes: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}

/** One judged case as a participant sees it: never inputs or outputs. */
export interface TestResultDTO {
  index: number;
  label: string;
  sample: boolean;
  hidden: boolean;
  verdict: string;
  timeMs: number | null;
  memoryKb: number | null;
  points: number;
  maxPoints: number;
  message?: string;
}

export interface SubmissionDTO {
  id: number;
  questionId: number;
  contestId: number | null;
  language: LanguageId;
  status: JobStatus;
  queuePosition: number | null;
  /** Overall verdict; when hidden results are withheld, the verdict over visible cases only. */
  verdict: string | null;
  score: number | null;
  maxScore: number;
  passed: number;
  total: number;
  timeMs: number | null;
  memoryKb: number | null;
  compileOutput: string | null;
  /** Null when the contest shows only a summary. */
  results: TestResultDTO[] | null;
  /** Hidden-test results are released after the contest. */
  withheld: boolean;
  receivedAt: string;
  judgedAt: string | null;
  isAuto: boolean;
  code?: string;
}

export interface DraftDTO {
  language: LanguageId;
  code: string;
  updatedAt: string;
}

/** Everything the solve page needs for one question. */
export interface WorkspaceQuestionDTO extends StatementDTO {
  id: number;
  slug: string;
  tags: string[];
  languages: LanguageId[];
  starterCode: Partial<Record<LanguageId, string>>;
  drafts: DraftDTO[];
  points: number;
}

export interface PracticeQuestionDTO {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty | null;
  rating: number | null;
  tags: string[];
  solved: boolean;
  attempted: boolean;
}

export interface ContestSummaryDTO {
  id: number;
  name: string;
  startsAt: string;
  endsAt: string;
  finalEndsAt: string;
  timingMode: 'per_question' | 'fixed_window' | 'personal_window';
  durationMinutes: number | null;
  defaultQuestionMinutes: number | null;
  viewOnce: boolean;
  sequential: boolean;
  visibility: 'public' | 'invite' | 'private';
  phase: 'upcoming' | 'live' | 'ended';
  questionCount: number;
  registered: boolean;
  enteredAt: string | null;
  finishedAt: string | null;
}

export interface RunnerStatusDTO {
  engine: string;
  reachable: boolean;
  error: string | null;
  runtimes: { language: LanguageId; version: string }[];
  setup: {
    state: string;
    wanted: string[];
    installed: string[];
    installing: string | null;
    error: string | null;
  } | null;
  queue: { runs: number; submissions: number };
  pool: { size: number; active: number; waiting: number };
}
