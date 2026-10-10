// Firm Sign (r0_esign): every esign table is its own firm's (RLS, same-firm foreign keys), the
// records of a signing are insert-only, a request moves only forward and keeps what was sent,
// only a completed request's own final PDF and certificate start CLEAN in the vault, and
// enabled_modules changes only through app_set_business_module. Runs as the app role under RLS,
// with the owner only for fixtures and the module function. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
type Firm = { id: string; owner: string; client: string; engagement: string };
const A: Firm = { id: '', owner: randomUUID(), client: '', engagement: '' };
const B: Firm = { id: '', owner: randomUUID(), client: '', engagement: '' };
const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const days = (d: number) => new Date(Date.now() + d * 86_400_000);

const as = (firm: Firm) => db.forBusiness(firm.id);
const ownerIn = <T>(firm: Firm, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  runInScope(owner, { kind: 'business', businessId: firm.id }, fn);
const appIn = <T>(firm: Firm, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: firm.id }, fn);

const settings = {
  routing: 'SEQUENTIAL' as const,
  expiryDays: 30,
  reminderFirstAfterDays: 3,
  reminderEveryDays: 3,
  reminderMax: 3,
  expiryWarningDays: 2,
};
/** A DRAFT of `firm` for its client and engagement, with one external signer and a field. */
async function draft(firm: Firm) {
  const request = await as(firm).esignRequest.create({
    data: {
      businessId: firm.id,
      title: 'Engagement letter',
      source: 'TAB',
      clientId: firm.client,
      engagementId: firm.engagement,
      senderUserId: firm.owner,
      ...settings,
    },
  });
  const signer = await as(firm).esignRecipient.create({
    data: {
      businessId: firm.id,
      requestId: request.id,
      position: 0,
      kind: 'SIGNER',
      role: 'CLIENT',
      routingOrder: 1,
      name: 'Pat Example',
      email: 'pat@example.test',
      linkType: 'EXTERNAL',
      delivery: 'EMAIL',
      authMethod: 'EMAIL_CODE',
      colorIndex: 0,
    },
  });
  const field = await as(firm).esignField.create({
    data: {
      businessId: firm.id,
      requestId: request.id,
      recipientId: signer.id,
      position: 0,
      type: 'SIGNATURE',
      pageIndex: 0,
      x: 0.1,
      y: 0.8,
      w: 0.3,
      h: 0.05,
      required: true,
    },
  });
  return { request, signer, field };
}
const sendFacts = () => ({
  status: 'SENT' as const,
  sentAt: new Date(),
  expiresAt: days(30),
  originalSha256: hex('packet'),
});
async function sent(firm: Firm) {
  const parts = await draft(firm);
  await as(firm).esignRequest.update({ where: { id: parts.request.id }, data: sendFacts() });
  return parts;
}
/** The recipient signs (status SIGNED with signed_at). */
const sign = (firm: Firm, recipientId: string) =>
  as(firm).esignRecipient.update({
    where: { id: recipientId },
    data: { status: 'SIGNED', signedAt: new Date() },
  });
