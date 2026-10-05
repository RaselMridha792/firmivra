// Seeds the local database: a Super Admin, LVP Accounting & Taxes (owner, staff, invited staff, client) and
// Test Firm B for isolation checks. Safe to run again. Runs as the owner role, inside the same
// scopes the app uses, so it also works where the owner is not a superuser.
import { createHash, randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import {
  SEED_BUSINESSES,
  SEED_CLIENT_IDS,
  SEED_INVITE_ID,
  SEED_TAX_STATUSES,
  SEED_USERS,
} from './seed-data.js';

config({ path: '../../.env', quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');
const prisma = createPrismaClient(url);

/** Settings, Terms and Privacy v1 and tax statuses for one firm (business scope). */
async function seedFirmBasics(
  tx: TxClient,
  businessId: string,
  firm: {
    name: string;
    ownerId: string;
    contactEmail: string;
    brandColor?: string;
    taxStatuses: readonly string[];
  },
) {
  await tx.businessSettings.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      contactEmail: firm.contactEmail,
      brandColor: firm.brandColor ?? null,
      setupCompletedAt: new Date(),
    },
  });
  for (const [kind, title] of [
    ['TERMS', 'Terms of Service'],
    ['PRIVACY', 'Privacy Policy'],
  ] as const) {
    await tx.firmLegalDocument.upsert({
      where: { businessId_kind_version: { businessId, kind, version: 1 } },
      update: {},
      create: {
        businessId,
        kind,
        version: 1,
        body: `# ${firm.name}: ${title}\n\nSample text for local development. Not legal text.`,
        publishedByUserId: firm.ownerId,
      },
    });
  }
  for (const [sortOrder, name] of firm.taxStatuses.entries()) {
    await tx.taxStatus.upsert({
      where: { businessId_name: { businessId, name } },
      update: { sortOrder },
      create: { businessId, name, sortOrder },
    });
  }
}

/** The firm's client record and profile for a seeded client login, linked to that login. */
async function seedClient(
  tx: TxClient,
  businessId: string,
  clientId: string,
  user: { id: string; email: string; name: string },
  assignedUserId: string,
) {
  const [firstName, lastName] = user.name.split(' ');
  await tx.client.upsert({
    where: { id: clientId },
    update: {},
    create: { id: clientId, businessId, displayName: user.name, email: user.email, assignedUserId },
  });
  await tx.clientProfile.upsert({
    where: { clientId },
    update: {},
    create: { clientId, businessId, firstName: firstName ?? null, lastName: lastName ?? null },
  });
  await tx.clientAccount.update({ where: { userId: user.id }, data: { clientId } });
}

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
    await seedFirmBasics(tx, businesses.lvp, {
      name: SEED_BUSINESSES.lvp.name,
      ownerId: SEED_USERS.lvpOwner.id,
      contactEmail: 'hello@lvp.test',
      brandColor: '#1f4e79',
      taxStatuses: SEED_TAX_STATUSES.lvp,
    });

    // A staff member invited but not yet active, with one open invite.
    const invited = await tx.membership.upsert({
      where: {
        businessId_userId: { businessId: businesses.lvp, userId: SEED_USERS.lvpInvited.id },
      },
      update: {},
      create: {
        businessId: businesses.lvp,
        userId: SEED_USERS.lvpInvited.id,
        role: 'STAFF',
        status: 'INVITED',
      },
    });
    await tx.invite.upsert({
      where: { id: SEED_INVITE_ID },
      update: {},
      create: {
        id: SEED_INVITE_ID,
        businessId: businesses.lvp,
        membershipId: invited.id,
        // Random and never printed: the invite shows in the team list, but its link cannot be used.
        tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        expiresAt: new Date(Date.now() + 6 * 86_400_000),
        invitedByUserId: SEED_USERS.lvpOwner.id,
      },
    });

    await seedClient(
      tx,
      businesses.lvp,
      SEED_CLIENT_IDS.lvp,
      SEED_USERS.lvpClient,
      SEED_USERS.lvpStaff.id,
    );
    const inPreparation = await tx.taxStatus.findUniqueOrThrow({
      where: { businessId_name: { businessId: businesses.lvp, name: 'In preparation' } },
    });
    await tx.clientTaxStatus.upsert({
      where: {
        businessId_clientId_taxYear: {
          businessId: businesses.lvp,
          clientId: SEED_CLIENT_IDS.lvp,
          taxYear: 2025,
        },
      },
      update: {},
      create: {
        businessId: businesses.lvp,
        clientId: SEED_CLIENT_IDS.lvp,
        taxYear: 2025,
        taxStatusId: inPreparation.id,
        clientNote: 'We have your documents and are preparing your return.',
        updatedByUserId: SEED_USERS.lvpStaff.id,
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
    await seedFirmBasics(tx, businesses.testFirmB, {
      name: SEED_BUSINESSES.testFirmB.name,
      ownerId: SEED_USERS.firmBOwner.id,
      contactEmail: 'hello@firm-b.test',
      taxStatuses: SEED_TAX_STATUSES.testFirmB,
    });
    await seedClient(
      tx,
      businesses.testFirmB,
      SEED_CLIENT_IDS.testFirmB,
      SEED_USERS.firmBClient,
      SEED_USERS.firmBOwner.id,
    );
  });

  console.warn(
    `Seeded: Super Admin, ${SEED_BUSINESSES.lvp.name} (owner, staff, invited staff, client), ${SEED_BUSINESSES.testFirmB.name} (owner, client), with settings, Terms, Privacy, tax statuses and client records.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
