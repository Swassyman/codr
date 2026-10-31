import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

// Zen mode, fullscreen, editor settings (tab width, theme, Vim) and the hidden
// contest timer. Creates its own questions; needs a ready runner.

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

async function register(page: Page, username: string) {
  await page.goto('/register');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Display name').fill('Editor Tester');
  await page.getByLabel('Password').fill('playwright-pass');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/$/);
}

const editor = (page: Page) => page.locator('.monaco-editor').first();
// The statement's title, not the practice header's copy of it.
const statement = (page: Page, title: string) => page.locator('h1:not(header h1)', { hasText: title });
const bottomTabs = (page: Page) => page.getByRole('tab', { name: 'Custom input' });
const zenBar = (page: Page) => page.getByRole('toolbar', { name: 'Zen mode' });

/** The first line as rendered: Monaco draws leading spaces as no-break spaces. */
async function firstLine(page: Page) {
  return (await page.locator('.monaco-editor .view-line').first().textContent())?.replace(/\u00a0/g, ' ') ?? '';
}

async function clearEditor(page: Page) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
}

/**
 * A question of its own. A running contest hides its questions from practice,
 * so sharing seeded questions with other specs' contests (or this spec's) would
 * make tests depend on each other.
 */
async function sumQuestion(call: Call, title: string, slug: string, practice: boolean): Promise<number> {
  const { id } = await call('post', '/api/manage/questions', { title });
  await call('patch', `/api/manage/questions/${id}`, {
    slug,
    statement: 'Read two integers and print their sum.',
    practice,
    samples: [{ input: '1 2\n', output: '3\n' }],
  });
  await call('post', `/api/manage/questions/${id}/tests`, { tests: [{ input: '1 2\n', expectedOutput: '3\n' }] });
  await call('post', `/api/manage/questions/${id}/publish`, { acknowledgeValidation: true });
  return id;
}

const FIRST = { title: `Zen first ${stamp}`, slug: `e2e-zen-first-${stamp}` };
const SECOND = { title: `Zen second ${stamp}`, slug: `e2e-zen-second-${stamp}` };

let admin: APIRequestContext;
let call: Call;

test.beforeAll(async () => {
  ({ api: admin, call } = await adminApi());
  await sumQuestion(call, FIRST.title, FIRST.slug, true);
  await sumQuestion(call, SECOND.title, SECOND.slug, true);
});

test.afterAll(async () => {
  await admin?.dispose();
});

