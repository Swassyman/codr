import type { LanguageId } from './languages';
import type { ExecutionSummary, JobStatus, Role } from './types';

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
