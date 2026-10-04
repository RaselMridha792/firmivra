import node from '@firmivra/config-eslint/node';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(globalIgnores(['src/generated/']), node);
