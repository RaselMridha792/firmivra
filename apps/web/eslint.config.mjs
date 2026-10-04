import nextjs from '@firmivra/config-eslint/nextjs';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig(nextjs, {
  // Node code next to the app: the launcher script, config files and Playwright tests.
  files: ['scripts/**', '*.config.*', 'e2e/**'],
  languageOptions: { globals: { ...globals.node } },
});
