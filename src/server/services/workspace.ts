import type { FastifyRequest } from 'fastify';
import type { AutocompletePolicy } from '../../shared/autocomplete';
import { FUNCTION_LANGUAGES } from '../../shared/function-spec';
import { starterFor } from '../../shared/function-wrappers';
import { LANGUAGE_IDS, type LanguageId } from '../../shared/languages';
import type { StatementDTO, WorkspaceQuestionDTO } from '../../shared/api';
import type { Question } from '../db/schema';
import { badRequest } from '../lib/errors';
import type { Runner } from '../runner/types';

/** Rate-limit key: the signed-in user, falling back to the client address. */
export const userKey = (req: FastifyRequest) => (req.user ? `user:${req.user.id}` : req.ip);

export function toStatement(q: Question): StatementDTO {
  return {
    title: q.title,
    difficulty: q.difficulty,
    statement: q.statement,
    inputFormat: q.inputFormat,
    outputFormat: q.outputFormat,
    constraints: q.constraints,
    samples: q.samples,
    notes: q.notes,
    timeLimitMs: q.timeLimitMs,
    memoryLimitMb: q.memoryLimitMb,
  };
}

/** Allowed languages: the question's list, narrowed by a contest override if any. */
export function allowedLanguages(q: Pick<Question, 'allowedLanguages' | 'functionSpec'>, contestOverride: LanguageId[] = []) {
  let base = q.allowedLanguages.length ? q.allowedLanguages : [...LANGUAGE_IDS];
  // Function-style questions are driven by wrappers that exist for some languages only.
  if (q.functionSpec) base = base.filter((l) => (FUNCTION_LANGUAGES as readonly string[]).includes(l));
  return contestOverride.length ? base.filter((l) => contestOverride.includes(l)) : base;
}

/** What the editor starts with: the staff's own template where set, else the generated method stub of a function-style question. */
export function starterCodeFor(q: Pick<Question, 'starterCode' | 'functionSpec'>, languages: LanguageId[]): Question['starterCode'] {
  if (!q.functionSpec) return q.starterCode;
  const generated: Question['starterCode'] = {};
  for (const l of languages) {
    const stub = starterFor(q.functionSpec, l);
    if (stub) generated[l] = stub;
  }
  return { ...generated, ...q.starterCode };
}

export function toWorkspace(
  q: Question,
  languages: LanguageId[],
  drafts: WorkspaceQuestionDTO['drafts'],
  points: number,
  autocomplete: AutocompletePolicy,
): WorkspaceQuestionDTO {
  return {
    ...toStatement(q),
    id: q.id,
    slug: q.slug,
    tags: q.tags,
    languages,
    starterCode: starterCodeFor(q, languages),
    drafts,
    points,
    autocomplete,
  };
}

/** Rejects languages the question does not allow or the runner cannot run. */
export async function assertLanguage(runner: Runner, allowed: LanguageId[], language: LanguageId) {
  if (!allowed.includes(language)) throw badRequest('language_not_allowed', 'This question does not accept that language.');
  const installed = await runner.runtimes().catch(() => null);
  if (installed && !installed.some((r) => r.language === language)) {
    throw badRequest('language_unavailable', 'That language is not installed on the code runner. Ask an organizer.');
  }
}
