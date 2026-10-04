// React code: packages/ui, and the base for apps/web.
import eslintReact from '@eslint-react/eslint-plugin';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import base from './base.js';

export default defineConfig(base, {
  files: ['**/*.{ts,tsx,js,jsx}'],
  extends: [eslintReact.configs['recommended-typescript'], reactHooks.configs.flat.recommended],
  languageOptions: { globals: { ...globals.browser } },
});
