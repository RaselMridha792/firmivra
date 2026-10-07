import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '../../.env', quiet: true });

// One port above WEB_PORT, so it never meets a running `pnpm dev`.
const mockPort = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

/**
 * Screens in mock mode (NEXT_PUBLIC_API_MOCK=all): no API, no database, no sign-in. Starts its own
 * web dev server with mock data on WEB_PORT + 1, building into .next/mock. Tests in e2e/mock/.
 */
export default defineConfig({
  testDir: 'e2e/mock',
  fullyParallel: false,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @firmivra/web dev',
    url: `http://localhost:${mockPort}/healthz`,
    cwd: '../..',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      WEB_PORT: mockPort,
      NEXT_DIST_DIR: '.next/mock',
      NEXT_PUBLIC_API_MOCK: 'all',
      NEXT_PUBLIC_API_MOCK_ROLE: 'OWNER',
    },
  },
});
