import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT ?? '3000';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // The core loop is a sequence — sign up, then act as that user. Running
  // files in parallel against one database makes failures hard to read.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        // **A fresh server every run, including locally.** Playwright documents
        // `!process.env.CI` as the idiom, and this departs from it deliberately:
        // with reuse enabled, an orphaned server left by an interrupted run is
        // adopted silently, so a run can exercise stale code while reporting
        // success. That was observed rather than theorised. `false` makes
        // Playwright throw when something is already listening, which turns a
        // silent problem into a visible one.
        //
        // **The workflow the idiom protects is still available, deliberately.**
        // Setting `PLAYWRIGHT_BASE_URL` skips this block entirely and runs
        // against a server you started yourself.
        //
        // CI is unaffected: `!process.env.CI` was already `false` there.
        // See `architecture.md` §12.
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
