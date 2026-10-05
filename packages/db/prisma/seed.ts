// Seeds the local database: a Super Admin, LVP Accounting & Taxes (owner, staff, client) and
// Test Firm B for isolation checks. Safe to run again. Runs as the owner role, inside the same
// scopes the app uses, so it also works where the owner is not a superuser.
import { config } from 'dotenv';
import { createPrismaClient, runInScope } from '../src/client.js';
import { SEED_BUSINESSES, SEED_USERS } from './seed-data.js';

config({ path: '../../.env', quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
const prisma = createPrismaClient(url);

async function main() {
  const businesses = await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    for (const u of Object.values(SEED_USERS)) {
      await tx.user.upsert({
        where: { id: u.id },
        update: { email: u.email, name: u.name, pool: u.pool },
        create: { id: u.id, cognitoSub: u.id, pool: u.pool, email: u.email, name: u.name },
      });
    }
    await tx.platformAdmin.upsert({
      where: { userId: SEED_USERS.superAdmin.id },
      update: {},
      create: { userId: SEED_USERS.superAdmin.id, role: 'SUPER_ADMIN' },
    });
    const result: Record<keyof typeof SEED_BUSINESSES, string> = { lvp: '', testFirmB: '' };
    for (const [key, b] of Object.entries(SEED_BUSINESSES) as [
      keyof typeof SEED_BUSINESSES,
      (typeof SEED_BUSINESSES)[keyof typeof SEED_BUSINESSES],
    ][]) {
      const row = await tx.business.upsert({
        where: { slug: b.slug },
        update: { name: b.name, status: b.status },
        create: { slug: b.slug, name: b.name, status: b.status },
      });
      result[key] = row.id;
    }
    return result;
  });

  await runInScope(prisma, { kind: 'business', businessId: businesses.lvp }, async (tx) => {
    for (const [user, role] of [
      [SEED_USERS.lvpOwner, 'OWNER'],
      [SEED_USERS.lvpStaff, 'STAFF'],
    ] as const) {
      await tx.membership.upsert({
        where: { businessId_userId: { businessId: businesses.lvp, userId: user.id } },
        update: { role, status: 'ACTIVE' },
        create: { businessId: businesses.lvp, userId: user.id, role, status: 'ACTIVE' },
      });
    }
    await tx.clientAccount.upsert({
      where: { userId: SEED_USERS.lvpClient.id },
      update: { status: 'ACTIVE' },
      create: {
        businessId: businesses.lvp,
        userId: SEED_USERS.lvpClient.id,
        email: SEED_USERS.lvpClient.email,
        status: 'ACTIVE',
      },
    });
  });

  await runInScope(prisma, { kind: 'business', businessId: businesses.testFirmB }, async (tx) => {
    await tx.membership.upsert({
      where: {
        businessId_userId: { businessId: businesses.testFirmB, userId: SEED_USERS.firmBOwner.id },
      },
      update: { role: 'OWNER', status: 'ACTIVE' },
      create: {
        businessId: businesses.testFirmB,
        userId: SEED_USERS.firmBOwner.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    await tx.clientAccount.upsert({
      where: { userId: SEED_USERS.firmBClient.id },
      update: { status: 'ACTIVE' },
      create: {
        businessId: businesses.testFirmB,
        userId: SEED_USERS.firmBClient.id,
        email: SEED_USERS.firmBClient.email,
        status: 'ACTIVE',
      },
    });
  });

  console.warn(
    `Seeded: Super Admin, ${SEED_BUSINESSES.lvp.name} (owner, staff, client), ${SEED_BUSINESSES.testFirmB.name} (owner, client).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
