import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { splitStatement } from '../../shared/statement-split';
import type { LanguageId } from '../../shared/languages';
import { SourceError, type ImportContext, type NormalizedQuestion, type SearchResult, type SourceAdapter } from './types';

const API = 'https://datasets-server.huggingface.co';
const DATASET = 'deepmind/code_contests';
const SPLITS = ['test', 'valid'] as const;
const DAY = 24 * 3600_000;

interface TestSet {
  input: string[];
  output: string[];
}

export interface CodeContestsRow {
  name: string;
  description: string;
  public_tests: TestSet;
  private_tests: TestSet;
  generated_tests: TestSet;
  source: number;
  difficulty: number;
  solutions: { language: number[]; solution: string[] };
  cf_contest_id: number;
  cf_index: string;
  cf_rating: number;
  cf_tags: string[];
  time_limit: { seconds: number; nanos: number } | null;
  memory_limit_bytes: number;
}

interface RowsResponse {
  rows: { row_idx: number; row: CodeContestsRow; truncated_cells: string[] }[];
  num_rows_total: number;
}

const SOURCES: Record<number, string> = { 1: 'CodeChef', 2: 'Codeforces', 3: 'HackerEarth', 4: 'Code Jam', 5: 'AtCoder', 6: 'Aizu' };
// CodeContests language codes: 2 = C++, 3 = Python 3, 4 = Java (1 is Python 2).
const LANGS: [number, LanguageId][] = [
  [2, 'cpp'],
  [3, 'python'],
  [4, 'java'],
];

function rowsUrl(split: string, offset: number, length: number) {
  return `${API}/rows?dataset=${encodeURIComponent(DATASET)}&config=default&split=${split}&offset=${offset}&length=${length}`;
}

/** "1575_A. Another Sorting Problem" → "Another Sorting Problem". */
const cleanName = (name: string) => name.replace(/^\d+_[A-Z]\d*\.\s*/, '').trim();

const originUrl = (r: CodeContestsRow) =>
  r.source === 2 && r.cf_contest_id ? `https://codeforces.com/problemset/problem/${r.cf_contest_id}/${r.cf_index}` : null;

export const codeContestsAdapter: SourceAdapter<CodeContestsRow & { externalId: string }> = {
  info: {
    id: 'code-contests',
    name: 'CodeContests dataset',
    kind: 'dataset',
    description: 'DeepMind CodeContests on Hugging Face: statements, sample and hidden tests, and accepted solutions. Searches the test and validation splits.',
    licenseNote:
      'Dataset released under CC BY 4.0 by DeepMind (Li et al., 2022). Problems originally come from Codeforces, AtCoder, CodeChef and others; keep the attribution that Codr adds.',
    provides: { statement: true, tests: true, solution: true },
  },

  async search(query, ctx: ImportContext) {
    // A name index of the small splits, cached for a week (one request per 100 rows).
    const results: SearchResult[] = [];
    const q = query.trim().toLowerCase();
    for (const split of SPLITS) {
      const index = await loadIndex(ctx, split);
      for (const item of index) {
        const hay = `${item.name} ${item.tags.join(' ')}`.toLowerCase();
        if (q && !hay.includes(q)) continue;
        results.push({
          externalId: `${split}:${item.idx}`,
          title: cleanName(item.name),
          url: item.url,
          rating: item.rating || null,
          difficulty: null,
          tags: item.tags,
          detail: `${split} split, ${SOURCES[item.source] ?? 'unknown source'}`,
        });
      }
    }
    return { results: results.slice(0, 100) };
  },

  async fetchProblem(externalId, ctx) {
    const [split, idx] = externalId.split(':');
    if (!SPLITS.includes(split as (typeof SPLITS)[number]) || !/^\d+$/.test(idx ?? '')) throw new SourceError('not_found', 'Unknown dataset row.');
    const res = (await ctx.http.get(rowsUrl(split!, Number(idx), 1), 'json', { cacheMs: 7 * DAY, minIntervalMs: 500, api: true, timeoutMs: 60_000 })) as RowsResponse;
    const row = res.rows?.[0];
    if (!row) throw new SourceError('not_found', 'The dataset has no such row.');
    if (row.truncated_cells.some((c) => c === 'description' || c === 'public_tests')) {
      throw new SourceError('bad_data', 'This row is too large for the dataset API. Try another problem or the import script.');
    }
    return { ...row.row, externalId };
  },

  normalize(raw, ctx) {
    const parts = splitStatement(raw.description.replace(/<image>/g, '*(image omitted)*'));
    const samples = raw.public_tests.input.map((input, i) => ({ input, output: raw.public_tests.output[i] ?? '' }));
    const tests = raw.private_tests.input.map((input, i) => ({ input, output: raw.private_tests.output[i] ?? '' }));
    const extra = Math.max(0, Math.min(ctx.options.extraTests ?? 0, 100));
    for (let i = 0; i < Math.min(extra, raw.generated_tests.input.length); i++) {
      tests.push({ input: raw.generated_tests.input[i]!, output: raw.generated_tests.output[i] ?? '' });
    }
    let referenceSolution: NormalizedQuestion['referenceSolution'] = null;
    for (const [code, language] of LANGS) {
      const i = raw.solutions.language.indexOf(code);
      if (i >= 0 && raw.solutions.solution[i]) {
        referenceSolution = { language, code: raw.solutions.solution[i]! };
        break;
      }
    }
    const seconds = raw.time_limit ? raw.time_limit.seconds + raw.time_limit.nanos / 1e9 : null;
    const origin = SOURCES[raw.source] ?? 'an online judge';
    return {
      externalId: raw.externalId,
      title: cleanName(raw.name),
      url: originUrl(raw),
      statement: parts.statement,
      inputFormat: parts.inputFormat,
      outputFormat: parts.outputFormat,
      constraints: parts.constraints,
      samples,
      notes: parts.notes,
      tags: raw.cf_tags ?? [],
      rating: raw.cf_rating || null,
      difficulty: null,
      timeLimitMs: seconds ? Math.min(15_000, Math.max(100, Math.round(seconds * 1000))) : null,
      memoryLimitMb: raw.memory_limit_bytes ? Math.min(1024, Math.max(16, Math.round(raw.memory_limit_bytes / 1_000_000))) : null,
      tests,
      referenceSolution,
      license: 'CC BY 4.0 (CodeContests dataset)',
      attribution: `From the DeepMind CodeContests dataset (Li et al., 2022); originally published on ${origin}.`,
    };
  },
};

