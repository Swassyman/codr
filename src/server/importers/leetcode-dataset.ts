import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { needsWideInts, parsePythonSignature, toStdinTest, type FunctionSpec } from '../../shared/function-spec';
import type { Difficulty, Sample } from '../../shared/types';
import { SourceError, type ImportContext, type NormalizedQuestion, type SearchResult, type SourceAdapter } from './types';

const API = 'https://datasets-server.huggingface.co';
const DATASET = 'newfacade/LeetCodeDataset';
const SPLITS = ['test', 'train'] as const;
const DAY = 24 * 3600_000;
const MAX_TESTS = 100;

export interface LeetCodeRow {
  task_id: string;
  question_id: number;
  difficulty: string;
  tags: string[];
  problem_description: string;
  starter_code: string;
  completion: string;
  input_output: { input: string; output: string }[];
}

interface RowsResponse {
  rows: { row_idx: number; row: LeetCodeRow; truncated_cells: string[] }[];
}

const DIFFICULTY: Record<string, Difficulty> = { Easy: 'easy', Medium: 'medium', Hard: 'hard' };

export interface ParsedDescription {
  statement: string;
  examples: { input: string; output: string; explanation: string }[];
  constraints: string[];
  followUp: string;
}

/**
 * The dataset flattens superscripts ("10^4" arrives as "104"). In constraint
 * lines, a 10 followed by a plausible exponent is read as a power of ten.
 * Only lines with a comparison are touched, so plain text is left alone.
 */
export function repairExponents(line: string): string {
  if (!/[<>≤≥]/.test(line)) return line;
  return line.replace(/(?<![\w.^])10(1[0-8]|[3-9])(?![\w.])/g, '10^$1');
}

/** Splits a problem description into statement, examples, constraints and follow-up. */
export function parseDescription(description: string): ParsedDescription {
  const text = description.replace(/\r/g, '').replace(/ /g, ' ');
  const exampleStart = text.search(/^Example(?: \d+)?:[ \t]*$/m);
  const constraintsStart = text.search(/^Constraints?:[ \t]*$/m);
  const followStart = text.search(/^Follow[- ]?up:/im);
  const ends = [exampleStart, constraintsStart, followStart].filter((i) => i >= 0);
  const statementEnd = ends.length ? Math.min(...ends) : text.length;

  const sectionEnd = (from: number) => Math.min(...[constraintsStart, followStart, text.length].filter((i) => i > from));
  const examplesText = exampleStart >= 0 ? text.slice(exampleStart, sectionEnd(exampleStart)) : '';
  const examples = examplesText
    .split(/^Example(?: \d+)?:[ \t]*$/m)
    .slice(1)
    .flatMap((block) => {
      const m = /Input:\s*([\s\S]*?)\s*\nOutput:\s*([\s\S]*?)\s*(?:\nExplanation:\s*([\s\S]*?))?\s*$/.exec(block.trim());
      return m ? [{ input: m[1]!.trim(), output: m[2]!.trim(), explanation: (m[3] ?? '').trim() }] : [];
    });

  const constraintsText = constraintsStart >= 0 ? text.slice(constraintsStart, sectionEnd(constraintsStart)) : '';
  const constraints = constraintsText
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(repairExponents);

  const followUp = followStart >= 0 ? text.slice(followStart).replace(/^Follow[- ]?up:\s*/i, '').trim() : '';
  return { statement: text.slice(0, statementEnd).trim(), examples, constraints, followUp };
}

/** The sample for one example, in the stdin form, or null when its literals are not plain values. */
function exampleSample(spec: FunctionSpec, e: ParsedDescription['examples'][number]): Sample | null {
  try {
    const t = toStdinTest(spec, e.input, e.output);
    const called = `Called with \`${e.input}\`, it returns \`${e.output}\`.`;
    return { ...t, explanation: e.explanation ? `${called}\n\n${e.explanation}` : called };
  } catch {
    return null;
  }
}

