import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

const ADMIN = { login: process.env.E2E_ADMIN_USERNAME ?? 'admin', password: process.env.E2E_ADMIN_PASSWORD ?? 'codr-admin' };
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/** An API client signed in as the admin, sending the CSRF header like the SPA does. */
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

async function questionId(call: Awaited<ReturnType<typeof adminApi>>['call'], slug: string): Promise<number> {
  const { questions } = await call('get', `/api/manage/questions?search=${slug}`);
  const q = questions.find((x: { slug: string }) => x.slug === slug);
  expect(q, `seeded question "${slug}" (run the seed first)`).toBeTruthy();
  return q.id;
}

async function writeCode(page: Page, code: string) {
  await page.getByRole('combobox', { name: 'Language' }).selectOption('python');
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
}

let contestId: number;
let admin: APIRequestContext;

test.beforeAll(async () => {
  const { api, call } = await adminApi();
  admin = api;
  const a = await questionId(call, 'sum-of-two-numbers');
  const b = await questionId(call, 'average-of-a-list');
  const { id } = await call('post', '/api/manage/contests');
  contestId = id;
  const now = Date.now();
  await call('patch', `/api/manage/contests/${id}`, {
    name: `E2E view-once ${new Date(now).toISOString()}`,
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 2 * 3600_000).toISOString(),
    timingMode: 'fixed_window',
    viewOnce: true,
    visibility: 'public',
  });
  await call('put', `/api/manage/contests/${id}/questions`, {
    items: [
      { questionId: a, points: null, durationMinutes: null },
      { questionId: b, points: null, durationMinutes: null },
    ],
  });
  await call('post', `/api/manage/contests/${id}/publish`);
});

test.afterAll(async () => {
  await admin?.dispose();
});

test('a participant goes through a view-once contest', async ({ page, context }) => {
  const username = `e2e${Date.now() % 1_000_000}`;

  await test.step('register an account', async () => {
    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Display name').fill('End To End');
    await page.getByLabel('Password').fill('playwright-pass');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step('read the rules and start', async () => {
    await page.goto(`/contests/${contestId}`);
    await expect(page.getByText('You can open each question once.')).toBeVisible();
    await page.getByRole('button', { name: 'Register' }).click();
    await page.getByRole('button', { name: 'Start contest' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('You can open each question only once');
    await dialog.getByRole('button', { name: 'Start now' }).click();
  });

  await test.step('solve question A', async () => {
    await page.getByRole('button', { name: 'Open question A' }).click();
    await expect(page).toHaveURL(new RegExp(`/contests/${contestId}/q/A$`));
    await expect(page.getByRole('heading', { name: 'Sum of Two Numbers' })).toBeVisible();
    await writeCode(page, 'a, b = map(int, input().split())\nprint(a + b)\n');
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect(page.getByText('100 / 100')).toBeVisible();
  });

  await test.step('moving on asks for confirmation, then locks A', async () => {
    await page.getByRole('button', { name: /^Question B/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText("You won't be able to come back to question A");
    await dialog.getByRole('button', { name: 'Open question B' }).click();
    await expect(page).toHaveURL(new RegExp(`/contests/${contestId}/q/B$`));
    await expect(page.getByRole('heading', { name: 'Average of a List' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Question A.*locked/ })).toBeDisabled();
  });

  await test.step('A stays locked: direct link, reload and a new tab', async () => {
    await page.goto(`/contests/${contestId}/q/A`);
    await expect(page.getByText('Question A is not available')).toBeVisible();
    await expect(page.getByText('You moved on from this question, so it is locked.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Question A is not available')).toBeVisible();

    const tab = await context.newPage();
    await tab.goto(`/contests/${contestId}/q/A`);
    await expect(tab.getByText('Question A is not available')).toBeVisible();
    await tab.close();
  });

  await test.step('the server refuses the statement and submissions for A', async () => {
    const state = await page.request.get(`/api/contests/${contestId}/state`);
    const a = (await state.json()).questions[0];
    const csrf = (await context.cookies()).find((c) => c.name === 'codr_csrf')!.value;
    const open = await page.request.post(`/api/contests/${contestId}/questions/${a.questionId}/open`, { headers: { 'x-csrf-token': csrf }, data: {} });
    expect(open.status()).toBe(409);
    expect((await open.json()).error.code).toBe('question_left');
    const submit = await page.request.post(`/api/contests/${contestId}/questions/${a.questionId}/submit`, {
      headers: { 'x-csrf-token': csrf },
      data: { language: 'python', code: 'print(0)' },
    });
    expect(submit.status()).toBe(409);
  });

  await test.step('B still works, and judging reports a wrong answer', async () => {
    await page.goto(`/contests/${contestId}/q/B`);
    await expect(page.getByRole('heading', { name: 'Average of a List' })).toBeVisible();
    await writeCode(page, 'print(0)\n');
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect(page.getByTitle('Wrong answer').first()).toBeVisible();
  });
});
