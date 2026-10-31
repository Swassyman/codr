import type { FastifyRequest } from 'fastify';
import type { AutocompletePolicy } from '../../shared/autocomplete';
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
export function allowedLanguages(q: Pick<Question, 'allowedLanguages'>, contestOverride: LanguageId[] = []) {
  const base = q.allowedLanguages.length ? q.allowedLanguages : [...LANGUAGE_IDS];
  return contestOverride.length ? base.filter((l) => contestOverride.includes(l)) : base;
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
    starterCode: q.starterCode,
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
