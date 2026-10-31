import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import type { LanguageId } from '../../shared/languages';
import { AUTOCOMPLETE_RULES } from '../../shared/types';
import type {
  CheckerConfig,
  LanguageLimits,
  ReferenceSolution,
  Sample,
  SourceInfo,
  TestResult,
  ValidationReport,
  ExecutionSummary,
} from '../../shared/types';

const ts = () => timestamp({ withTimezone: true });
const textArray = () => text().array().notNull().default(sql`'{}'::text[]`);

export const roleEnum = pgEnum('role', ['admin', 'creator', 'participant']);
export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard']);
export const publishStatusEnum = pgEnum('publish_status', ['draft', 'published']);
export const scoringModeEnum = pgEnum('scoring_mode', ['tests', 'groups']);
export const visibilityEnum = pgEnum('contest_visibility', ['public', 'invite', 'private']);
export const timingModeEnum = pgEnum('timing_mode', ['per_question', 'fixed_window', 'personal_window']);
export const revealEnum = pgEnum('reveal_hidden', ['during', 'after']);
export const verdictDetailEnum = pgEnum('verdict_detail', ['per_test', 'summary']);
export const contestScoringEnum = pgEnum('contest_scoring', ['all_or_nothing', 'partial']);
export const autocompleteEnum = pgEnum('autocomplete_rule', AUTOCOMPLETE_RULES);
export const jobStatusEnum = pgEnum('job_status', ['queued', 'running', 'done', 'failed']);
export const runKindEnum = pgEnum('run_kind', ['custom', 'samples', 'generate', 'validate']);

export const users = pgTable('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  username: varchar({ length: 64 }).notNull().unique(),
  email: varchar({ length: 254 }).unique(),
  displayName: varchar({ length: 80 }).notNull(),
  passwordHash: text(),
  role: roleEnum().notNull().default('participant'),
  isGuest: boolean().notNull().default(false),
  /** Guests are created by joining one contest with its code and only exist for it. */
  guestContestId: integer().references((): any => contests.id, { onDelete: 'cascade' }),
  disabled: boolean().notNull().default(false),
  createdAt: ts().notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    tokenHash: varchar({ length: 64 }).primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    lastSeenAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
);

export const questions = pgTable(
  'questions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    slug: varchar({ length: 96 }).notNull().unique(),
    title: varchar({ length: 200 }).notNull(),
    difficulty: difficultyEnum(),
    rating: integer(),
    tags: textArray(),
    statement: text().notNull().default(''),
    inputFormat: text().notNull().default(''),
    outputFormat: text().notNull().default(''),
    constraints: jsonb().$type<string[]>().notNull().default([]),
    samples: jsonb().$type<Sample[]>().notNull().default([]),
    notes: text().notNull().default(''),
    timeLimitMs: integer().notNull().default(2000),
    memoryLimitMb: integer().notNull().default(256),
    languageLimits: jsonb().$type<LanguageLimits>().notNull().default({}),
    allowedLanguages: text().array().$type<LanguageId[]>().notNull().default(sql`'{}'::text[]`),
    starterCode: jsonb().$type<Partial<Record<LanguageId, string>>>().notNull().default({}),
    points: integer().notNull().default(100),
    scoringMode: scoringModeEnum().notNull().default('tests'),
    checker: jsonb().$type<CheckerConfig>().notNull().default({ type: 'trim' }),
    /** Never sent to participants. */
    referenceSolution: jsonb().$type<ReferenceSolution | null>(),
    status: publishStatusEnum().notNull().default('draft'),
    /** Listed in the practice bank (still hidden while it is in an unfinished contest). */
    practice: boolean().notNull().default(false),
    /** Never in the practice bank, not even after its contests end (questions from finished contests are listed otherwise). */
    practiceHidden: boolean().notNull().default(false),
    source: jsonb().$type<SourceInfo | null>(),
    validation: jsonb().$type<ValidationReport | null>(),
    /** Bumped whenever tests, limits, checker or the reference solution change. */
    judgeDataUpdatedAt: ts().notNull().defaultNow(),
    authorId: integer().references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.status), index().on(t.authorId)],
);

export const testCases = pgTable(
  'test_cases',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    questionId: integer()
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    input: text().notNull().default(''),
    expectedOutput: text().notNull().default(''),
    hidden: boolean().notNull().default(true),
    /** Relative weight; null means 1. */
    points: real(),
    label: varchar({ length: 120 }),
    groupName: varchar({ length: 60 }),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.questionId, t.position)],
);

export const contests = pgTable(
  'contests',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: varchar({ length: 160 }).notNull(),
    description: text().notNull().default(''),
    startsAt: ts().notNull(),
    /** fixed_window and per_question: contest closes. personal_window: entry cutoff. */
    endsAt: ts().notNull(),
    visibility: visibilityEnum().notNull().default('public'),
    joinCode: varchar({ length: 32 }).notNull().unique(),
    allowGuests: boolean().notNull().default(false),
    registrationOpen: boolean().notNull().default(true),
    /** Contest-wide override; empty means each question's own list. */
    allowedLanguages: text().array().$type<LanguageId[]>().notNull().default(sql`'{}'::text[]`),
    timingMode: timingModeEnum().notNull().default('fixed_window'),
    durationMinutes: integer(),
    defaultQuestionMinutes: integer(),
    viewOnce: boolean().notNull().default(false),
    sequential: boolean().notNull().default(false),
    maxSubmissionsPerQuestion: integer(),
    maxRunsPerMinute: integer(),
    revealHidden: revealEnum().notNull().default('during'),
    verdictDetail: verdictDetailEnum().notNull().default('per_test'),
    scoring: contestScoringEnum().notNull().default('partial'),
    /** Penalty minutes per rejected attempt before the best result; null = no penalty. */
    penaltyMinutes: integer(),
    leaderboardEnabled: boolean().notNull().default(false),
    /** Freeze the public leaderboard this many minutes before the end. */
    leaderboardFreezeMinutes: integer(),
    recordIntegrity: boolean().notNull().default(false),
    /** Editor autocompletion; the workspace exposes it and the editor applies it. */
    autocomplete: autocompleteEnum().notNull().default('user_choice'),
    status: publishStatusEnum().notNull().default('draft'),
    createdBy: integer().references(() => users.id, { onDelete: 'set null' }),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index().on(t.status, t.startsAt)],
);

