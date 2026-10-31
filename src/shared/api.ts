import type { AutocompletePolicy } from './autocomplete';
import type { FunctionSpec } from './function-spec';
import type { LanguageId } from './languages';
import type {
  AutocompleteRule,
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
  /** Languages the runner can execute right now (empty when unreachable). */
  languages: RuntimeDTO[];
  /** Installed versions for labels; the last ones seen when the runner is unreachable. */
  versions: Partial<Record<LanguageId, string>>;
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
  practiceHidden: boolean;
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
  /** Set for function-style questions: participants implement this method and Codr drives it. */
  functionSpec: FunctionSpec | null;
  points: number;
  scoringMode: ScoringMode;
  checker: CheckerConfig;
  referenceSolution: ReferenceSolution | null;
  status: 'draft' | 'published';
  practice: boolean;
  practiceHidden: boolean;
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
  /** Editor autocompletion as the server decided it (contest rule, or the participant's choice). */
  autocomplete: AutocompletePolicy;
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
  /** Finished contests the question was in (public ones, or ones this user took part in). */
  fromContests: { id: number; name: string }[];
}

export interface PracticeWorkspaceDTO extends WorkspaceQuestionDTO {
  fromContests: { id: number; name: string }[];
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

export type TimingModeDTO = 'per_question' | 'fixed_window' | 'personal_window';

export interface ContestRulesDTO {
  timingMode: TimingModeDTO;
  durationMinutes: number | null;
  defaultQuestionMinutes: number | null;
  viewOnce: boolean;
  sequential: boolean;
  maxSubmissionsPerQuestion: number | null;
  maxRunsPerMinute: number | null;
  revealHidden: 'during' | 'after';
  verdictDetail: 'per_test' | 'summary';
  scoring: 'all_or_nothing' | 'partial';
  penaltyMinutes: number | null;
  recordIntegrity: boolean;
  leaderboardEnabled: boolean;
  autocomplete: AutocompleteRule;
}

export interface ContestLobbyDTO extends ContestRulesDTO {
  id: number;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  finalEndsAt: string;
  visibility: 'public' | 'invite' | 'private';
  registrationOpen: boolean;
  phase: 'upcoming' | 'live' | 'ended';
  questionCount: number;
  serverTime: string;
  isStaff: boolean;
  canRegister: boolean;
  participant: {
    enteredAt: string | null;
    finishedAt: string | null;
    /** When this participant's work must stop (null until entered in personal-window mode). */
    deadline: string | null;
  } | null;
}

export type QuestionNavState = 'available' | 'open' | 'locked' | 'waiting';

export interface ContestQuestionStateDTO {
  questionId: number;
  letter: string;
  title: string;
  points: number;
  state: QuestionNavState;
  reason: string | null;
  reasonCode: string | null;
  deadline: string | null;
  durationMinutes: number | null;
  firstViewedAt: string | null;
  leftAt: string | null;
  bestScore: number | null;
  attempts: number;
  submissionsUsed: number;
}

export interface ContestStateDTO {
  serverTime: string;
  entered: boolean;
  finished: boolean;
  /** Participation is over (time up, finished, or every question locked). */
  over: boolean;
  lock: { code: string; message: string } | null;
  participantDeadline: string | null;
  /** View-once: the question currently open, which leaving would lock. */
  current: number | null;
  questions: ContestQuestionStateDTO[];
}

export interface ContestQuestionDTO extends WorkspaceQuestionDTO {
  letter: string;
  deadline: string | null;
  maxSubmissions: number | null;
  submissionsUsed: number;
}

export interface ContestListItemDTO {
  id: number;
  name: string;
  status: 'draft' | 'published';
  startsAt: string;
  endsAt: string;
  timingMode: TimingModeDTO;
  phase: 'upcoming' | 'live' | 'ended';
  questionCount: number;
  participantCount: number;
}

export interface ContestEditorDTO extends ContestRulesDTO {
  id: number;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  visibility: 'public' | 'invite' | 'private';
  allowGuests: boolean;
  registrationOpen: boolean;
  allowedLanguages: LanguageId[];
  leaderboardFreezeMinutes: number | null;
  joinCode: string;
  status: 'draft' | 'published';
  started: boolean;
  participantCount: number;
  questions: {
    questionId: number;
    title: string;
    slug: string;
    status: 'draft' | 'published';
    points: number | null;
    questionPoints: number;
    durationMinutes: number | null;
    testCount: number;
  }[];
  problems: { path: string; message: string }[];
}

export interface StandingRowDTO {
  rank: number;
  participantId: number;
  userId: number;
  displayName: string;
  username: string;
  isGuest: boolean;
  score: number;
  penalty: number;
  lastBestAt: string | null;
  questions: { questionId: number; score: number; maxScore: number; attempts: number; solved: boolean; bestAt: string | null; penalty: number }[];
}

export interface LeaderboardDTO {
  frozenAt: string | null;
  questions: { questionId: number; letter: string; title: string }[];
  rows: StandingRowDTO[];
}

export interface ContestResultsDTO {
  contest: { id: number; name: string; timingMode: TimingModeDTO; recordIntegrity: boolean; penaltyMinutes: number | null };
  questions: { questionId: number; letter: string; title: string; maxScore: number }[];
  participants: (StandingRowDTO & {
    enteredAt: string | null;
    finishedAt: string | null;
    integrity: { blurs: number; pastes: number; pastedChars: number };
    views: { questionId: number; firstViewedAt: string; leftAt: string | null }[];
  })[];
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
