// Demo seed (R0, PART 2): `pnpm db:seed:demo`. Builds the `demo` business with believable,
// synthetic data on every module whose tables exist, so every screen can be shown live. Never
// touches LVP or Test Firm B. One module per file (seed-demo-*.ts), in the style of seed-r36 to
// seed-r39, so later stages add a file and a call here without conflicting with this one. Safe to
// run again: every row is keyed by a deterministic id (demoId) or a natural unique key.
// Coverage map: docs/work/R0-demo-coverage.md.
import { config } from 'dotenv';
import { createPrismaClient } from '../src/client.js';
import { seedDemo } from './seed-demo-all.js';

config({ path: '../../.env', quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
const prisma = createPrismaClient(url, {
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
});

async function main() {
  const org = await seedDemo(prisma);

  console.warn(
    `Seeded the demo firm: ${org.businessId}, owner + 6 staff across 3 departments, ${Object.keys(org.clients).length} clients (1 with a portal login), with client work (engagements, tasks, invoices, appointments, documents, messages), leads, Firm Sign, sign-ups, notifications, and 8 more firms for the Super Admin.`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
