import { config } from 'dotenv';
import { defineConfig } from 'vitest/config';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
