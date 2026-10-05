import type { TestProject } from 'vitest/node';
import { prepareTestDatabase } from '../src/testing.js';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrls: { owner: string; app: string };
  }
}

export default async function setup(project: TestProject) {
  project.provide('dbUrls', await prepareTestDatabase());
}
