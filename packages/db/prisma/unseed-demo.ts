// `pnpm db:unseed:demo`: removes exactly what the demo seed created, and nothing else. Never
// touches LVP or Test Firm B: it only ever acts on the business whose slug is `demo`, found by
// that slug, and the synthetic users this seed itself created (seed-demo-data.ts's ids).
// Runs as the owner role (app_delete_business_data is owner/migrate only, r0_demo_unseed).
import { config } from 'dotenv';
import { createPrismaClient } from '../src/client.js';
import { SEED_DEMO_BUSINESS } from './seed-demo-data.js';
import { unseedDemoOrg } from './unseed-demo-org.js';

config({ path: '../../.env', quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
const prisma = createPrismaClient(url, {
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
});

async function main() {
  const result = await unseedDemoOrg(prisma);
  if (!result) {
    console.warn(`No "${SEED_DEMO_BUSINESS.slug}" business: nothing to unseed.`);
    return;
  }

  const lines = result.tables
    .map((r) => `${r.table_name} (${r.deleted})`)
    .sort()
    .join(', ');
  console.warn(
    `Unseeded the demo firm ${result.businessId}: ${lines}, users (${result.deletedUsers}).`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
