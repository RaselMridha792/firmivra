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
});
