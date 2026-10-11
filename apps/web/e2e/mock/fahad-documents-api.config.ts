import base from '../../playwright.mock.config';
import { defineConfig } from '@playwright/test';

const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error('Expected one mock web server');

// Exercise the real documents client against synthetic transport responses.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'fahad-documents-api.checks.ts',
  workers: 1,
  webServer: {
    ...server,
    env: {
      ...server.env,
      NEXT_PUBLIC_API_MOCK: 'me,engagements,esign',
      NEXT_DIST_DIR: '.next/documents-api',
    },
  },
});
