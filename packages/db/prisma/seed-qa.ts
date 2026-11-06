// QA seed (R1; Rasel's card "Approve seed", Oct 29): `pnpm db:seed:qa`. Synthetic fixtures for
// Octavia's Oct 28 reviews in LVP and Test Firm B, rows only, nothing sendable (seed-qa-data.ts).
// Safe to run again: a firm already seeded is skipped. On dev it runs once as a one-off task
// (scripts/seed-qa-task.mjs), on Rasel's card.
import { config } from 'dotenv';
import { createPrismaClient } from '../src/client.js';
import { seedQa } from './seed-qa-data.js';

config({ path: '../../.env', quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
const prisma = createPrismaClient(url, {
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
});

async function main() {
  const { seeded, missing } = await seedQa(prisma);
  console.warn(`QA fixtures in: ${seeded.join(', ') || 'none'}`);
  if (missing.length) console.warn(`Firms not found (not created): ${missing.join(', ')}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
