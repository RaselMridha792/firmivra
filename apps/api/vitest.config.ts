import { config } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  // SWC keeps decorator metadata, which NestJS dependency injection needs.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    // Endpoint suites share one isolated database and install test-only DDL fixtures.
    // Serialize files; concurrent requests inside each suite still test database locks.
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