test('zen mode and editor settings apply live and persist', async ({ page }) => {
  await register(page, `e2ezen${stamp % 1_000_000}`);
  await page.goto(`/practice/${FIRST.slug}`);
  await expect(statement(page, FIRST.title)).toBeVisible();
  await expect(editor(page)).toBeVisible();

  await test.step('zen hides the header, statement and run panels, and restores them', async () => {
    await page.getByRole('button', { name: /^Zen mode/ }).click();
    await expect(zenBar(page)).toBeVisible();
    await expect(statement(page, FIRST.title)).toHaveCount(0);
    await expect(bottomTabs(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Practice' })).toBeHidden();
    await expect(editor(page)).toBeVisible();
    await expect(zenBar(page).getByRole('combobox', { name: 'Language' })).toBeVisible();
    for (const name of [/^Run/, /^Submit/, /Exit zen/]) await expect(zenBar(page).getByRole('button', { name })).toBeVisible();

    await zenBar(page).getByRole('button', { name: /Exit zen/ }).click();
    await expect(zenBar(page)).toHaveCount(0);
    await expect(statement(page, FIRST.title)).toBeVisible();
    await expect(bottomTabs(page)).toBeVisible();
  });

  await test.step('the statement is one keystroke away in zen, and Esc closes it then leaves zen', async () => {
    await editor(page).click();
    await page.keyboard.press('Alt+Z');
    await expect(zenBar(page)).toBeVisible();
    await page.keyboard.press('Alt+P');
    const sheet = page.getByRole('dialog', { name: 'Problem statement' });
    await expect(sheet.getByRole('article').getByRole('heading', { name: FIRST.title })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(zenBar(page)).toBeVisible(); // the first Esc only closed the sheet
    await zenBar(page).getByRole('combobox', { name: 'Language' }).focus();
    await page.keyboard.press('Escape');
    await expect(zenBar(page)).toHaveCount(0);
    await expect(statement(page, FIRST.title)).toBeVisible();
  });

  await test.step('zen is remembered across a reload and on the next question', async () => {
    await page.keyboard.press('Alt+Z');
    await expect(zenBar(page)).toBeVisible();
    await page.reload();
    await expect(zenBar(page)).toBeVisible();
    await page.goto(`/practice/${SECOND.slug}`);
    await expect(zenBar(page)).toBeVisible();
    await expect(statement(page, SECOND.title)).toHaveCount(0);
  });

  await test.step('Run works in zen and shows its result over the editor', async () => {
    await zenBar(page).getByRole('combobox', { name: 'Language' }).selectOption('python');
    await clearEditor(page);
    // Inserted in one go: typed key by key, Monaco would auto-close the brackets.
    await page.keyboard.insertText('a, b = map(int, input().split())\nprint(a + b)\n');
    await page.keyboard.press('ControlOrMeta+Enter');
    const sheet = page.getByRole('dialog', { name: 'Runs and submissions' });
    await expect(sheet.getByRole('tab', { name: 'Example results', selected: true })).toBeVisible();
    await expect(sheet.getByText('Every example passes.')).toBeVisible({ timeout: 90_000 });
    await sheet.getByRole('button', { name: 'Close (Esc)' }).click();
    await page.keyboard.press('Alt+Z');
    await expect(zenBar(page)).toHaveCount(0);
  });

  await test.step('tab width, theme and Vim apply live without losing the text', async () => {
    await clearEditor(page);
    await page.keyboard.type('x = 1');
    await page.getByRole('button', { name: 'Editor settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Editor settings' });
    await settings.getByText('2 spaces').click();
    await settings.getByLabel('Editor theme').selectOption('dracula');
    await settings.getByText('Vim', { exact: true }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('status', { name: 'Vim status' })).toContainText('NORMAL');
    await expect(editor(page)).toHaveCSS('background-color', 'rgb(40, 42, 54)');
    expect(await firstLine(page)).toBe('x = 1');

    // The undo history from before the changes survived: Vim's u undoes the typing, Ctrl+R brings it back.
    await editor(page).click();
    await page.keyboard.press('Escape');
    await page.keyboard.type('u');
    await expect.poll(() => firstLine(page)).not.toBe('x = 1');
    await page.keyboard.press('Control+R');
    await expect.poll(() => firstLine(page)).toBe('x = 1');

    // Vim editing: open a line below, indent with Tab (2 spaces now), back to normal mode.
    await editor(page).click();
    await page.keyboard.press('Escape');
    await page.keyboard.type('o');
    await page.keyboard.press('Tab');
    await page.keyboard.type('y');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status', { name: 'Vim status' })).toContainText('NORMAL');
    expect((await page.locator('.monaco-editor .view-line').nth(1).textContent())?.replace(/\u00a0/g, ' ')).toBe('  y');
  });

  await test.step('Vim does not swallow the workspace shortcuts', async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+Z');
    await expect(zenBar(page)).toBeVisible();
    // Esc inside the editor belongs to Vim and must not leave zen.
    await editor(page).click();
    await page.keyboard.type('i');
    await expect(page.getByRole('status', { name: 'Vim status' })).toContainText('INSERT');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status', { name: 'Vim status' })).toContainText('NORMAL');
    await expect(zenBar(page)).toBeVisible();
    await page.keyboard.press('Alt+P');
    await expect(page.getByRole('dialog', { name: 'Problem statement' })).toBeVisible();
    await page.keyboard.press('Alt+P');
    await expect(page.getByRole('dialog', { name: 'Problem statement' })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('dialog', { name: 'Runs and submissions' })).toBeVisible();
    await page.keyboard.press('Alt+Z');
    await expect(zenBar(page)).toHaveCount(0);
  });

  await test.step('settings persist across a reload', async () => {
    await page.reload();
    await expect(page.getByRole('status', { name: 'Vim status' })).toContainText('NORMAL');
    await expect(editor(page)).toHaveCSS('background-color', 'rgb(40, 42, 54)');
    await page.getByRole('button', { name: 'Editor settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Editor settings' });
    await expect(settings.getByRole('radio', { name: '2 spaces' })).toBeChecked();
    await expect(settings.getByRole('radio', { name: 'Vim' })).toBeChecked();
    await expect(settings.getByLabel('Editor theme')).toHaveValue('dracula');
    // Back to the defaults: the Vim status line goes away.
    await settings.getByText('Default', { exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status', { name: 'Vim status' })).toHaveCount(0);
  });

  await test.step('fullscreen follows the browser, however it is left', async () => {
    const toggle = page.getByRole('button', { name: /^(Exit fullscreen|Fullscreen)/ });
    if ((await toggle.count()) === 0) return; // Fullscreen API unavailable here.
    await toggle.click();
    // A headless browser may refuse; either way the button must match the document.
    const active = await page.evaluate(() => document.fullscreenElement != null);
    await expect(toggle).toHaveAttribute('aria-pressed', String(active));
    if (!active) return;
    // Esc (or the browser UI) leaves fullscreen without our button; the UI follows.
    await page.evaluate(() => document.exitFullscreen());
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleName(/^Fullscreen/);
  });
});

test('the contest timer hides, reveals and is forced into view in the last minute', async ({ page, context }) => {
  // A live contest with no autocomplete and integrity recording, ending soon
  // enough to reach the last minute within the test.
  const endsAt = Date.now() + 105_000;
  const { id: contestId } = await call('post', '/api/manage/contests');
  await call('patch', `/api/manage/contests/${contestId}`, {
    name: `E2E timer ${stamp}`,
    timingMode: 'fixed_window',
    visibility: 'public',
    autocomplete: 'off',
    recordIntegrity: true,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    endsAt: new Date(endsAt).toISOString(),
  });
  const ids = [await sumQuestion(call, `Timer A ${stamp}`, `e2e-timer-a-${stamp}`, false), await sumQuestion(call, `Timer B ${stamp}`, `e2e-timer-b-${stamp}`, false)];
  await call('put', `/api/manage/contests/${contestId}/questions`, { items: ids.map((questionId) => ({ questionId, points: null, durationMinutes: null })) });
  await call('post', `/api/manage/contests/${contestId}/publish`);

  await register(page, `e2etm${stamp % 1_000_000}`);
  await page.goto(`/contests/${contestId}`);
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByRole('button', { name: 'Start contest' }).click();
  await page.getByRole('button', { name: 'Open question A' }).click();
  await expect(statement(page, `Timer A ${stamp}`)).toBeVisible();

  const clock = page.locator('[data-clock-state]');

  await test.step('hidden by default, revealed on hover, pinned by click and by keyboard', async () => {
    await expect(clock).toHaveAttribute('data-clock-state', 'hidden');
    await expect(clock).toHaveAccessibleName('Time left in the contest: hidden');
    await expect(clock).not.toContainText(/\d\d:\d\d/);
    await clock.hover();
    await expect(clock).toHaveAttribute('data-clock-state', 'shown');
    await expect(clock).toContainText(/\d\d:\d\d/);
    await page.mouse.move(5, 500);
    await expect(clock).toHaveAttribute('data-clock-state', 'hidden');

    await clock.click();
    await expect(clock).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(5, 500);
    await expect(clock).toHaveAttribute('data-clock-state', 'shown');
    await clock.click();
    await page.mouse.move(5, 500);
    await expect(clock).toHaveAttribute('data-clock-state', 'hidden');

    await clock.focus();
    await page.keyboard.press('Enter');
    await expect(clock).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Space');
    await expect(clock).toHaveAttribute('aria-pressed', 'false');
  });

  await test.step('zen keeps the clock reachable, the contest rules, and paste tracking', async () => {
    await page.mouse.move(5, 500);
    await editor(page).click();
    await page.keyboard.press('Alt+Z');
    await expect(zenBar(page)).toBeVisible();
    await expect(zenBar(page).locator('[data-clock-state]')).toHaveAttribute('data-clock-state', 'hidden');

    // Autocomplete stays off by contest rule.
    await zenBar(page).getByRole('combobox', { name: 'Language' }).selectOption('python');
    await clearEditor(page);
    await page.keyboard.type('zebracorn = 1\nzebr', { delay: 20 });
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(800);
    await expect(page.locator('.monaco-editor .suggest-widget.visible .monaco-list-row')).toHaveCount(0);

    // Pastes are still recorded for the organizer.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('print(42)'));
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+V');
    const me = await (await page.request.get('/api/auth/me')).json();
    await expect
      .poll(
        async () => {
          const { events } = await call('get', `/api/manage/contests/${contestId}/integrity?userId=${me.user.id}`);
          return events.filter((e: { type: string; chars: number | null }) => e.type === 'paste' && e.chars === 9).length;
        },
        { timeout: 20_000 },
      )
      .toBe(1);
  });

  await test.step('switching questions from zen keeps zen (and fullscreen when the browser allows it)', async () => {
    const fullscreen = zenBar(page).getByRole('button', { name: /^(Exit fullscreen|Fullscreen)/ });
    if ((await fullscreen.count()) > 0) await fullscreen.click();
    const wasFullscreen = await page.evaluate(() => document.fullscreenElement != null);
    await page.keyboard.press('Alt+P');
    const sheet = page.getByRole('dialog', { name: 'Problem statement' });
    await sheet.getByRole('button', { name: /^Question B:/ }).click();
    await expect(page).toHaveURL(new RegExp(`/contests/${contestId}/q/B$`));
    await expect(zenBar(page)).toBeVisible();
    expect(await page.evaluate(() => document.fullscreenElement != null)).toBe(wasFullscreen);
    if (wasFullscreen) await page.evaluate(() => document.exitFullscreen());
  });

  await test.step('the last minute forces the clock into view', async () => {
    const zenClock = zenBar(page).locator('[data-clock-state]');
    await expect(zenClock).toHaveAttribute('data-clock-state', 'hidden');
    const untilCritical = endsAt - 60_000 - Date.now();
    expect(untilCritical, 'the steps above took too long to see the clock hidden before the last minute').toBeGreaterThan(0);
    await expect(zenClock).toHaveAttribute('data-clock-state', 'forced', { timeout: untilCritical + 15_000 });
    await expect(zenClock).toContainText(/00:[0-5]\d/);
    await expect(zenClock).toHaveAccessibleName(/Time left in the contest: 00:[0-5]\d left/);
    await expect(page.locator('.fuse[data-level="critical"]')).toBeVisible();
    // Pinning and unpinning can't hide it now.
    await zenClock.click();
    await zenClock.click();
    await page.mouse.move(5, 500);
    await expect(zenClock).toHaveAttribute('data-clock-state', 'forced');
  });
});
