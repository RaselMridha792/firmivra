// apps/api. Type-aware promise rules catch un-awaited calls in services and guards.
import { defineConfig } from 'eslint/config';
import node from './node.js';

export default defineConfig(node, {
  files: ['**/*.ts'],
  languageOptions: { parserOptions: { projectService: true } },
  rules: {
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
  },
});