/** Converts a dataset row into Codr's shape. Exported for tests. */
export function normalizeRow(row: LeetCodeRow): NormalizedQuestion {
  const spec = parsePythonSignature(row.starter_code);
  if (!spec) throw new SourceError('bad_data', 'This problem is not a single-method question (for example a class design problem).');
  if (spec.unsupported) throw new SourceError('bad_data', `This problem cannot be imported: ${spec.unsupported}.`);

  const parsed = parseDescription(row.problem_description);
  const tests: { input: string; output: string }[] = [];
  // The dataset stores a str result as its bare text; every other result as a Python literal.
  const rawText = spec.returnType === 'str';
  for (const t of row.input_output ?? []) {
    if (tests.length >= MAX_TESTS) break;
    if (typeof t?.input !== 'string' || typeof t.output !== 'string') continue;
    try {
      // A str result that is an error message: the reference solution crashed on that input.
      if (rawText && /^Error: /.test(t.output)) continue;
      const test = toStdinTest(spec, t.input, t.output, { rawText });
      if (test.output === 'null\n') {
        // The dataset prints an empty list or tree result as None, and the wrappers as [] (LeetCode's form).
        if (/Node/.test(spec.returnType)) test.output = '[]\n';
        // A null result for a signature that cannot return null: the reference solution fell off the end
        // on an input outside the problem's constraints (two-sum with no pair), so it is not a valid test.
        else continue;
      }
      tests.push(test);
    } catch {
      // A test whose values are not plain literals (an error message, float("inf")) is skipped.
    }
  }
  if (tests.length === 0) throw new SourceError('bad_data', 'None of this problem\'s tests could be read.');

  // Some statements give their examples in a free-form layout; the first tests stand in so "Run examples" still works.
  const parsedSamples = parsed.examples.flatMap((e) => exampleSample(spec, e) ?? []);
  const samples = parsedSamples.length ? parsedSamples : tests.slice(0, 2).map((t) => ({ ...t }));

  const title = row.task_id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const params = spec.params.map((p) => `\`${p.name}\` (${p.type})`).join(', ');
  return {
    externalId: row.task_id,
    title,
    url: `https://leetcode.com/problems/${row.task_id}/`,
    statement: parsed.statement,
    inputFormat: `Implement \`${spec.name}(${spec.params.map((p) => p.name).join(', ')})\`. Arguments: ${params || 'none'}.`,
    outputFormat: `Return a value of type ${spec.returnType}.`,
    constraints: parsed.constraints,
    samples,
    notes: parsed.followUp ? `**Follow-up:** ${parsed.followUp}` : '',
    tags: row.tags ?? [],
    rating: null,
    difficulty: DIFFICULTY[row.difficulty] ?? null,
    timeLimitMs: null,
    memoryLimitMb: null,
    tests,
    referenceSolution: row.completion ? { language: 'python', code: row.completion } : null,
    // Statically typed languages use 64-bit integers when any test needs them.
    functionSpec: { ...spec, wide: needsWideInts(spec, [...tests, ...samples]) },
    // The result is one JSON value: integers compare exactly, other numbers within a tolerance.
    checker: { type: 'json', epsilon: 1e-5 },
    license: 'Apache-2.0 (newfacade/LeetCodeDataset). The problem statements originate from LeetCode (© LeetCode); private local use with attribution.',
    attribution: `From the LeetCodeDataset by newfacade (Apache-2.0); problem "${title}" originally published on LeetCode.`,
  };
}

interface IndexItem {
  split: string;
  idx: number;
  slug: string;
  qid: number;
  difficulty: Difficulty | null;
  tags: string[];
  /** Null when importable; otherwise why not. */
  unsupported: string | null;
}

interface ParquetListing {
  parquet_files: { split: string; url: string }[];
}

/**
 * A title/tag index of both splits, read from the dataset's Parquet files with
 * column projection over range requests (the large solution, test and prompt
 * columns are never downloaded), then cached for a week.
 */
