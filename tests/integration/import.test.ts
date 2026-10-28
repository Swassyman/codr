import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, createUser, TestClient, type TestContext } from '../helpers/context';
import { findImported, saveImported } from '../../src/server/importers/registry';
import type { NormalizedQuestion } from '../../src/server/importers/types';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const problem = (over: Partial<NormalizedQuestion> = {}): NormalizedQuestion => ({
  externalId: 'test:7',
  title: 'Imported Sum',
  url: 'https://example.org/p/7',
  statement: 'Add numbers.',
  inputFormat: 'Two integers.',
  outputFormat: 'Their sum.',
  constraints: ['1 \\le a, b \\le 10'],
  samples: [{ input: '1 2\n', output: '3\n' }],
  notes: '',
  tags: ['Math'],
  rating: 800,
  difficulty: null,
  timeLimitMs: 1000,
  memoryLimitMb: 128,
  tests: [{ input: '2 2\n', output: '4\n' }],
  referenceSolution: { language: 'python', code: 'print(sum(map(int, input().split())))' },
  license: 'CC BY 4.0',
  attribution: 'From a test dataset.',
  ...over,
});

describe('saving imports', () => {
  it('creates a draft with attribution and tests, and never duplicates', async () => {
    const user = await createUser(ctx.db, 'importer', 'creator');
    const first = await saveImported(ctx.db, 'code-contests', problem(), user.id, ctx.clock.now());
    expect(first.existed).toBe(false);
    const again = await saveImported(ctx.db, 'code-contests', problem(), user.id, ctx.clock.now());
    expect(again).toEqual({ id: first.id, existed: true });

    const client = new TestClient(ctx.app);
    await client.login('importer');
    const q = (await client.get(`/api/manage/questions/${first.id}`)).body;
    expect(q).toMatchObject({
      status: 'draft',
      practice: false,
      title: 'Imported Sum',
      tags: ['math'],
      timeLimitMs: 1000,
      memoryLimitMb: 128,
      testCount: 1,
      referenceSolution: { language: 'python' },
      source: { adapter: 'code-contests', externalId: 'test:7', url: 'https://example.org/p/7', license: 'CC BY 4.0' },
    });
    expect((await findImported(ctx.db, 'code-contests', ['test:7', 'test:8'])).get('test:7')).toBe(first.id);
  });

  it('keeps metadata-only imports as drafts without tests', async () => {
    const { id } = await saveImported(ctx.db, 'codeforces', problem({ externalId: '1/A', statement: '', samples: [], tests: [], referenceSolution: null }), null, ctx.clock.now());
    const admin = await createUser(ctx.db, 'root', 'admin');
    const client = new TestClient(ctx.app);
    await client.login(admin.username);
    const q = (await client.get(`/api/manage/questions/${id}`)).body;
    expect(q).toMatchObject({ testCount: 0, statement: '', status: 'draft' });
    // Publishing is blocked until a statement and tests exist.
    expect((await client.post(`/api/manage/questions/${id}/publish`)).body.error.code).toBe('not_ready');
  });

  it('lists the sources with their license notes', async () => {
    await createUser(ctx.db, 'lister', 'creator');
    const client = new TestClient(ctx.app);
    await client.login('lister');
    const res = await client.get('/api/manage/import/sources');
    expect(res.body.sources.map((s: { id: string }) => s.id)).toEqual(['code-contests', 'codeforces', 'atcoder', 'cses']);
    for (const s of res.body.sources) expect(s.licenseNote.length).toBeGreaterThan(20);
    expect((await client.get('/api/manage/import/nope/search?q=x')).status).toBe(404);
  });
});
