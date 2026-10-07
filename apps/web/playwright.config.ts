import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '../../.env', quiet: true });

const webPort = process.env['WEB_PORT'] ?? '3000';
const apiPort = process.env['API_PORT'] ?? '4000';

/**
 * Smoke tests per site and local sign-in end to end. Needs Docker services running and the
 * database seeded (pnpm db:migrate && pnpm db:seed). Starts the API and web dev servers itself,
 * or reuses ones already running.
 */
export default defineConfig({
  testDir: 'e2e',
  // Mock-mode tests run with their own config and server (playwright.mock.config.ts).
  testIgnore: 'mock/**',
  fullyParallel: false,
  // The dev server compiles each page on its first visit, which can take several seconds;
  // specs that open many pages set a longer test timeout themselves.
  expect: { timeout: 15_000 },
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @firmivra/api dev',
      url: `http://localhost:${apiPort}/api/v1/health`,
      cwd: '../..',
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
    {
      command: 'pnpm --filter @firmivra/web dev',
      url: `http://localhost:${webPort}/healthz`,
      cwd: '../..',
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
  ],
});
