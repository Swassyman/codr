import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

// The contest autocomplete rule in the editor, the participant's own switch in
// practice, versioned language labels, and a finished contest's questions
// arriving in practice. Needs the seeded questions and a ready runner.

const ADMIN = { login: process.env.E2E_ADMIN_USERNAME ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'codr-admin' };
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const stamp = Date.now();

async function adminApi() {
  const api = await request.newContext({ baseURL });
  await api.get('/api/auth/me');
  const csrf = (await api.storageState()).cookies.find((c) => c.name === 'codr_csrf')!.value;
  const headers = { 'x-csrf-token': csrf };
  const login = await api.post('/api/auth/login', { data: ADMIN, headers });
  expect(login.ok(), 'admin login (set E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD)').toBeTruthy();
  const call = async (method: 'post' | 'patch' | 'put' | 'get', url: string, data?: unknown) => {
    const res = await api[method](url, method === 'get' ? undefined : { data: data ?? {}, headers });
    expect(res.ok(), `${method.toUpperCase()} ${url}: ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  return { api, call };
}

type Call = Awaited<ReturnType<typeof adminApi>>['call'];

async function questionId(call: Call, slug: string): Promise<number> {
  const { questions } = await call('get', `/api/manage/questions?search=${slug}`);
  const q = questions.find((x: { slug: string }) => x.slug === slug);
  expect(q, `seeded question "${slug}" (run the seed first)`).toBeTruthy();
  return q.id;
}

async function contest(call: Call, fields: Record<string, unknown>, questionIds: number[]) {
  const { id } = await call('post', '/api/manage/contests');
  await call('patch', `/api/manage/contests/${id}`, { timingMode: 'fixed_window', visibility: 'public', ...fields });
  await call('put', `/api/manage/contests/${id}/questions`, { items: questionIds.map((questionId) => ({ questionId, points: null, durationMinutes: null })) });
  await call('post', `/api/manage/contests/${id}/publish`);
  return id as number;
}

// Labels gain their versions when /api/runtimes answers, which can be after the editor appears.
const languageOptions = (page: Page) => page.getByRole('combobox', { name: 'Language' }).locator('option').allTextContents();

const suggestions = (page: Page) => page.locator('.monaco-editor .suggest-widget.visible .monaco-list-row');

async function typeInEditor(page: Page, text: string) {
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 30 });
}

let admin: APIRequestContext;
let ruleContestId: number;
let pastContestName: string;
let pastQuestionSlug: string;

test.beforeAll(async () => {
  const { api, call } = await adminApi();
  admin = api;
  const now = Date.now();

  // A live contest that turns autocomplete off.
  ruleContestId = await contest(
    call,
    { name: `E2E no autocomplete ${stamp}`, autocomplete: 'off', startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 2 * 3600_000).toISOString() },
    [await questionId(call, 'sum-of-two-numbers')],
  );

  // A question that is not marked for practice, in a contest that is already over.
  // Its own language list, so the TypeScript and Zig labels can be checked on a
  // database seeded before those languages existed.
  pastQuestionSlug = `e2e-past-${stamp}`;
  const { id: qid } = await call('post', '/api/manage/questions', { title: `Past round question ${stamp}` });
  await call('patch', `/api/manage/questions/${qid}`, {
    slug: pastQuestionSlug,
    statement: 'Print the sum.',
    practice: false,
    allowedLanguages: ['python', 'typescript', 'zig'],
  });
  await call('post', `/api/manage/questions/${qid}/tests`, { tests: [{ input: '1 2\n', expectedOutput: '3\n' }] });
  await call('post', `/api/manage/questions/${qid}/publish`, { acknowledgeValidation: true });
  pastContestName = `E2E past round ${stamp}`;
  await contest(call, { name: pastContestName, startsAt: new Date(now - 3 * 3600_000).toISOString(), endsAt: new Date(now - 3600_000).toISOString() }, [qid]);
});

test.afterAll(async () => {
  await admin?.dispose();
});

test('autocomplete follows the contest rule, and practice lets the participant choose', async ({ page }) => {
  const username = `e2eac${stamp % 1_000_000}`;

  await test.step('register an account', async () => {
    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Display name').fill('Autocomplete Tester');
    await page.getByLabel('Password').fill('playwright-pass');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step('the lobby states the rule', async () => {
    await page.goto(`/contests/${ruleContestId}`);
    await expect(page.getByText('Editor autocomplete is off for everyone.')).toBeVisible();
    await page.getByRole('button', { name: 'Register' }).click();
    await page.getByRole('button', { name: 'Start contest' }).click();
    await page.getByRole('button', { name: 'Open question A' }).click();
    await expect(page.getByRole('heading', { name: 'Sum of Two Numbers' })).toBeVisible();
  });

  await test.step('the contest locks the switch off and no suggestions appear', async () => {
    const toggle = page.getByRole('switch', { name: /Autocomplete/ });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('· contest rule')).toBeVisible();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('python');
    await typeInEditor(page, 'zebracorn = 1\nzebr');
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(800);
    await expect(suggestions(page)).toHaveCount(0);
  });

  await test.step('language labels carry the installed version', async () => {
    await expect.poll(() => languageOptions(page)).toContainEqual(expect.stringMatching(/^Python 3 \(CPython \d+\.\d+/));
    for (const label of await languageOptions(page)) expect(label).toMatch(/ \(\S+ \d+\.\d+[^)]*\)$/);
  });

  await test.step('practice starts with autocomplete off and remembers turning it on', async () => {
    await page.goto('/practice/making-change');
    const toggle = page.getByRole('switch', { name: /Autocomplete/ });
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('combobox', { name: 'Language' }).selectOption('python');
    await typeInEditor(page, 'zebracorn = 1\nzebr');
    await page.waitForTimeout(800);
    await expect(suggestions(page)).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await typeInEditor(page, 'zebracorn = 1\nzebr');
    await expect(suggestions(page).filter({ hasText: 'zebracorn' })).toHaveCount(1);

    await page.reload();
    await expect(page.getByRole('switch', { name: /Autocomplete/ })).toHaveAttribute('aria-checked', 'true');
  });

  await test.step('a finished contest brings its questions to practice, tagged with the contest', async () => {
    await page.goto('/practice');
    const row = page.getByRole('link', { name: new RegExp(`Past round question ${stamp}`) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`from ${pastContestName}`);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/practice/${pastQuestionSlug}$`));
    await expect(page.getByText(`from ${pastContestName}`)).toBeVisible();
    await expect.poll(() => languageOptions(page)).toContainEqual(expect.stringMatching(/^TypeScript \(tsc \d+\.\d+/));
    expect(await languageOptions(page)).toContainEqual(expect.stringMatching(/^Zig \(zig \d+\.\d+/));
  });
});
