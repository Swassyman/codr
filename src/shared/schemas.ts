import { z } from 'zod';
import { LANGUAGE_IDS } from './languages';
import { CHECKER_TYPES } from './types';

// Request schemas shared by the API (validation) and the web client (forms).

export const MAX_CODE_LENGTH = 200_000;
export const MAX_CUSTOM_INPUT = 2_000_000;

export const languageSchema = z.enum(LANGUAGE_IDS);

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters.')
  .max(32, 'Use at most 32 characters.')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Use letters, digits, dots, dashes or underscores.');

export const passwordSchema = z.string().min(8, 'Use at least 8 characters.').max(200);

export const displayNameSchema = z.string().trim().min(1, 'Enter a name.').max(80);

export const loginSchema = z.object({
  login: z.string().trim().min(1, 'Enter your username or email.').max(254),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export const registerSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  email: z.union([z.email('Enter a valid email.'), z.literal('')]).optional(),
  password: passwordSchema,
});

export const codeSchema = z.string().max(MAX_CODE_LENGTH, 'Code is too long.');

/** Free-form run used by staff tools (runner check, reference solutions). */
export const scratchRunSchema = z.object({
  language: languageSchema,
  code: codeSchema.min(1, 'Write some code first.'),
  input: z.string().max(MAX_CUSTOM_INPUT).default(''),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

// ---------------------------------------------------------------- Questions

export const MAX_TEST_SIZE = 16 * 1024 * 1024;

export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Enter a slug.')
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single dashes.');

export const sampleSchema = z.object({
  input: z.string().max(100_000),
  output: z.string().max(100_000),
  explanation: z.string().max(20_000).optional(),
});

export const checkerSchema = z.object({
  type: z.enum(CHECKER_TYPES),
  epsilon: z.number().positive('Use a positive tolerance.').max(1).optional(),
});

const multiplier = z.number().min(0.25, 'At least 0.25×.').max(5, 'At most 5×.');

export const questionFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Give the question a title.').max(200),
  slug: slugSchema,
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable(),
  rating: z.number().int().min(0).max(5000).nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20, 'Use at most 20 tags.'),
  statement: z.string().max(100_000),
  inputFormat: z.string().max(20_000),
  outputFormat: z.string().max(20_000),
  constraints: z.array(z.string().max(500)).max(50),
  samples: z.array(sampleSchema).max(20, 'Use at most 20 samples.'),
  notes: z.string().max(50_000),
  timeLimitMs: z.number().int().min(100, 'At least 100 ms.').max(15_000, 'At most 15,000 ms.'),
  memoryLimitMb: z.number().int().min(16, 'At least 16 MB.').max(1024, 'At most 1024 MB.'),
  languageLimits: z.partialRecord(languageSchema, z.object({ time: multiplier.optional(), memory: multiplier.optional() })),
  allowedLanguages: z.array(languageSchema).min(1, 'Allow at least one language.'),
  starterCode: z.partialRecord(languageSchema, z.string().max(50_000)),
  points: z.number().int().min(0).max(10_000),
  scoringMode: z.enum(['tests', 'groups']),
  checker: checkerSchema,
  referenceSolution: z.object({ language: languageSchema, code: codeSchema }).nullable(),
  practice: z.boolean(),
});

export const questionPatchSchema = questionFieldsSchema.partial();
export type QuestionFields = z.infer<typeof questionFieldsSchema>;

export const questionCreateSchema = z.object({
  title: z.string().trim().max(200).optional(),
});

export const testCaseFieldsSchema = z.object({
  input: z.string().max(MAX_TEST_SIZE, 'Inputs are limited to 16 MB.'),
  expectedOutput: z.string().max(MAX_TEST_SIZE, 'Outputs are limited to 16 MB.'),
  hidden: z.boolean(),
  points: z.number().min(0).max(10_000).nullable(),
  label: z.string().trim().max(120).nullable(),
  groupName: z.string().trim().max(60).nullable(),
});

export const testCasePatchSchema = testCaseFieldsSchema.partial();

export const testsBulkSchema = z.object({
  tests: z.array(testCaseFieldsSchema.partial()).min(1).max(1000, 'Add at most 1000 tests at once.'),
});

export const testsOrderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export const applyOutputsSchema = z.object({
  outputs: z.array(z.object({ testId: z.number().int().positive(), expectedOutput: z.string().max(MAX_TEST_SIZE) })).min(1),
});

export const referenceRunSchema = z.object({
  language: languageSchema,
  code: codeSchema.min(1, 'Paste a reference solution first.'),
});

export const publishSchema = z.object({
  /** Publish even though validation is missing, stale or failing. */
  acknowledgeValidation: z.boolean().optional(),
});
