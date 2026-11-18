import { defineConfig, devices } from '@playwright/test';

/**
 * Live checks: the real dev site, real API and database, signed in as Test Firm B's harness logins.
 * No web server: baseURL is dev. Credentials and folders come only from the environment (see
 * e2e/live/env.ts); nothing secret is in this repo. Session state, screenshots and results go to
 * folders outside the repo (LIVE_STATE_DIR, LIVE_SHOTS_DIR, LIVE_OUT_DIR).
 *
 * Two widths, as Octavia reviews: every spec runs at 1165 px; tests tagged @narrow also run at
 * 390 px. The setup project signs each role in once per run (or reuses a live session).
 */
const root = process.env['LIVE_OUT_DIR'];
if (!root) throw new Error('LIVE_OUT_DIR is not set (a folder outside the repo)');
// Each run its own folder: Playwright empties outputDir at the start of a run, and tabs run in
// parallel.
const out = `${root}/${process.env['LIVE_RUN'] ?? `run-${Date.now()}-${process.pid}`}`;

export default defineConfig({
  testDir: 'e2e/live',
  outputDir: `${out}/results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: `${out}/results.json` }]],
  // No traces: they would hold request bodies (sign-in) and session cookies.
  use: { trace: 'off', screenshot: 'only-on-failure', video: 'off', actionTimeout: 20_000 },
  projects: [
    // Never a screenshot of a sign-in or MFA screen, not even on failure.
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { screenshot: 'off' } },
    {
      name: 'w1165',
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1165, height: 900 } },
    },
    {
      name: 'w390',
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
      grep: /@narrow/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: false,
        hasTouch: true,
      },
    },
  ],
});
