import { SourceError, type NormalizedQuestion, type SearchResult, type SourceAdapter } from './types';

interface CfProblem {
  contestId: number;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
}

const DAY = 24 * 3600_000;
const LIST_URL = 'https://codeforces.com/api/problemset.problems';

async function problems(http: Parameters<SourceAdapter['search']>[1]['http']) {
  // Official API; its terms ask for at most one call every two seconds. The
  // whole problem list is fetched once and cached for a day.
  const res = (await http.get(LIST_URL, 'json', { cacheMs: DAY, minIntervalMs: 2000, api: true })) as { status: string; result?: { problems: CfProblem[] }; comment?: string };
  if (res.status !== 'OK' || !res.result) throw new SourceError('unavailable', `Codeforces API: ${res.comment ?? 'unexpected response'}`);
  return res.result.problems;
}

const url = (p: CfProblem) => `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;

export const codeforcesAdapter: SourceAdapter<CfProblem> = {
  info: {
    id: 'codeforces',
    name: 'Codeforces (metadata)',
    kind: 'metadata',
    description: 'Problem names, ratings and tags from the official Codeforces API, with a link to the original. The API does not provide statements or tests.',
    licenseNote: 'Statements and tests belong to their authors and Codeforces. Codr stores only metadata and a link; paste the statement yourself for private local use and add your own tests.',
    provides: { statement: false, tests: false, solution: false },
  },

  async search(query, ctx) {
    const all = await problems(ctx.http);
    const q = query.trim().toLowerCase();
    const idMatch = /^(\d+)\s*([a-z]\d?)$/i.exec(q);
    const hits = all.filter((p) => {
      if (!q) return true;
      if (idMatch) return p.contestId === Number(idMatch[1]) && p.index.toLowerCase() === idMatch[2];
      return p.name.toLowerCase().includes(q) || p.tags.some((t) => t === q);
    });
    const results: SearchResult[] = hits.slice(0, 100).map((p) => ({
      externalId: `${p.contestId}/${p.index}`,
      title: p.name,
      url: url(p),
      rating: p.rating ?? null,
      difficulty: null,
      tags: p.tags,
      detail: `Contest ${p.contestId}, problem ${p.index}`,
    }));
    return { results, note: hits.length > 100 ? `Showing 100 of ${hits.length}. Search by name, tag or id like 1575A.` : undefined };
  },

  async fetchProblem(externalId, ctx) {
    const [contestId, index] = externalId.split('/');
    const p = (await problems(ctx.http)).find((x) => String(x.contestId) === contestId && x.index === index);
    if (!p) throw new SourceError('not_found', 'Codeforces has no such problem.');
    return p;
  },

  normalize(p): NormalizedQuestion {
    return {
      externalId: `${p.contestId}/${p.index}`,
      title: p.name,
      url: url(p),
      statement: '',
      inputFormat: '',
      outputFormat: '',
      constraints: [],
      samples: [],
      notes: '',
      tags: p.tags,
      rating: p.rating ?? null,
      difficulty: null,
      timeLimitMs: null,
      memoryLimitMb: null,
      tests: [],
      referenceSolution: null,
      license: 'Metadata only; statement rights stay with the author',
      attribution: `Codeforces problem ${p.contestId}${p.index}.`,
    };
  },
};
