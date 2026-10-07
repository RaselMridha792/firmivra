import nextjs from '@firmivra/config-eslint/nextjs';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

// A call in a mock file's top level runs when the file is imported, so the production bundle
// keeps it (and its fixtures) even though mock mode is off there. Build fixtures on first use.
const call = ':matches(CallExpression, NewExpression)';
// Directly, or inside the array or object it builds (also behind `as const` or `satisfies`).
const value = ['', 'TSAsExpression > ', 'TSSatisfiesExpression > '].flatMap((cast) => [
  `${cast}${call}`,
  `${cast}ArrayExpression > ${call}`,
  `${cast}ObjectExpression > Property > ${call}`,
]);
const declared = [
  'Program > VariableDeclaration',
  'Program > ExportNamedDeclaration > VariableDeclaration',
].flatMap((declaration) => value.map((v) => `${declaration} > VariableDeclarator > ${v}`));
const message =
  'Mocks run nothing on import: build fixtures inside a function on first use (see mocks/firm-applications.ts).';
const mockRules = [`Program > ExpressionStatement ${call}`, ...declared].map((selector) => ({
  selector,
  message,
}));

export default defineConfig(
  nextjs,
  {
    // Node code next to the app: the launcher script, config files and Playwright tests.
    files: ['scripts/**', '*.config.*', 'e2e/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/mocks/**'],
    rules: {
      'no-restricted-syntax': ['error', ...mockRules],
    },
  },
);
