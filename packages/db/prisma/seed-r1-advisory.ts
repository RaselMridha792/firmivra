// Business Advisory Review Two (R1, migration r1_advisory_review2): sample rows of the new tables
// for Test Firm B only (never LVP's). Synthetic. Safe to run again, and on a database where people
// have used the firm since: each row is found by its fixed id first, and a row is skipped when the
// firm already has one that would clash (a live industry of the same name, an advisory client for
// the same client).
import type { TxClient } from '../src/client.js';
import { SEED_ADVISORY_REVIEW2_IDS as IDS } from './seed-data.js';

export async function seedAdvisoryReview2(
  tx: TxClient,
  businessId: string,
  clientId: string,
  ownerId: string,
) {
  await seedIndustries(tx, businessId, ownerId);
  await seedResources(tx, businessId, ownerId);
  await seedProgressNote(tx, businessId, clientId, ownerId);
}

/** A-X02: the firm's own list: two live industries and one archived. */
async function seedIndustries(tx: TxClient, businessId: string, ownerId: string) {
  const rows = [
    { id: IDS.industryRetail, name: 'Retail (sample)', sortOrder: 0, archivedAt: null },
    { id: IDS.industryConstruction, name: 'Construction (sample)', sortOrder: 1, archivedAt: null },
    {
      id: IDS.industryArchived,
      name: 'Mining (sample)',
      sortOrder: 2,
      archivedAt: new Date('2026-11-01T00:00:00Z'),
    },
  ];
  for (const row of rows) {
    if (await tx.advisoryIndustry.findUnique({ where: { id: row.id }, select: { id: true } }))
      continue;
    const clash =
      row.archivedAt === null &&
      (await tx.advisoryIndustry.findFirst({
        where: {
          businessId,
          archivedAt: null,
          name: { equals: row.name, mode: 'insensitive' },
        },
        select: { id: true },
      }));
    if (clash) continue;
    await tx.advisoryIndustry.create({
      data: { ...row, businessId, updatedByUserId: ownerId },
    });
  }
}

/** A-X10: a link of the firm's own, and a PDF of its own whose upload is still being scanned. */
async function seedResources(tx: TxClient, businessId: string, ownerId: string) {
  await tx.advisoryResource.upsert({
    where: { id: IDS.resourceLink },
    update: {},
    create: {
      id: IDS.resourceLink,
      businessId,
      title: 'Small Business Grants Overview (sample)',
      category: 'Funding',
      kind: 'LINK',
      summary: 'Where to look for small business grants, and what they usually ask for.',
      url: 'https://example.com/firm-b/grants-overview',
      clientFacing: true,
      createdByUserId: ownerId,
    },
  });
  // The file's key only: no object is stored, so it stays PENDING (never offered to a client).
  await tx.advisoryResourceFile.upsert({
    where: { id: IDS.resourceFile },
    update: {},
    create: {
      id: IDS.resourceFile,
      businessId,
      fileName: 'pricing-worksheet-sample.pdf',
      contentType: 'application/pdf',
      sizeBytes: 48_213,
      sha256: 'a'.repeat(64),
      s3Key: `tenant/${businessId}/advisory-resources/${IDS.resourceFile}/pricing-worksheet-sample.pdf`,
      uploadedByUserId: ownerId,
    },
  });
  await tx.advisoryResource.upsert({
    where: { id: IDS.resourceWithFile },
    update: {},
    create: {
      id: IDS.resourceWithFile,
      businessId,
      title: 'Pricing Worksheet (sample)',
      category: 'Financial Management',
      kind: 'PDF',
      summary: 'A worksheet to set prices that cover your costs and your time.',
      fileId: IDS.resourceFile,
      clientFacing: false,
      createdByUserId: ownerId,
    },
  });
}

/**
 * A-X11: the firm's client in the advisory program, one action item, and a progress note that
 * records the item's status as it is now.
 */
async function seedProgressNote(
  tx: TxClient,
  businessId: string,
  clientId: string,
  ownerId: string,
) {
  const advisory =
    (await tx.advisoryClient.findFirst({
      where: { businessId, clientId },
      select: { id: true },
    })) ??
    (await tx.advisoryClient.create({
      data: {
        id: IDS.advisoryClient,
        businessId,
        clientId,
        advisorUserId: ownerId,
        industry: 'Retail (sample)',
        businessStage: 'startup',
      },
      select: { id: true },
    }));
  const item = await tx.advisoryActionItem.upsert({
    where: { id: IDS.actionItem },
    update: {},
    create: {
      id: IDS.actionItem,
      businessId,
      advisoryClientId: advisory.id,
      title: 'Gather three vendor quotes (sample)',
      assigneeKind: 'STAFF',
      assigneeUserId: ownerId,
      dueOn: new Date('2026-12-15'),
      status: 'IN_PROGRESS',
      createdByUserId: ownerId,
    },
    select: { status: true },
  });
  await tx.advisoryActionItemNote.upsert({
    where: { id: IDS.actionItemNote },
    update: {},
    create: {
      id: IDS.actionItemNote,
      businessId,
      actionItemId: IDS.actionItem,
      body: 'Called two vendors; the third quote is due Friday (sample).',
      status: item.status,
      authorUserId: ownerId,
    },
  });
}
