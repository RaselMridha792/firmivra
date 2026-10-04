// Root files only. ESLint 10 uses the nearest eslint.config.mjs, so each package keeps its own.
import node from '@firmivra/config-eslint/node';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(globalIgnores(['docs/', 'Firmivra-Documents-2026-10-04/']), node);