export const contestQuestions = pgTable(
  'contest_questions',
  {
    contestId: integer()
      .notNull()
      .references(() => contests.id, { onDelete: 'cascade' }),
    questionId: integer()
      .notNull()
      .references(() => questions.id, { onDelete: 'restrict' }),
    position: integer().notNull(),
    /** Overrides the question's own points. */
    points: integer(),
    /** per_question mode: overrides contest.defaultQuestionMinutes. */
    durationMinutes: integer(),
  },
  (t) => [primaryKey({ columns: [t.contestId, t.questionId] })],
);

export const participants = pgTable(
  'participants',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    contestId: integer()
      .notNull()
      .references(() => contests.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: ts().notNull().defaultNow(),
    /** First entry into the contest; starts the clock in personal_window mode. */
    enteredAt: ts(),
    /** Participant ended the contest early. */
    finishedAt: ts(),
  },
  (t) => [unique().on(t.contestId, t.userId)],
);

/** Server-side record of what a participant opened and left, per question. */
export const participantQuestions = pgTable(
  'participant_questions',
  {
    participantId: integer()
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    questionId: integer()
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    firstViewedAt: ts().notNull(),
    /** View-once: when the participant moved away. The question is locked from then on. */
    leftAt: ts(),
    /** Per-question timer: set once the expiry (auto-submit) has been handled. */
    expiryProcessedAt: ts(),
  },
  (t) => [primaryKey({ columns: [t.participantId, t.questionId] })],
);

export const drafts = pgTable(
  'drafts',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contestId: integer().references(() => contests.id, { onDelete: 'cascade' }),
    questionId: integer()
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    language: varchar({ length: 16 }).$type<LanguageId>().notNull(),
    code: text().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [unique().on(t.userId, t.contestId, t.questionId, t.language).nullsNotDistinct()],
);

export const submissions = pgTable(
  'submissions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contestId: integer().references(() => contests.id, { onDelete: 'cascade' }),
    questionId: integer()
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    language: varchar({ length: 16 }).$type<LanguageId>().notNull(),
    code: text().notNull(),
    status: jobStatusEnum().notNull().default('queued'),
    verdict: varchar({ length: 4 }),
    /** Fraction of tests (or groups) passed, 0..1; scoring rules turn it into points. */
    fraction: real(),
    score: real(),
    maxScore: real().notNull().default(0),
    passed: integer().notNull().default(0),
    total: integer().notNull().default(0),
    timeMs: integer(),
    memoryKb: integer(),
    compileOutput: text(),
    results: jsonb().$type<TestResult[]>().notNull().default([]),
    /** Server time the request arrived; the only timestamp used for deadline decisions. */
    receivedAt: ts().notNull(),
    startedAt: ts(),
    judgedAt: ts(),
    isAuto: boolean().notNull().default(false),
    idempotencyKey: varchar({ length: 64 }),
  },
  (t) => [
    index().on(t.contestId, t.userId, t.questionId),
    index().on(t.status, t.id),
    unique().on(t.userId, t.idempotencyKey),
  ],
);

export interface RunCaseResult {
  label: string;
  input: string;
  expected: string | null;
  testId?: number | null;
  sample?: boolean;
  verdict: string | null;
  execution: ExecutionSummary;
}

export const runs = pgTable(
  'runs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contestId: integer().references(() => contests.id, { onDelete: 'cascade' }),
    questionId: integer().references(() => questions.id, { onDelete: 'cascade' }),
    kind: runKindEnum().notNull(),
    language: varchar({ length: 16 }).$type<LanguageId>().notNull(),
    code: text().notNull(),
    input: text(),
    status: jobStatusEnum().notNull().default('queued'),
    results: jsonb().$type<RunCaseResult[]>().notNull().default([]),
    error: text(),
    createdAt: ts().notNull(),
    startedAt: ts(),
    finishedAt: ts(),
  },
  (t) => [index().on(t.status, t.id), index().on(t.userId, t.createdAt)],
);

export const integrityEvents = pgTable(
  'integrity_events',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    contestId: integer()
      .notNull()
      .references(() => contests.id, { onDelete: 'cascade' }),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: integer().references(() => questions.id, { onDelete: 'set null' }),
    type: varchar({ length: 24 }).notNull(),
    detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    clientTime: ts(),
    createdAt: ts().notNull(),
  },
  (t) => [index().on(t.contestId, t.userId)],
);

export const importCache = pgTable('import_cache', {
  key: varchar({ length: 300 }).primaryKey(),
  value: jsonb().notNull(),
  fetchedAt: ts().notNull(),
  expiresAt: ts().notNull(),
});

export type User = typeof users.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type TestCase = typeof testCases.$inferSelect;
export type Contest = typeof contests.$inferSelect;
export type ContestQuestion = typeof contestQuestions.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type ParticipantQuestion = typeof participantQuestions.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Run = typeof runs.$inferSelect;