/** A sent request moves on to PARTIALLY_SIGNED and then COMPLETED, with its hashes. */
async function complete(firm: Firm, requestId: string) {
  const update = (data: Prisma.EsignRequestUncheckedUpdateInput) =>
    as(firm).esignRequest.update({ where: { id: requestId }, data });
  await update({ status: 'PARTIALLY_SIGNED', completionDueAt: new Date() });
  await update({
    status: 'COMPLETED',
    completedAt: new Date(),
    completionDueAt: null,
    finalSha256: hex(`final ${requestId}`),
    certificateSha256: hex(`certificate ${requestId}`),
  });
}
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [firm, slug] of [
      [A, `esa-${run}`],
      [B, `esb-${run}`],
    ] as const) {
      await tx.user.create({
        data: {
          id: firm.owner,
          cognitoSub: firm.owner,
          pool: 'STAFF',
          email: `${slug}@example.test`,
          name: 'Owner',
        },
      });
      firm.id = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
    }
  });
  for (const firm of [A, B]) {
    await ownerIn(firm, async (tx) => {
      const businessId = firm.id;
      await tx.membership.create({
        data: { businessId, userId: firm.owner, role: 'OWNER', status: 'ACTIVE' },
      });
      firm.client = (await tx.client.create({ data: { businessId, displayName: 'Pat' } })).id;
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
      });
      firm.engagement = (
        await tx.engagement.create({
          data: { businessId, clientId: firm.client, serviceId: service.id, title: '2025 Tax' },
        })
      ).id;
    });
  }
  await ownerIn(
    A,
    (tx) =>
      tx.$queryRaw`SELECT app_set_business_module(${A.id}::uuid, 'esign', true, 'test setup')`,
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's Firm Sign rows", async () => {
    const { request, signer } = await draft(A);
    expect(await as(B).esignRequest.findUnique({ where: { id: request.id } })).toBeNull();
    expect(await as(B).esignRecipient.count({ where: { requestId: request.id } })).toBe(0);
    expect(await as(B).esignField.count({ where: { requestId: request.id } })).toBe(0);
    expect(
      (await as(B).esignRequest.updateMany({ where: { id: request.id }, data: { title: 'x' } }))
        .count,
    ).toBe(0);
    expect((await as(B).esignRequest.deleteMany({ where: { id: request.id } })).count).toBe(0);
    expect((await as(B).esignRecipient.deleteMany({ where: { id: signer.id } })).count).toBe(0);
    await expect(
      runInScope(app, { kind: 'platform' }, (tx) => tx.esignRequest.count()),
    ).resolves.toBe(0);
  });

  it("refuses a row written into another firm, or pointing at another firm's rows", async () => {
    const { request } = await draft(A);
    // Firm B writing a row with firm A's id: the policy's WITH CHECK.
    await expect(
      as(B).esignEvent.create({
        data: {
          businessId: A.id,
          requestId: request.id,
          type: 'EDITED',
          actorKind: 'SYSTEM',
          actorName: 'Firmivra',
        },
      }),
    ).rejects.toThrow(/row-level security/i);
    // Firm B's own row naming firm A's request, client or member: the same-firm foreign keys.
    await expect(
      as(B).esignEvent.create({
        data: {
          businessId: B.id,
          requestId: request.id,
          type: 'EDITED',
          actorKind: 'SYSTEM',
          actorName: 'Firmivra',
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      as(B).esignRequest.create({
        data: {
          businessId: B.id,
          title: 'x',
          source: 'TAB',
          clientId: A.client,
          senderUserId: B.owner,
          ...settings,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      as(B).esignRequest.create({
        data: { businessId: B.id, title: 'x', source: 'TAB', senderUserId: A.owner, ...settings },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('keeps the records of a signing insert-only', async () => {
    const { rows } = await runInScope(owner, { kind: 'platform' }, async (tx) => ({
      rows: await tx.$queryRaw<{ grant: string }[]>`
        SELECT t || ' ' || p AS grant FROM unnest(ARRAY['esign_events', 'esign_consent_versions',
          'esign_template_versions', 'esign_approval_notes', 'esign_signing_links',
          'esign_bulk_batches']) AS t, unnest(ARRAY['UPDATE', 'DELETE']) AS p
        WHERE has_table_privilege('firmivra_app', t, p)
        UNION ALL
        SELECT t || ' DELETE' FROM unnest(ARRAY['esign_settings', 'esign_templates', 'esign_emails',
          'esign_bulk_items']) AS t
        WHERE has_table_privilege('firmivra_app', t, 'DELETE')`,
    }));
    expect(rows).toEqual([]);
  });
});

describe('requests', () => {
  it('start as a DRAFT; only a DRAFT is deleted, with its parts', async () => {
    await expect(
      as(A).esignRequest.create({
        data: {
          businessId: A.id,
          title: 'x',
          source: 'TAB',
          senderUserId: A.owner,
          status: 'SENT',
          ...settings,
        },
      }),
    ).rejects.toThrow(/starts as a DRAFT/);
    const kept = await sent(A);
    expect((await as(A).esignRequest.deleteMany({ where: { id: kept.request.id } })).count).toBe(0);
    const gone = await draft(A);
    await as(A).esignRequest.delete({ where: { id: gone.request.id } });
    expect(await as(A).esignRecipient.count({ where: { requestId: gone.request.id } })).toBe(0);
    expect(await as(A).esignField.count({ where: { requestId: gone.request.id } })).toBe(0);
  });

  it('move only forward, and keep what was sent', async () => {
    const { request, signer, field } = await sent(A);
    const update = (data: Prisma.EsignRequestUncheckedUpdateInput) =>
      as(A).esignRequest.update({ where: { id: request.id }, data });
    await expect(update({ status: 'DRAFT' })).rejects.toThrow(/SENT cannot become DRAFT/);
    await expect(update({ sentAt: null })).rejects.toThrow(/what was sent cannot change/);
    await expect(update({ routing: 'PARALLEL' })).rejects.toThrow(/what was sent cannot change/);
    await expect(update({ senderUserId: A.owner, source: 'BULK' })).rejects.toThrow(/never change/);
    // Its recipients and fields: nothing added, moved or re-pointed; only progress and values.
    await expect(
      as(A).esignRecipient.update({ where: { id: signer.id }, data: { routingOrder: 2 } }),
    ).rejects.toThrow(/fixed once sent/);
    await expect(
      as(A).esignField.update({ where: { id: field.id }, data: { x: 0.2 } }),
    ).rejects.toThrow(/only while the request is a DRAFT/);
    await expect(
      as(A).esignField.update({
        where: { id: field.id },
        data: { filled: true, valueEnc: Buffer.from('ciphertext') },
      }),
    ).resolves.toMatchObject({ filled: true });
    await expect(
      as(A).esignField.create({
        data: {
          businessId: A.id,
          requestId: request.id,
          position: 1,
          type: 'TEXT',
          pageIndex: 0,
          x: 0,
          y: 0,
          w: 0.1,
          h: 0.1,
          required: false,
        },
      }),
    ).rejects.toThrow(/only while the request is a DRAFT/);
    await expect(
      as(A).esignRecipient.update({
        where: { id: signer.id },
        data: { status: 'VIEWED', viewedAt: new Date(), tokenVersion: 1 },
      }),
    ).resolves.toMatchObject({ tokenVersion: 1 });
    await expect(
      as(A).esignRecipient.update({ where: { id: signer.id }, data: { tokenVersion: 0 } }),
    ).rejects.toThrow(/only rises/);

    await update({
      status: 'VOIDED',
      voidedAt: new Date(),
      voidReason: 'Wrong year',
      voidedByUserId: A.owner,
    });
    await expect(update({ voidReason: 'Another reason' })).rejects.toThrow(/set once/);
    await expect(update({ title: 'Renamed' })).rejects.toThrow(/VOIDED request cannot change/);
  });
});

describe('while signing', () => {
  it("changes a signer's value only while the request is open and they have not signed", async () => {
    const value = (fieldId: string, text: string) =>
      as(A).esignField.update({
        where: { id: fieldId },
        data: { filled: true, valueEnc: Buffer.from(text) },
      });
    // R0's probe: the request completed, the value stays.
    const done = await sent(A);
    await complete(A, done.request.id);
    await expect(value(done.field.id, 'late')).rejects.toThrow(/a signer's value changes only/);
    await expect(
      as(A).esignField.update({ where: { id: done.field.id }, data: { filled: true } }),
    ).rejects.toThrow(/a signer's value changes only/);
    // Open: until the signer signs.
    const open = await sent(A);
    await expect(value(open.field.id, 'mine')).resolves.toMatchObject({ filled: true });
    await sign(A, open.signer.id);
    await expect(value(open.field.id, 'changed')).rejects.toThrow(/a signer's value changes only/);
    // Not yet sent: an approval waits, and the signer's values are theirs to give.
    const waiting = await draft(A);
    await as(A).esignRequest.update({
      where: { id: waiting.request.id },
      data: { status: 'NEEDS_APPROVAL' },
    });
    await expect(value(waiting.field.id, 'early')).rejects.toThrow(/a signer's value changes/);
  });

  it("changes a sender's value only before the request is sent", async () => {
    const { request } = await draft(A);
    const field = await as(A).esignField.create({
      data: {
        ...{ businessId: A.id, requestId: request.id, position: 1, type: 'TEXT', pageIndex: 0 },
        ...{ x: 0.1, y: 0.1, w: 0.2, h: 0.05, required: true },
      },
    });
    const value = (text: string) =>
      as(A).esignField.update({
        where: { id: field.id },
        data: { filled: true, valueEnc: Buffer.from(text) },
      });
    await expect(value('draft')).resolves.toMatchObject({ filled: true });
    await as(A).esignRequest.update({
      where: { id: request.id },
      data: { status: 'NEEDS_APPROVAL' },
    });
    await expect(value('approval')).resolves.toMatchObject({ filled: true });
    await as(A).esignRequest.update({ where: { id: request.id }, data: sendFacts() });
    await expect(value('sent')).rejects.toThrow(/a sender's value changes only before/);
  });

  it('adds and removes attachments and attachment uploads only while the signer may sign', async () => {
    const { request, signer, field } = await draft(A);
    const key = () => `tenant/${A.id}/esign/${request.id}/attachments/${randomUUID()}`;
    const file = { fileName: 'w2.pdf', contentType: 'application/pdf', sizeBytes: 1024 };
    const attach = () =>
      as(A).esignAttachment.create({
        data: {
          ...{ businessId: A.id, requestId: request.id, recipientId: signer.id },
          ...{ fieldId: field.id, s3Key: key(), sha256: hex('attachment'), ...file },
        },
      });
    const upload = (kind: 'ATTACHMENT' | 'DOCUMENT') =>
      as(A).esignPendingUpload.create({
        data: {
          ...{ businessId: A.id, tokenHash: hex(randomUUID()), kind, requestId: request.id },
          ...(kind === 'ATTACHMENT'
            ? { recipientId: signer.id, fieldId: field.id, s3Key: key() }
            : { userId: A.owner, s3Key: `tenant/${A.id}/esign/${request.id}/${randomUUID()}` }),
          ...{ fileId: randomUUID(), sha256: hex('upload'), ...file },
        },
      });
    const refused = /only while the request is open and the recipient has not signed/;
    // A DRAFT: nobody signs yet (the sender's own document upload still goes in).
    await expect(attach()).rejects.toThrow(refused);
    await expect(upload('ATTACHMENT')).rejects.toThrow(refused);
    await expect(upload('DOCUMENT')).resolves.toMatchObject({ kind: 'DOCUMENT' });
    await as(A).esignRequest.update({ where: { id: request.id }, data: sendFacts() });
    // Open: the signer adds, replaces and removes.
    await expect(upload('ATTACHMENT')).resolves.toMatchObject({ kind: 'ATTACHMENT' });
    const first = await attach();
    await as(A).esignAttachment.delete({ where: { id: first.id } });
    const kept = await attach();
    // Signed: what they attached stays, and nothing new comes in.
    await sign(A, signer.id);
    await expect(as(A).esignAttachment.delete({ where: { id: kept.id } })).rejects.toThrow(refused);
    await expect(upload('ATTACHMENT')).rejects.toThrow(refused);
    // The scan result still lands.
    await expect(
      as(A).esignAttachment.update({
        where: { id: kept.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      }),
    ).resolves.toMatchObject({ scanStatus: 'CLEAN' });
  });

  it('issues SIGN and IN_PERSON links only while the signer may sign; COPY links after', async () => {
    const { request, signer } = await draft(A);
    const link = (purpose: 'SIGN' | 'IN_PERSON' | 'COPY') =>
      as(A).esignSigningLink.create({
        data: {
          ...{ businessId: A.id, tokenHash: hex(randomUUID()), requestId: request.id },
          ...{ recipientId: signer.id, tokenVersion: 0, purpose },
          ...(purpose === 'SIGN' ? {} : { expiresAt: days(1) }),
        },
      });
    const refused = /only while the request is open and the recipient has not signed/;
    await expect(link('SIGN')).rejects.toThrow(refused);
    await as(A).esignRequest.update({ where: { id: request.id }, data: sendFacts() });
    await expect(link('SIGN')).resolves.toMatchObject({ purpose: 'SIGN' });
    await expect(link('IN_PERSON')).resolves.toMatchObject({ purpose: 'IN_PERSON' });
    await sign(A, signer.id);
    await expect(link('SIGN')).rejects.toThrow(refused);
    await complete(A, request.id);
    await expect(link('SIGN')).rejects.toThrow(refused);
    await expect(link('IN_PERSON')).rejects.toThrow(refused);
    await expect(link('COPY')).resolves.toMatchObject({ purpose: 'COPY' });
  });

  it("freezes a closed request's recipients, except a token_version rise", async () => {
    const closed = async (close: (requestId: string) => Promise<unknown>) => {
      const { request, signer } = await sent(A);
      await close(request.id);
      // Ending a kiosk session revokes the signer's session even after the request closed.
      await expect(
        as(A).esignRecipient.update({
          where: { id: signer.id },
          data: { tokenVersion: { increment: 1 } },
        }),
      ).resolves.toMatchObject({ id: signer.id });
      for (const data of [
        { reminderCount: 1 },
        { tokenVersion: 5, reminderCount: 1 },
        { lastRemindedAt: new Date() },
        { name: 'Pat Renamed' },
        { email: 'other@example.test' },
        { status: 'VIEWED' as const, viewedAt: new Date() },
      ]) {
        expect(
          await outcome(as(A).esignRecipient.update({ where: { id: signer.id }, data })),
        ).toMatch(/request's recipients never change/);
      }
    };
    await closed((id) => complete(A, id));
    await closed((id) =>
      as(A).esignRequest.update({
        where: { id },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: 'x', voidedByUserId: A.owner },
      }),
    );
    await closed((id) =>
      as(A).esignRequest.update({
        where: { id },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      }),
    );
    // A decline writes the recipient first, then the request.
    await closed(async (id) => {
      const [signer] = await as(A).esignRecipient.findMany({ where: { requestId: id } });
      await as(A).esignRecipient.update({
        where: { id: signer!.id },
        data: { status: 'DECLINED', declinedAt: new Date(), declineReason: 'Not mine' },
      });
      await as(A).esignRequest.update({ where: { id }, data: { status: 'DECLINED' } });
    });
  });
});

describe('text', () => {
  it('refuses control and invisible characters; keeps tabs and line breaks', async () => {
    const { request } = await draft(A);
    const update = (data: Prisma.EsignRequestUncheckedUpdateInput) =>
      as(A).esignRequest.update({ where: { id: request.id }, data });
    for (const title of ['Bell\u0007', 'Zero​width', 'Bidi‮override', '⠀']) {
      await expect(update({ title })).rejects.toThrow(/esign_requests_values/);
    }
    await expect(
      update({ internalNote: 'Line one\r\nLine two\twith a tab' }),
    ).resolves.toBeTruthy();
  });
});

describe('bulk rows', () => {
  it("name the firm's own client, and that client's own engagement", async () => {
    const template = await as(A).esignTemplate.create({
      data: {
        businessId: A.id,
        name: `Bulk ${randomUUID()}`,
        visibility: 'FIRM',
        ownerUserId: A.owner,
      },
    });
    await as(A).esignTemplateVersion.create({
      data: {
        ...{ businessId: A.id, templateId: template.id, version: 1, sha256: hex('template') },
        ...{ s3Key: `tenant/${A.id}/esign/${template.id}/template-1.pdf`, sizeBytes: 2048 },
        ...{ pageSizes: [{ w: 612, h: 792 }], roles: [], fields: [], savedByUserId: A.owner },
        ...settings,
      },
    });
    const batch = await as(A).esignBulkBatch.create({
      data: {
        ...{ businessId: A.id, templateId: template.id, templateVersion: 1 },
        ...{ templateName: template.name, createdByUserId: A.owner },
      },
    });
    const other = await ownerIn(A, (tx) =>
      tx.client.create({ data: { businessId: A.id, displayName: 'Sam' } }),
    );
    let position = 0;
    const item = (clientId: string, engagementId: string | null) =>
      as(A).esignBulkItem.create({
        data: {
          ...{ businessId: A.id, batchId: batch.id, position: position++, clientId },
          ...{ engagementId, requestId: randomUUID() },
        },
      });
    await expect(item(B.client, null)).rejects.toThrow(/foreign key/i);
    await expect(item(other.id, A.engagement)).rejects.toThrow(/foreign key/i);
    await expect(item(other.id, B.engagement)).rejects.toThrow(/foreign key/i);
    await expect(item(A.client, A.engagement)).resolves.toMatchObject({ clientId: A.client });
    await expect(item(other.id, null)).resolves.toMatchObject({ clientId: other.id });
  });
});

describe('the scan exception', () => {
  it("files only a completed request's own final PDF and certificate as CLEAN", async () => {
    const { request } = await sent(A);
    const final = hex('final'),
      certificate = hex('certificate');
    const file = (
      sha256: string,
      folder: string,
      data: Partial<Prisma.DocumentUncheckedCreateInput> = {},
    ) =>
      as(A).document.create({
        data: {
          businessId: A.id,
          clientId: A.client,
          engagementId: A.engagement,
          direction: 'FIRM_TO_CLIENT',
          fileName: `${folder}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 2048,
          sha256,
          s3Key: `tenant/${A.id}/esign/${request.id}/${folder}/${randomUUID()}.pdf`,
          scanStatus: 'CLEAN',
          scannedAt: new Date(),
          legalHold: true,
          esignRequestId: request.id,
          ...data,
        },
      });
    // Not completed yet.
    await expect(file(final, 'final')).rejects.toThrow(/Firm Sign copy/);
    await as(A).esignRequest.update({
      where: { id: request.id },
      data: { status: 'PARTIALLY_SIGNED', completionDueAt: new Date() },
    });
    await as(A).esignRequest.update({
      where: { id: request.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completionDueAt: null,
        finalSha256: final,
        certificateSha256: certificate,
      },
    });
    await expect(file(hex('other'), 'final')).rejects.toThrow(/Firm Sign copy/);
    await expect(file(final, 'source')).rejects.toThrow(/Firm Sign copy/);
    await expect(file(final, 'final', { legalHold: false })).rejects.toThrow(/Firm Sign copy/);
    await expect(file(final, 'final', { esignRequestId: null })).rejects.toThrow(
      /starts unscanned/,
    );
    const finalDoc = await file(final, 'final');
    const certificateDoc = await file(certificate, 'certificate');
    await expect(
      as(A).esignRequest.update({
        where: { id: request.id },
        data: { finalDocumentId: certificateDoc.id, certificateDocumentId: finalDoc.id },
      }),
    ).rejects.toThrow(/its own final PDF and certificate/);
    await as(A).esignRequest.update({
      where: { id: request.id },
      data: { finalDocumentId: finalDoc.id, certificateDocumentId: certificateDoc.id },
    });
    // Filed once.
    await expect(file(final, 'final')).rejects.toThrow(/Firm Sign copy/);
  });

  it('holds the request while a copy is filed, so nothing changes it meanwhile', async () => {
    const { request } = await sent(A);
    await complete(A, request.id);
    let filed!: () => void;
    let release!: () => void;
    const inserted = new Promise<void>((resolve) => (filed = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const filing = outcome(
      appIn(A, async (tx) => {
        await tx.document.create({
          data: {
            ...{ businessId: A.id, clientId: A.client, engagementId: A.engagement },
            ...{ direction: 'FIRM_TO_CLIENT', fileName: 'final.pdf', sizeBytes: 2048 },
            ...{ contentType: 'application/pdf', sha256: hex(`final ${request.id}`) },
            s3Key: `tenant/${A.id}/esign/${request.id}/final/${randomUUID()}.pdf`,
            ...{ scanStatus: 'CLEAN', scannedAt: new Date(), legalHold: true },
            esignRequestId: request.id,
          },
        });
        filed();
        await gate;
        throw new Error('rolled back');
      }),
    );
    await inserted;
    const meanwhile = await outcome(
      appIn(A, async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '300ms'`;
        await tx.esignRequest.update({
          where: { id: request.id },
          data: { lastActivityAt: new Date() },
        });
      }),
    );
    release();
    expect(await filing).toBe('rolled back');
    expect(meanwhile).toMatch(/lock timeout/i);
  });
});

describe('the module switch', () => {
  const setModule = (firm: Firm, module: string, on: boolean, reason = 'test') =>
    ownerIn(
      firm,
      (tx) =>
        tx.$queryRaw<
          { m: string[] }[]
        >`SELECT app_set_business_module(${firm.id}::uuid, ${module}, ${on}, ${reason}) AS m`,
    ).then((rows) => rows[0]!.m);
  const audits = (firm: Firm) =>
    ownerIn(firm, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firm.id, action: { startsWith: 'module.' } },
        orderBy: { createdAt: 'asc' },
      }),
    );

  it('refuses every change by the app role, and by the owner outside the function', async () => {
    await expect(
      as(A).businessSettings.update({ where: { businessId: A.id }, data: { enabledModules: [] } }),
    ).rejects.toThrow(/only through app_set_business_module/);
    await expect(
      as(B).businessSettings.create({ data: { businessId: B.id, enabledModules: ['esign'] } }),
    ).rejects.toThrow(/only through app_set_business_module/);
    // Setting the function's marker does not help the app role.
    await expect(
      appIn(B, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.module_switch', ${B.id}, true)`;
        await tx.businessSettings.create({ data: { businessId: B.id, enabledModules: ['esign'] } });
      }),
    ).rejects.toThrow(/only through app_set_business_module/);
    await expect(
      appIn(
        A,
        (tx) => tx.$queryRaw`SELECT app_set_business_module(${A.id}::uuid, 'esign', false, 'x')`,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      ownerIn(A, (tx) =>
        tx.businessSettings.update({ where: { businessId: A.id }, data: { enabledModules: [] } }),
      ),
    ).rejects.toThrow(/only through app_set_business_module/);
    // Other settings still change as before.
    await expect(
      as(A).businessSettings.update({
        where: { businessId: A.id },
        data: { portalName: 'A portal' },
      }),
    ).resolves.toMatchObject({ enabledModules: ['esign'] });
  });

  it('switches through app_set_business_module, with a firm audit row per change', async () => {
    expect(await setModule(B, 'calculators', true, 'Beta request')).toEqual(['calculators']);
    expect(await setModule(B, 'esign', true)).toEqual(['calculators', 'esign']);
    expect(await setModule(B, 'esign', true)).toEqual(['calculators', 'esign']);
    expect(await setModule(B, 'calculators', false)).toEqual(['esign']);
    const rows = await audits(B);
    expect(rows.map((r) => [r.action, r.metadata])).toEqual([
      ['module.enabled', { module: 'calculators', reason: 'Beta request' }],
      ['module.enabled', { module: 'esign', reason: 'test' }],
      ['module.disabled', { module: 'calculators', reason: 'test' }],
    ]);
    await expect(setModule(B, 'documents', true)).rejects.toThrow(/esign or calculators/);
    await expect(setModule(B, 'esign', false, '  ')).rejects.toThrow(/one-line reason/);
    await expect(setModule(B, 'esign', false, 'two\nlines')).rejects.toThrow(/one-line reason/);
    expect(await setModule(B, 'esign', false)).toEqual([]);
  });

  it('holds only known modules, once each', async () => {
    const write = (modules: string[]) =>
      ownerIn(A, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.module_switch', ${A.id}, true)`;
        await tx.businessSettings.update({
          where: { businessId: A.id },
          data: { enabledModules: modules },
        });
      });
    await expect(write(['esign', 'documents'])).rejects.toThrow(
      /business_settings_enabled_modules/,
    );
    await expect(write(['esign', 'esign'])).rejects.toThrow(/business_settings_enabled_modules/);
  });

  it("lists the active firms with a module on, by id only, for Firm Sign's jobs", async () => {
    const firms = await runInScope(
      app,
      { kind: 'business', businessId: B.id },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_firms_with_module('esign') AS id`,
    );
    expect(firms.map((f) => f.id)).toContain(A.id);
    expect(firms.map((f) => f.id)).not.toContain(B.id);
  });

  it('owned by a role that is no superuser (as on RDS), both functions still work under RLS', async () => {
    const role = `fv_esign_${run}`;
    const functions = [
      'app_set_business_module(uuid, text, boolean, text)',
      'app_firms_with_module(text)',
    ];
    const [me] = await owner.$queryRaw<{ name: string }[]>`SELECT current_user AS name`;
    const migrate = me!.name;
    await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
    await owner.$executeRawUnsafe(`GRANT "${migrate}" TO ${role}`);
    await owner.$executeRawUnsafe(`GRANT CREATE ON SCHEMA public TO ${role}`);
    for (const f of functions)
      await owner.$executeRawUnsafe(`ALTER FUNCTION ${f} OWNER TO ${role}`);
    try {
      expect(await setModule(B, 'calculators', true, 'RDS check')).toEqual(['calculators']);
      expect(await setModule(B, 'calculators', false, 'RDS check')).toEqual([]);
      const rows = await audits(B);
      expect(rows.slice(-2).map((r) => [r.action, r.metadata])).toEqual([
        ['module.enabled', { module: 'calculators', reason: 'RDS check' }],
        ['module.disabled', { module: 'calculators', reason: 'RDS check' }],
      ]);
      const firms = await runInScope(
        app,
        { kind: 'business', businessId: B.id },
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app_firms_with_module('esign') AS id`,
      );
      expect(firms.map((f) => f.id)).toContain(A.id);
      expect(firms.map((f) => f.id)).not.toContain(B.id);
    } finally {
      for (const f of functions) {
        await owner.$executeRawUnsafe(`ALTER FUNCTION ${f} OWNER TO "${migrate}"`);
      }
      await owner.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
      await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
    }
  });

  it('both definitions can be created by a role that is no superuser (the RDS migrate role)', async () => {
    // On RDS the migrate role is no superuser: PostgreSQL refuses it a function SET clause for a
    // custom parameter (42501 "permission denied to set parameter"), which failed r0_esign on dev.
    // Not a member of the local migrate role: locally that is the bootstrap superuser, whose
    // membership would grant SET on every parameter.
    const role = `fv_esign_mig_${run}`;
    const functions = [
      'app_set_business_module(uuid, text, boolean, text)',
      'app_firms_with_module(text)',
    ];
    const [me] = await owner.$queryRaw<{ name: string }[]>`SELECT current_user AS name`;
    const migrate = me!.name;
    await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
    await owner.$executeRawUnsafe(`GRANT CREATE ON SCHEMA public TO ${role}`);
    for (const f of functions)
      await owner.$executeRawUnsafe(`ALTER FUNCTION ${f} OWNER TO ${role}`);
    try {
      for (const f of functions) {
        const [row] = await owner.$queryRawUnsafe<{ def: string }[]>(
          `SELECT pg_get_functiondef('${f}'::regprocedure) AS def`,
        );
        await owner.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
          await tx.$executeRawUnsafe(row!.def);
        });
      }
      // No function carries a custom (app.*) setting.
      const custom = await owner.$queryRaw<{ name: string }[]>`
        SELECT p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS c(setting)
                        WHERE split_part(c.setting, '=', 1) LIKE '%.%')`;
      expect(custom).toEqual([]);
    } finally {
      for (const f of functions) {
        await owner.$executeRawUnsafe(`ALTER FUNCTION ${f} OWNER TO "${migrate}"`);
      }
      await owner.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
      await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
    }
  });

  it("gives the caller's scope settings back", async () => {
    const settingsNow = (tx: Prisma.TransactionClient) =>
      tx.$queryRaw<{ scope: string; firm: string; marker: string }[]>`
        SELECT current_setting('app.scope', true) AS scope,
               current_setting('app.current_business_id', true) AS firm,
               coalesce(current_setting('app.module_switch', true), '') AS marker`.then(
        (rows) => rows[0]!,
      );
    const afterSwitch = await ownerIn(A, async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.module_switch', 'caller', true)`;
      await tx.$queryRaw`SELECT app_set_business_module(${B.id}::uuid, 'calculators', true, 'scope check')`;
      return settingsNow(tx);
    });
    expect(afterSwitch).toEqual({ scope: 'business', firm: A.id, marker: 'caller' });
    expect(await setModule(B, 'calculators', false, 'scope check')).toEqual([]);

    const afterList = await appIn(B, async (tx) => {
      await tx.$queryRaw`SELECT app_firms_with_module('esign') AS id`;
      return settingsNow(tx);
    });
    expect(afterList).toEqual({ scope: 'business', firm: B.id, marker: '' });
  });
});
