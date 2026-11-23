import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '../../.env', quiet: true });

// One port above WEB_PORT, so it never meets a running `pnpm dev`.
const mockPort = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const httpsMockEnabled = process.env['MOCK_HTTPS'] === '1';

const httpMockServer = {
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
    // Appointments D3 and Q45 intake: the test site may frame public booking and intake pages.
    EMBED_ALLOWED_ORIGINS: 'https://site.example.test',
  },
};

const httpsMockServer = {
  command: 'pnpm --filter @firmivra/web dev --experimental-https',
  url: `https://localhost:${Number(mockPort) + 1}/healthz`,
  reuseExistingServer: false,
  timeout: 180_000,
  ignoreHTTPSErrors: true,
  cwd: '../..',
  env: {
    WEB_PORT: String(Number(mockPort) + 1),
    NEXT_DIST_DIR: '.next/mock-https',
    NEXT_PUBLIC_API_MOCK: 'all',
    NEXT_PUBLIC_API_MOCK_ROLE: 'OWNER',
    NEXT_PUBLIC_API_MOCK_CLIENT: 'SIGNED_OUT',
    EMBED_ALLOWED_ORIGINS: `https://site.example.test,https://portal.localhost:${Number(mockPort) + 1}`,
  },
};

/**
 * Screens in mock mode (NEXT_PUBLIC_API_MOCK=all): no API, no database, no sign-in. Starts the
 * HTTP mock server at WEB_PORT + 1. Set MOCK_HTTPS=1 to also start the HTTPS server at +2 for
 * public embed browser specs; both use isolated .next directories.
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
  webServer: httpsMockEnabled ? [httpMockServer, httpsMockServer] : httpMockServer,
});
