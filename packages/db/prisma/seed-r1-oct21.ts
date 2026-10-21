// R1 (Oct 21) seed rows: synthetic examples for r1_locations_roles_links (LVP only). The main
// office's contact details, manager, hours and a service; a pending manager change; a custom role;
// a secure link to the sample 2024 return with its one-time code. Called once by seed.ts after
// seedR37 (which creates the main office); safe to run again (fixed ids, upserts or create-once).
// No real client data.
import { createHash } from 'node:crypto';
import type { TxClient } from '../src/client.js';
import { SEED_CLIENT_IDS, SEED_DOCUMENT_IDS, SEED_USERS } from './seed-data.js';

/** Fixed ids of these rows (RFC 9562 UUIDs, variant 8). */
const ID = {
  hours: (weekday: number) => `00000000-0000-4b21-8000-00000000001${weekday}`,
  managerChange: '00000000-0000-4b21-8000-000000000021',
  seniorPreparer: '00000000-0000-4b21-8000-000000000031',
  link: '00000000-0000-4b21-8000-000000000041',
  linkCode: '00000000-0000-4b21-8000-000000000042',
} as const;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

export async function seedR1Oct21(tx: TxClient, businessId: string) {
  // Locations: the main office's contact details and manager, its hours and a service it offers.
  const office = await tx.firmOffice.findFirstOrThrow({ where: { businessId, isMain: true } });
  await tx.firmOffice.update({
    where: { id: office.id },
    data: {
      phone: '+15555550100',
      email: 'office@lvp.test',
      timeZone: 'America/New_York',
      managerUserId: SEED_USERS.lvpOwner.id,
      notes: 'Parking behind the building (synthetic).',
    },
  });
  const annualTax = await tx.service.findFirstOrThrow({
    where: { businessId, name: 'Annual Tax' },
  });
  await tx.firmOfficeService.upsert({
    where: { officeId_serviceId: { officeId: office.id, serviceId: annualTax.id } },
    update: {},
    create: { businessId, officeId: office.id, serviceId: annualTax.id },
  });
  for (const weekday of [1, 2, 3, 4, 5]) {
    await tx.firmOfficeHours.upsert({
      where: { id: ID.hours(weekday) },
      update: {},
      create: {
        id: ID.hours(weekday),
        businessId,
        officeId: office.id,
        weekday,
        opensAt: time('09:00'),
        closesAt: time('17:00'),
      },
    });
  }
  // A pending change: the staff member takes over the main office in January.
  await tx.firmOfficeAction.upsert({
    where: { id: ID.managerChange },
    update: {},
    create: {
      id: ID.managerChange,
      businessId,
      kind: 'REASSIGN_MANAGER',
      officeId: office.id,
      managerUserId: SEED_USERS.lvpOwner.id,
      newManagerUserId: SEED_USERS.lvpStaff.id,
      effectiveAt: new Date('2027-01-04T14:00:00Z'),
      createdByUserId: SEED_USERS.lvpOwner.id,
    },
  });

  // Users & Roles: a custom role started from Tax Preparer, with part of its grid.
  await tx.customRole.upsert({
    where: { id: ID.seniorPreparer },
    update: {},
    create: {
      id: ID.seniorPreparer,
      businessId,
      name: 'Senior Preparer',
      description: 'Prepares and reviews returns (synthetic).',
      basedOn: 'TAX_PREPARER',
    },
  });
  const grid = [
    ['CLIENTS', 'VIEW'],
    ['CLIENTS', 'EDIT'],
    ['TAX_RETURNS', 'VIEW'],
    ['TAX_RETURNS', 'CREATE'],
    ['TAX_RETURNS', 'EDIT'],
    ['TAX_RETURNS', 'APPROVE'],
  ] as const;
  for (const [module, capability] of grid) {
    await tx.customRolePermission.upsert({
      where: {
        customRoleId_module_capability: { customRoleId: ID.seniorPreparer, module, capability },
      },
      update: {},
      create: { businessId, customRoleId: ID.seniorPreparer, module, capability, granted: true },
    });
  }

  // Secure links: the sample 2024 return sent to the client by email, its code by text.
  const link = await tx.documentLink.findUnique({ where: { id: ID.link } });
  if (!link) {
    await tx.documentLink.create({
      data: {
        id: ID.link,
        businessId,
        documentId: SEED_DOCUMENT_IDS.return2024,
        kind: 'CLIENT',
        clientId: SEED_CLIENT_IDS.lvp,
        recipientEmail: 'client@lvp.test',
        recipientPhone: '+15555550123',
        sentVia: 'EMAIL',
        codeRequired: true,
        tokenHash: sha256('seed document link token'),
        expiresAt: new Date(Date.now() + 24 * 3_600_000),
        createdByUserId: SEED_USERS.lvpOwner.id,
      },
    });
    await tx.documentLinkCode.create({
      data: {
        id: ID.linkCode,
        businessId,
        linkId: ID.link,
        channel: 'PHONE',
        codeHash: sha256('seed document link code'),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
  }
}
