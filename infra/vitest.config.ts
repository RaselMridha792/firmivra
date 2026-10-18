import { defineConfig } from 'vitest/config';

export default defineConfig({
  // passWithNoTests: CI runs four shards and infra has two test files, so some shards get none.
  test: { include: ['test/**/*.test.ts'], testTimeout: 120_000, passWithNoTests: true },
});
