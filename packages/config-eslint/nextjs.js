// apps/web: React rules plus Next.js rules.
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';
import react from './react.js';

export default defineConfig(react, nextPlugin.configs['core-web-vitals'], {
  // App Router only; this rule looks for a pages/ directory.
  rules: { '@next/next/no-html-link-for-pages': 'off' },
});
