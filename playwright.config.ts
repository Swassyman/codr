import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running Codr (docker compose up, or npm run dev
 * with a built SPA). They need the seeded sample questions and a ready runner.
 *
 *   E2E_BASE_URL=http://localhost:3000 npx playwright test
 *
 * Browsers: `npx playwright install chromium`, or point CHROME_PATH at a local
 * Chrome/Chromium binary.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
