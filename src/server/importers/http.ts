import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { importCache } from '../db/schema';
import { SourceError } from './types';

interface FetchOptions {
  /** How long a successful response is reused (stored in Postgres). */
  cacheMs: number;
  /** Minimum gap between requests to the same host. */
  minIntervalMs: number;
  timeoutMs?: number;
  /** Skip the robots.txt check (only for documented APIs meant for programs). */
  api?: boolean;
}

interface RobotsRules {
  disallow: string[];
  allow: string[];
}

/** Parses the rules that apply to every user agent ("*") and to "codr". */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [] };
  let applies = false;
  let sawRule = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const key = field!.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (sawRule) {
        applies = false;
        sawRule = false;
      }
      if (value === '*' || value.toLowerCase().includes('codr')) applies = true;
    } else if (key === 'disallow' || key === 'allow') {
      sawRule = true;
      if (applies && value) (key === 'disallow' ? rules.disallow : rules.allow).push(value);
    }
  }
  return rules;
}

export function robotsAllows(rules: RobotsRules, path: string) {
  const longest = (list: string[]) => list.filter((p) => path.startsWith(p.replace(/\*$/, ''))).reduce((m, p) => Math.max(m, p.length), -1);
  return longest(rules.allow) >= longest(rules.disallow);
}

/**
 * The importer's only way out to the internet: honest User-Agent, robots.txt
 * respected, one request at a time per host with a minimum gap, responses
 * cached in Postgres, and anti-bot pages treated as "blocked" (never bypassed).
 */
export class PoliteHttp {
  private readonly lastRequest = new Map<string, number>();
  private readonly hostQueues = new Map<string, Promise<unknown>>();
  private readonly robots = new Map<string, { at: number; rules: RobotsRules }>();

  constructor(
    private readonly db: DB,
    private readonly userAgent: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async cached(key: string) {
    const [row] = await this.db.select().from(importCache).where(eq(importCache.key, key));
    if (row && row.expiresAt > this.now()) return row.value;
    return undefined;
  }

  private async store(key: string, value: unknown, ttlMs: number) {
    const now = this.now();
    await this.db
      .insert(importCache)
      .values({ key, value: value as never, fetchedAt: now, expiresAt: new Date(now.getTime() + ttlMs) })
      .onConflictDoUpdate({ target: importCache.key, set: { value: value as never, fetchedAt: now, expiresAt: new Date(now.getTime() + ttlMs) } });
  }

  /** Computes a value once and keeps it in the cache (e.g. a derived search index). */
  async remember<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
    const hit = await this.cached(`memo:${key}`.slice(0, 300));
    if (hit !== undefined) return hit as T;
    const value = await producer();
    await this.store(`memo:${key}`.slice(0, 300), value, ttlMs);
    return value;
  }

  get agent() {
    return this.userAgent;
  }

  /** Serialises requests per host and keeps the minimum gap between them. */
  private throttle<T>(host: string, minIntervalMs: number, task: () => Promise<T>): Promise<T> {
    const previous = this.hostQueues.get(host) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const wait = (this.lastRequest.get(host) ?? 0) + minIntervalMs - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.lastRequest.set(host, Date.now());
        return task();
      });
    this.hostQueues.set(host, next);
    return next;
  }

  private async checkRobots(url: URL) {
    const origin = url.origin;
    let entry = this.robots.get(origin);
    if (!entry || Date.now() - entry.at > 24 * 3600_000) {
      let text = '';
      try {
        const res = await fetch(`${origin}/robots.txt`, { headers: { 'user-agent': this.userAgent }, signal: AbortSignal.timeout(10_000) });
        text = res.ok ? await res.text() : '';
      } catch {
        text = '';
      }
      entry = { at: Date.now(), rules: parseRobots(text) };
      this.robots.set(origin, entry);
    }
    if (!robotsAllows(entry.rules, url.pathname)) {
      throw new SourceError('robots', `${url.host} asks automated clients not to fetch ${url.pathname} (robots.txt).`);
    }
  }

  async get(url: string, kind: 'json' | 'text', opts: FetchOptions): Promise<unknown> {
    const key = `${kind}:${url}`.slice(0, 300);
    const hit = await this.cached(key);
    if (hit !== undefined) return hit;
    const u = new URL(url);
    if (!opts.api) await this.checkRobots(u);
    const body = await this.throttle(u.host, opts.minIntervalMs, async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { 'user-agent': this.userAgent, accept: kind === 'json' ? 'application/json' : 'text/html,text/plain' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        });
      } catch (err) {
        throw new SourceError('unavailable', `${u.host} could not be reached: ${(err as Error).message}`);
      }
      const text = await res.text();
      // Bot challenges (e.g. Cloudflare) are respected as a refusal, never worked around.
      if (res.status === 403 || res.status === 429 || res.status === 503) {
        const challenge = res.headers.has('cf-mitigated') || /just a moment|cf-chl|captcha/i.test(text.slice(0, 4000));
        throw new SourceError(challenge ? 'blocked' : 'unavailable', challenge ? `${u.host} blocks automated access. Open the link and paste the statement instead.` : `${u.host} answered ${res.status}. Try again later.`);
      }
      if (res.status === 404) throw new SourceError('not_found', 'The source has no such problem.');
      if (!res.ok) throw new SourceError('unavailable', `${u.host} answered ${res.status}.`);
      if (kind === 'text') return text;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new SourceError('bad_data', `${u.host} did not return JSON.`);
      }
    });
    await this.store(key, body, opts.cacheMs);
    return body;
  }
}