async function loadIndex(ctx: ImportContext): Promise<IndexItem[]> {
  return ctx.http.remember('leetcode-dataset:index', 7 * DAY, async () => {
    const listing = (await ctx.http.get(`${API}/parquet?dataset=${encodeURIComponent(DATASET)}`, 'json', { cacheMs: 7 * DAY, minIntervalMs: 500, api: true })) as ParquetListing;
    const items: IndexItem[] = [];
    const seen = new Set<string>();
    for (const split of SPLITS) {
      let offset = 0;
      for (const f of listing.parquet_files.filter((p) => p.split === split)) {
        let file;
        try {
          file = await asyncBufferFromUrl({ url: f.url, requestInit: { headers: { 'user-agent': ctx.http.agent } } });
        } catch (err) {
          throw new SourceError('unavailable', `The dataset files could not be read: ${(err as Error).message}`);
        }
        const metadata = await parquetMetadataAsync(file);
        const rows = (await parquetReadObjects({ file, metadata, columns: ['task_id', 'question_id', 'difficulty', 'tags', 'starter_code'] })) as {
          task_id: string;
          question_id: bigint | number;
          difficulty: string;
          tags: string[];
          starter_code: string;
        }[];
        rows.forEach((r, i) => {
          if (seen.has(r.task_id)) return;
          seen.add(r.task_id);
          const spec = parsePythonSignature(r.starter_code);
          items.push({
            split,
            idx: offset + i,
            slug: r.task_id,
            qid: Number(r.question_id),
            difficulty: DIFFICULTY[r.difficulty] ?? null,
            tags: r.tags ?? [],
            unsupported: spec ? spec.unsupported : 'it is a class design question',
          });
        });
        offset += rows.length;
      }
    }
    return items;
  });
}

const titleOf = (slug: string) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export const leetcodeDatasetAdapter: SourceAdapter<LeetCodeRow> = {
  info: {
    id: 'leetcode-dataset',
    name: 'LeetCode problems (LeetCodeDataset)',
    kind: 'dataset',
    description:
      'Function-style problems from the LeetCodeDataset on Hugging Face: statement, examples, up to 100 tests, tags, difficulty and an accepted Python solution. Questions are function-style: participants implement a method and Codr drives it with the test arguments. Class design questions, in-place edits and graph-node types are left out.',
    licenseNote:
      'The dataset is Apache-2.0, but the problem statements originate from LeetCode and are © LeetCode. Import them for private use on your local network, keep the attribution Codr adds, and do not republish them publicly.',
    provides: { statement: true, tests: true, solution: true },
  },

  async search(query, ctx) {
    const index = await loadIndex(ctx);
    const q = query.trim().toLowerCase();
    const usable = index.filter((i) => !i.unsupported);
    const matches = usable.filter((i) => !q || `${i.slug} ${i.tags.join(' ')} ${i.difficulty ?? ''}`.toLowerCase().includes(q) || String(i.qid) === q);
    const results: SearchResult[] = matches.slice(0, 100).map((i) => ({
      externalId: i.slug,
      title: titleOf(i.slug),
      url: `https://leetcode.com/problems/${i.slug}/`,
      rating: null,
      difficulty: i.difficulty,
      tags: i.tags.map((t) => t.toLowerCase()),
      detail: `LeetCode #${i.qid}`,
    }));
    const hidden = index.length - usable.length;
    const parts = [matches.length > 100 ? `Showing 100 of ${matches.length}.` : '', hidden > 0 ? `${hidden} problems are not listed because they cannot be driven as a single function.` : ''];
    return { results, note: parts.filter(Boolean).join(' ') || undefined };
  },

  async fetchProblem(externalId, ctx) {
    const item = (await loadIndex(ctx)).find((i) => i.slug === externalId);
    if (!item) throw new SourceError('not_found', 'The dataset has no such problem.');
    const res = (await ctx.http.get(`${API}/rows?dataset=${encodeURIComponent(DATASET)}&config=default&split=${item.split}&offset=${item.idx}&length=1`, 'json', {
      cacheMs: 7 * DAY,
      minIntervalMs: 500,
      api: true,
      timeoutMs: 60_000,
    })) as RowsResponse;
    const row = res.rows?.[0];
    if (!row || row.row.task_id !== externalId) throw new SourceError('not_found', 'The dataset has no such row.');
    if (row.truncated_cells.some((c) => ['problem_description', 'starter_code', 'input_output', 'completion'].includes(c))) {
      throw new SourceError('bad_data', 'This row is too large for the dataset API. Try another problem.');
    }
    return row.row;
  },

  normalize(raw) {
    return normalizeRow(raw);
  },
};
