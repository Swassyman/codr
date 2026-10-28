import { decodeEntities, htmlToMarkdown, stripTags } from './html';
import { SourceError, type NormalizedQuestion, type SearchResult, type SourceAdapter } from './types';

const BASE = 'https://cses.fi';
const DAY = 24 * 3600_000;

interface CsesTask {
  id: string;
  html: string;
}

/** Parses the problem list: categories (h2) and their task links. */
export function parseTaskList(html: string) {
  const tasks: { id: string; name: string; category: string }[] = [];
  for (const chunk of html.split('<h2>').slice(1)) {
    const category = stripTags(chunk.slice(0, chunk.indexOf('</h2>'))).trim();
    for (const m of chunk.matchAll(/<a href="\/problemset\/task\/(\d+)\/?">([^<]+)<\/a>/g)) {
      tasks.push({ id: m[1]!, name: decodeEntities(m[2]!).trim(), category });
    }
  }
  return tasks;
}

/** Splits a task page into the structured form. Exported for tests. */
export function parseTaskPage(html: string, id: string): NormalizedQuestion {
  const title = decodeEntities(/<title>(?:CSES - )?([^<]*)<\/title>/.exec(html)?.[1] ?? `CSES task ${id}`).trim();
  const timeSec = /Time limit:<\/b>\s*([\d.]+)\s*s/.exec(html)?.[1];
  const memMb = /Memory limit:<\/b>\s*(\d+)\s*MB/.exec(html)?.[1];
  const start = html.indexOf('<div class="md">');
  if (start < 0) throw new SourceError('bad_data', 'The task page did not have the expected layout. Paste the statement instead.');
  const md = html.slice(start + '<div class="md">'.length, html.indexOf('</div>', start));
  const pageUrl = `${BASE}/problemset/task/${id}`;

  // Sections are introduced by <h1 id="...">Title</h1>.
  const pieces = md.split(/<h1 id="([^"]*)">[^<]*<\/h1>/);
  const sections: Record<string, string> = { statement: pieces[0] ?? '' };
  for (let i = 1; i < pieces.length; i += 2) sections[pieces[i]!.toLowerCase()] = pieces[i + 1] ?? '';

  const exampleHtml = Object.entries(sections)
    .filter(([key]) => key.startsWith('example'))
    .map(([, v]) => v)
    .join('');
  const pres = [...exampleHtml.matchAll(/<pre>([\s\S]*?)<\/pre>/g)].map((m) => decodeEntities(m[1]!));
  const samples = [];
  for (let i = 0; i + 1 < pres.length; i += 2) samples.push({ input: pres[i]!, output: pres[i + 1]! });
  const explanation = exampleHtml.replace(/<p>(Input|Output):<\/p>/g, '').replace(/<pre>[\s\S]*?<\/pre>/g, '');

  const constraints = [...(sections.constraints ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => htmlToMarkdown(m[1]!, pageUrl));

  return {
    externalId: id,
    title,
    url: pageUrl,
    statement: htmlToMarkdown(sections.statement ?? '', pageUrl),
    inputFormat: htmlToMarkdown(sections.input ?? '', pageUrl),
    outputFormat: htmlToMarkdown(sections.output ?? '', pageUrl),
    constraints,
    samples,
    notes: htmlToMarkdown(explanation, pageUrl),
    tags: [],
    rating: null,
    difficulty: null,
    timeLimitMs: timeSec ? Math.round(Number(timeSec) * 1000) : null,
    memoryLimitMb: memMb ? Number(memMb) : null,
    // Examples are judged anyway; the real tests are not public.
    tests: [],
    referenceSolution: null,
    license: 'Not openly licensed (© CSES / Antti Laaksonen); private local use with attribution only',
    attribution: `CSES Problem Set, "${title}".`,
  };
}

/**
 * Best-effort scraper for the CSES Problem Set. Pages are fetched politely
 * (robots.txt, one request every 2 s, cached a week) and the adapter fails on
 * its own without affecting other sources. Hidden tests are not available
 * publicly, so imports carry only the examples as tests.
 */
export const csesAdapter: SourceAdapter<CsesTask> = {
  info: {
    id: 'cses',
    name: 'CSES Problem Set (best effort)',
    kind: 'scraper',
    description: 'Statements, limits and examples read from cses.fi task pages. Hidden tests are not public: add your own or generate outputs from a reference solution.',
    licenseNote: 'CSES statements are not openly licensed. Import them only for private use on your local network, keep the attribution, and do not republish them publicly.',
    provides: { statement: true, tests: false, solution: false },
  },

  async search(query, ctx) {
    const html = (await ctx.http.get(`${BASE}/problemset/`, 'text', { cacheMs: 7 * DAY, minIntervalMs: 2000 })) as string;
    const q = query.trim().toLowerCase();
    const tasks = parseTaskList(html).filter((t) => !q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.id === q);
    const results: SearchResult[] = tasks.slice(0, 100).map((t) => ({
      externalId: t.id,
      title: t.name,
      url: `${BASE}/problemset/task/${t.id}`,
      rating: null,
      difficulty: null,
      tags: [t.category.toLowerCase()],
      detail: t.category,
    }));
    return { results, note: tasks.length > 100 ? `Showing 100 of ${tasks.length}.` : undefined };
  },

  async fetchProblem(externalId, ctx) {
    if (!/^\d+$/.test(externalId)) throw new SourceError('not_found', 'CSES task ids are numbers.');
    const html = (await ctx.http.get(`${BASE}/problemset/task/${externalId}`, 'text', { cacheMs: 7 * DAY, minIntervalMs: 2000 })) as string;
    return { id: externalId, html };
  },

  normalize(raw) {
    return parseTaskPage(raw.html, raw.id);
  },
};
