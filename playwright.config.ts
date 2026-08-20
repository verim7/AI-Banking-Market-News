import { defineConfig } from '@playwright/test';

/**
 * The smoke test drives the real Worker against a real local D1 — not mocks —
 * so it exercises auth, scoping, filtering and export the same way a browser
 * will in production.
 *
 * Prepare the database first (see e2e/README.md), then:
 *   npx wrangler dev --port 8787 &
 *   npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  // One worker, in order: these tests share a single local D1, so running them
  // in parallel would have them fight over the same rows.
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8787',
    headless: true,
    screenshot: 'only-on-failure',
    // Honour a preinstalled browser when the environment provides one, rather
    // than downloading a second copy. CI sets nothing and uses the default.
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  reporter: [['list']],
});
