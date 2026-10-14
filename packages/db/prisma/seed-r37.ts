// R37 seed rows: synthetic examples for the tables and columns added for Intake Forms, Documents,
// Tax Returns, Appointments, Clients and Leads (LVP only). One function, called once by seed.ts;
// safe to run again (fixed ids, upserts or create-once). No real client data.
import type { TxClient } from '../src/client.js';
import { SEED_INTAKE_IDS, SEED_USERS, SEED_WORK_IDS } from './seed-data.js';

/** Fixed ids of the R37 rows (RFC 9562 UUIDs, variant 8). */
const ID = {
  intakeDraft: '00000000-0000-4a37-8000-000000000001',
} as const;

/** Intake Forms: the firm's settings, a draft send, and the send setup of the seeded intake. */
async function seedIntakeSend(tx: TxClient, businessId: string) {
  await tx.intakeSettings.upsert({
    where: { businessId },
    update: {},
    create: { businessId, defaultOwnerUserId: SEED_USERS.lvpOwner.id },
  });
  await tx.intake.update({
    where: { id: SEED_INTAKE_IDS.taxIntake },
    data: {
      assignedUserId: SEED_USERS.lvpStaff.id,
      deliveryChannel: 'PORTAL',
      expiresAt: new Date('2026-12-15T12:00:00Z'),
    },
  });
  const form = await tx.intake.findUniqueOrThrow({ where: { id: SEED_INTAKE_IDS.leadIntake } });
  await tx.intake.upsert({
    where: { id: ID.intakeDraft },
    update: {},
    create: {
      id: ID.intakeDraft,
      businessId,
      formId: form.formId,
      engagementId: SEED_WORK_IDS.lvpBookkeeping,
      status: 'DRAFT',
      deliveryChannel: 'EMAIL',
      messageSubject: 'Your bookkeeping intake',
      messageBody: 'Hello, please fill in this short form before our meeting.',
    },
  });
}

export async function seedR37(tx: TxClient, businessId: string) {
  await seedIntakeSend(tx, businessId);
}
