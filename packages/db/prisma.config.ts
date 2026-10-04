import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Scripts run from packages/db; the shared .env lives at the repo root. CI sets real env vars instead.
config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Owner role: migrations and seed only. The API uses DATABASE_URL_APP.
    url: process.env['DATABASE_URL'],
  },
});
