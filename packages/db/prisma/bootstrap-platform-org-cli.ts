// `pnpm db:bootstrap-platform-org` (and the dev task, scripts/bootstrap-platform-org-task.mjs):
// seeds the plan ladder and the department/role catalog, and maps every existing SUPER_ADMIN to
// a CEO-level platform_members row. Safe to run again. Prints the mapped admins' emails so the
// output can be checked against who Rasel expects, before anyone relies on the mapping.
import { config } from 'dotenv';
import { createPrismaClient } from '../src/client.js';
import { bootstrapPlatformOrg } from './bootstrap-platform-org.js';

config({ path: '../../.env', quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
const prisma = createPrismaClient(url, {
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
});

async function main() {
  const mapped = await bootstrapPlatformOrg(prisma);
  console.warn('Seeded the plan ladder and the department/role catalog.');
  if (mapped.length === 0) {
    console.warn('No SUPER_ADMIN platform_admins row exists yet: nothing to map to CEO.');
  } else {
    console.warn(`Mapped ${mapped.length} SUPER_ADMIN(s) to CEO:`);
    for (const admin of mapped) console.warn(`  ${admin.email} (${admin.userId})`);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
