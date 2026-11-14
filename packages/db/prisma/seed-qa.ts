// QA seed (R1; Rasel's card "Approve seed", Oct 29): `pnpm db:seed:qa`. Synthetic fixtures for
// Octavia's Oct 28 reviews in LVP and Test Firm B, rows only, nothing sendable (seed-qa-data.ts),
// then part 2 for LVP and the Super Admin (seed-qa-extra.ts), part 3 (automation logs) and part 4
// (Test Firm B's upcoming appointments, seed-qa-appointments.ts) and part 5 (Test Firm B's tax
// season, seed-qa-season.ts).
// Safe to run again: a firm already seeded is skipped. On dev it runs once as a one-off task
// (scripts/seed-qa-task.mjs), on Rasel's card.
import { config } from 'dotenv';
import { createPrismaClient } from '../src/client.js';
import { seedQa } from './seed-qa-data.js';
import { seedQaExtra } from './seed-qa-extra.js';
import { seedQaAppointments } from './seed-qa-appointments.js';
import { seedQaRuns } from './seed-qa-runs.js';
import { seedQaSeason } from './seed-qa-season.js';

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
  const extra = await seedQaExtra(prisma);
  console.warn(`QA part 2: LVP ${extra.lvp}, platform ${extra.platform}`);
  console.warn(`QA part 3 (automation logs): LVP ${await seedQaRuns(prisma)}`);
  console.warn(`QA part 4 (appointments): Test Firm B ${await seedQaAppointments(prisma)}`);
  console.warn(`QA part 5 (tax season): Test Firm B ${await seedQaSeason(prisma)}`);
  if (extra.documentKey)
    console.warn(`Upload qaFixturePdf() to the documents bucket at: ${extra.documentKey}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