interface IndexItem {
  idx: number;
  name: string;
  tags: string[];
  rating: number;
  source: number;
  url: string | null;
}

interface ParquetListing {
  parquet_files: { split: string; url: string; size: number }[];
}

/**
 * A name/tag index of a split, read from the dataset's Parquet file with
 * column projection over HTTP range requests (~0.5 MB instead of ~60 MB of
 * full rows), then cached for a week.
 */
async function loadIndex(ctx: ImportContext, split: string): Promise<IndexItem[]> {
  return ctx.http.remember(`code-contests:index:${split}`, 7 * DAY, async () => {
    const listing = (await ctx.http.get(`${API}/parquet?dataset=${encodeURIComponent(DATASET)}`, 'json', { cacheMs: 7 * DAY, minIntervalMs: 500, api: true })) as ParquetListing;
    const files = listing.parquet_files.filter((f) => f.split === split);
    const items: IndexItem[] = [];
    let offset = 0;
    for (const f of files) {
      let file;
      try {
        file = await asyncBufferFromUrl({ url: f.url, requestInit: { headers: { 'user-agent': ctx.http.agent } } });
      } catch (err) {
        throw new SourceError('unavailable', `The dataset files could not be read: ${(err as Error).message}`);
      }
      const metadata = await parquetMetadataAsync(file);
      // Two contiguous column groups, so no request spans the large test/solution columns.
      const names = (await parquetReadObjects({ file, metadata, columns: ['name'] })) as { name: string }[];
      const cf = (await parquetReadObjects({ file, metadata, columns: ['cf_contest_id', 'cf_index', 'cf_rating', 'cf_tags'] })) as {
        cf_contest_id: bigint | number;
        cf_index: string;
        cf_rating: number;
        cf_tags: string[];
      }[];
      names.forEach((n, i) => {
        const meta = cf[i]!;
        const contestId = Number(meta.cf_contest_id ?? 0);
        items.push({
          idx: offset + i,
          name: n.name,
          tags: meta.cf_tags ?? [],
          rating: Number(meta.cf_rating ?? 0),
          source: contestId ? 2 : 0,
          url: contestId ? `https://codeforces.com/problemset/problem/${contestId}/${meta.cf_index}` : null,
        });
      });
      offset += names.length;
    }
    return items;
  });
}
