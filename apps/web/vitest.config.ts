import { defineConfig } from 'vitest/config';

// Unit tests for server-side helpers (src/**/*.test.ts). The browser tests are Playwright's
// (e2e/, their own configs). A CI shard can get none of these files, hence passWithNoTests.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true },
});
