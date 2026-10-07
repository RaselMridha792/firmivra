// Withdrawing a firm file shared with the wrong client (Rasel, Oct 8): only the migrate role runs
// withdraw_document(firm, document, reason). It clears the file's links, deletes the row past the
// retention rule and writes an audit row; the app role can do none of it.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', staff: randomUUID(), client: '', engagement: '', thread: '' };
const REASON = 'Shared with the wrong client (synthetic test)';

const asOwner = <T>(fn: (tx: TxClient) => Promise<T>, businessId = ids.firmA) =>
  runInScope(owner, { kind: 'business', businessId }, fn);

/** A firm file shared with the client, linked from a tax return, a report and a message. */
async function sharedFile(extra: { legalHold?: boolean } = {}) {
  return asOwner(async (tx) => {
    const A = { businessId: ids.firmA };
    const doc = await tx.document.create({
      data: {
        ...A,
        clientId: ids.client,
        engagementId: ids.engagement,
        direction: 'FIRM_TO_CLIENT',
        fileName: 'fake-return.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        sha256: 'b'.repeat(64),
        s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
        retentionUntil: new Date('2033-12-31T00:00:00.000Z'),
        legalHold: extra.legalHold ?? false,
      },
    });
    const taxReturn = await tx.taxReturn.create({
      data: {
        ...A,
        clientId: ids.client,
        taxYear: 2024,
        filingType: 'INDIVIDUAL',
        status: 'FILED',
        filedOn: new Date('2025-04-01T00:00:00.000Z'),
        documentId: doc.id,
      },
    });
    const report = await tx.engagementReport.create({
      data: {
        ...A,
        engagementId: ids.engagement,
        documentId: doc.id,
        kind: 'REPORT',
        title: 'Fake report',
      },
    });
    const message = await tx.message.create({
      data: {
        ...A,
        threadId: ids.thread,
        senderUserId: ids.staff,
        direction: 'FIRM_TO_CLIENT',
        body: 'Here is your file',
      },
    });
    const attachment = await tx.messageAttachment.create({
      data: { ...A, messageId: message.id, documentId: doc.id },
    });
    return { doc, taxReturn, report, attachment };
  });
}

const withdraw = (businessId: string, documentId: string, reason: string | null) =>
  owner.$queryRaw<{ key: string }[]>`
    SELECT withdraw_document(${businessId}::uuid, ${documentId}::uuid, ${reason}) AS key`;

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: ids.staff,
        cognitoSub: ids.staff,
        pool: 'STAFF',
        email: `${ids.staff}@wd.test`,
        name: 'Fake',
      },
    });
    ids.firmA = (await tx.business.create({ data: { slug: `wda-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `wdb-${run}`, name: 'B' } })).id;
  });
  await asOwner(async (tx) => {
    const A = { businessId: ids.firmA };
    await tx.membership.create({
      data: { ...A, userId: ids.staff, role: 'STAFF', status: 'ACTIVE' },
    });
    ids.client = (await tx.client.create({ data: { ...A, displayName: 'Fake Client' } })).id;
    const service = await tx.service.create({
      data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
    });
    ids.engagement = (
      await tx.engagement.create({
        data: { ...A, clientId: ids.client, serviceId: service.id, title: '2024' },
      })
    ).id;
    ids.thread = (
      await tx.messageThread.create({ data: { ...A, clientId: ids.client, subject: 'Files' } })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect()]);
});

describe('withdraw_document', () => {
  it('the app role can neither run it nor delete a shared file, whatever it sets', async () => {
    const { doc } = await sharedFile();
    await expect(
      runInScope(
        app,
        { kind: 'business', businessId: ids.firmA },
        (tx) =>
          tx.$queryRaw`SELECT withdraw_document(${ids.firmA}::uuid, ${doc.id}::uuid, ${REASON})`,
      ),
    ).rejects.toThrow(/permission denied for function withdraw_document/);
    const deleted = await runInScope(
      app,
      { kind: 'business', businessId: ids.firmA },
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.withdraw_document_id', ${doc.id}, true)`;
        return tx.document.deleteMany({ where: { id: doc.id } });
      },
    );
    expect(deleted.count).toBe(0);
    expect(await asOwner((tx) => tx.document.count({ where: { id: doc.id } }))).toBe(1);
  });

  it('the migrate role removes it with its links, writes an audit row and gets the S3 key', async () => {
    const { doc, taxReturn, report, attachment } = await sharedFile();
    const [row] = await withdraw(ids.firmA, doc.id, REASON);
    expect(row!.key).toBe(doc.s3Key);
    const after = await asOwner(async (tx) => ({
      doc: await tx.document.count({ where: { id: doc.id } }),
      taxReturn: await tx.taxReturn.findUniqueOrThrow({ where: { id: taxReturn.id } }),
      report: await tx.engagementReport.findUniqueOrThrow({ where: { id: report.id } }),
      attachment: await tx.messageAttachment.count({ where: { id: attachment.id } }),
      audit: await tx.auditLog.findMany({
        where: { action: 'document.withdrawn', entityId: doc.id },
      }),
    }));
    expect(after.doc).toBe(0);
    expect(after.taxReturn.documentId).toBeNull();
    expect(after.taxReturn.status).toBe('FILED');
    expect(after.report.documentId).toBeNull();
    expect(after.attachment).toBe(0);
    expect(after.audit).toHaveLength(1);
    expect(after.audit[0]).toMatchObject({ businessId: ids.firmA, entityType: 'document' });
    expect(after.audit[0]!.metadata).toMatchObject({
      reason: REASON,
      clientId: ids.client,
      engagementId: ids.engagement,
      direction: 'FIRM_TO_CLIENT',
      taxReturnsCleared: 1,
      reportsCleared: 1,
      attachmentsRemoved: 1,
    });
    expect(JSON.stringify(after.audit[0]!.metadata)).not.toContain('fake-return.pdf');
  });

  it('refuses a blank reason, another firm or an unknown document, and one under legal hold', async () => {
    const { doc } = await sharedFile();
    const held = await sharedFile({ legalHold: true });
    await expect(withdraw(ids.firmA, doc.id, ' ')).rejects.toThrow(/give a reason/);
    await expect(withdraw(ids.firmA, doc.id, null)).rejects.toThrow(/give a reason/);
    await expect(withdraw(ids.firmA, doc.id, 'x'.repeat(501))).rejects.toThrow(/give a reason/);
    await expect(withdraw(ids.firmB, doc.id, REASON)).rejects.toThrow(/no such document/);
    await expect(withdraw(ids.firmA, randomUUID(), REASON)).rejects.toThrow(/no such document/);
    await expect(withdraw(ids.firmA, held.doc.id, REASON)).rejects.toThrow(/legal hold/);
    expect(
      await asOwner((tx) => tx.document.count({ where: { id: { in: [doc.id, held.doc.id] } } })),
    ).toBe(2);
  });
});
