import { SourceError, type NormalizedQuestion, type SearchResult, type SourceAdapter } from './types';

interface AtProblem {
  id: string;
  contest_id: string;
  problem_index: string;
  name: string;
  title: string;
}

interface AtModel {
  difficulty?: number;
}

const DAY = 24 * 3600_000;
const BASE = 'https://kenkoooo.com/atcoder/resources';

/** AtCoder Problems reports raw difficulty; below 400 it is clipped like on the site. */
export function clipDifficulty(d: number | undefined) {
  if (d == null) return null;
  return Math.round(d >= 400 ? d : 400 / Math.exp((400 - d) / 400));
}

async function load(http: Parameters<SourceAdapter['search']>[1]['http']) {
  // kenkoooo's AtCoder Problems asks clients to space out requests; both files are cached for a day.
  const problems = (await http.get(`${BASE}/problems.json`, 'json', { cacheMs: DAY, minIntervalMs: 1500, api: true })) as AtProblem[];
  const models = (await http.get(`${BASE}/problem-models.json`, 'json', { cacheMs: DAY, minIntervalMs: 1500, api: true })) as Record<string, AtModel>;
  return { problems, models };
}

const url = (p: AtProblem) => `https://atcoder.jp/contests/${p.contest_id}/tasks/${p.id}`;

export const atcoderAdapter: SourceAdapter<AtProblem & { difficulty: number | null }> = {
  info: {
    id: 'atcoder',
    name: 'AtCoder (metadata)',
    kind: 'metadata',
    description: 'Problem names and estimated difficulty from the AtCoder Problems API (kenkoooo), with a link to the original task.',
    licenseNote: 'Statements and tests belong to AtCoder and the problem authors. Codr stores only metadata and a link; paste the statement for private local use.',
    provides: { statement: false, tests: false, solution: false },
  },

  async search(query, ctx) {
    const { problems, models } = await load(ctx.http);
    const q = query.trim().toLowerCase();
    const hits = problems.filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase() === q || p.contest_id.toLowerCase() === q);
    const results: SearchResult[] = hits.slice(0, 100).map((p) => ({
      externalId: p.id,
      title: p.name,
      url: url(p),
      rating: clipDifficulty(models[p.id]?.difficulty),
      difficulty: null,
      tags: [],
      detail: `${p.contest_id.toUpperCase()} ${p.problem_index}`,
    }));
    return { results, note: hits.length > 100 ? `Showing 100 of ${hits.length}. Search by name, task id or contest id like abc300.` : undefined };
  },

  async fetchProblem(externalId, ctx) {
    const { problems, models } = await load(ctx.http);
    const p = problems.find((x) => x.id === externalId);
    if (!p) throw new SourceError('not_found', 'AtCoder Problems has no such task.');
    return { ...p, difficulty: clipDifficulty(models[p.id]?.difficulty) };
  },

  normalize(p): NormalizedQuestion {
    return {
      externalId: p.id,
      title: p.name,
      url: url(p),
      statement: '',
      inputFormat: '',
      outputFormat: '',
      constraints: [],
      samples: [],
      notes: '',
      tags: [],
      rating: p.difficulty,
      difficulty: null,
      timeLimitMs: null,
      memoryLimitMb: null,
      tests: [],
      referenceSolution: null,
      license: 'Metadata only; statement rights stay with AtCoder',
      attribution: `AtCoder ${p.contest_id.toUpperCase()}, task ${p.problem_index}.`,
    };
  },
};
