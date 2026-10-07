// R0 step 5 rules: documents stay in their firm's S3 prefix and their own engagement, clients
// upload only to open engagements, scan results are final, and deletes follow the permission
// matrix (retention, legal hold, a client's upload while open). Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  client1: '',
  client2: '',
  open: '',
  completed: '',
  otherClient: '',
  category: '',
  categoryB: '',
};
const days = (d: number) => new Date(Date.now() + d * 86_400_000);

const firmA = () => db.forBusiness(ids.firmA);
type Upload = {
  engagementId?: string;
  clientId?: string;
  direction?: 'CLIENT_TO_FIRM' | 'FIRM_TO_CLIENT' | 'INTERNAL';
  s3Key?: string;
  sizeBytes?: number;
  sha256?: string;
  categoryId?: string;
  requestId?: string;
  retentionUntil?: Date;
  legalHold?: boolean;
  scanStatus?: 'CLEAN';
};
/** A new upload to client 1's open engagement in firm A. */
const upload = (data: Upload = {}) =>
  firmA().document.create({
    data: {
      businessId: ids.firmA,
      clientId: ids.client1,
      engagementId: ids.open,
      direction: 'CLIENT_TO_FIRM',
      fileName: 'w2.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      sha256: 'b'.repeat(64),
      s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
      ...data,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `da-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `db-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const client = (displayName: string) =>
      tx.client.create({ data: { businessId: ids.firmA, displayName } });
    ids.client1 = (await client('One')).id;
    ids.client2 = (await client('Two')).id;
    const service = await tx.service.create({
      data: { businessId: ids.firmA, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
    });
    const engagement = (clientId: string, done = false) =>
      tx.engagement.create({
        data: {
          businessId: ids.firmA,
          clientId,
          serviceId: service.id,
          title: '2025 Personal Tax',
          ...(done ? { status: 'COMPLETED' as const, completedAt: new Date() } : {}),
        },
      });
    ids.open = (await engagement(ids.client1)).id;
    ids.completed = (await engagement(ids.client1, true)).id;
    ids.otherClient = (await engagement(ids.client2)).id;
    ids.category = (
      await tx.documentCategory.create({ data: { businessId: ids.firmA, name: 'W-2' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.categoryB = (
      await tx.documentCategory.create({ data: { businessId: ids.firmB, name: 'W-2' } })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('where a document can point', () => {
  it("must sit under its own firm's prefix, tenant/<business_id>/", async () => {
    for (const s3Key of [
      `tenant/${ids.firmB}/documents/${randomUUID()}`,
      `${ids.firmA}/documents/${randomUUID()}`,
      `documents/${randomUUID()}`,
      `tenant/${ids.firmA}`,
    ]) {
      await expect(upload({ s3Key })).rejects.toThrow(/check constraint/i);
    }
    await expect(
      upload({ s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}` }),
    ).resolves.toMatchObject({ businessId: ids.firmA });
  });

  it("cannot use another firm's category or another client's engagement", async () => {
    await expect(upload({ categoryId: ids.categoryB })).rejects.toThrow(/foreign key/i);
    await expect(upload({ engagementId: ids.otherClient })).rejects.toThrow(/foreign key/i);
  });

  it('answers only a request of the same engagement; a report links only its own documents', async () => {
    const request = await firmA().documentRequest.create({
      data: {
        businessId: ids.firmA,
        clientId: ids.client2,
        engagementId: ids.otherClient,
        title: 'Photo ID',
      },
    });
    await expect(upload({ requestId: request.id })).rejects.toThrow(/foreign key/i);

    const doc = await upload();
    await expect(
      firmA().engagementReport.create({
        data: {
          businessId: ids.firmA,
          engagementId: ids.otherClient,
          documentId: doc.id,
          kind: 'REPORT',
          title: 'X',
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('checks the 10 MB limit and the SHA-256 format', async () => {
    await expect(upload({ sizeBytes: 10 * 1024 * 1024 + 1 })).rejects.toThrow(/check constraint/i);
    await expect(upload({ sha256: 'not-a-hash' })).rejects.toThrow(/check constraint/i);
  });
});

describe('uploads and scanning', () => {
  it('a client uploads only to an open engagement; the firm can upload any time', async () => {
    await expect(upload({ engagementId: ids.completed })).rejects.toThrow(/open engagement/);
    await expect(
      upload({ engagementId: ids.completed, direction: 'FIRM_TO_CLIENT' }),
    ).resolves.toMatchObject({ scanStatus: 'PENDING' });
  });

  it('starts unscanned, and the scan result is set once', async () => {
    await expect(upload({ scanStatus: 'CLEAN' })).rejects.toThrow(/starts unscanned/);
    const doc = await upload();
    await expect(
      firmA().document.update({ where: { id: doc.id }, data: { scanStatus: 'CLEAN' } }),
    ).rejects.toThrow(/check constraint/i);
    await firmA().document.update({
      where: { id: doc.id },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
    for (const scanStatus of ['PENDING', 'INFECTED'] as const) {
      await expect(
        firmA().document.update({ where: { id: doc.id }, data: { scanStatus } }),
      ).rejects.toThrow(/cannot change/);
    }
  });

  it('the file, its S3 key, its engagement and its uploader never change', async () => {
    const doc = await upload({ direction: 'FIRM_TO_CLIENT' });
    for (const data of [
      { s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}` },
      { contentType: 'image/png' },
      { sha256: 'c'.repeat(64) },
      { direction: 'INTERNAL' as const },
      { uploadedByUserId: randomUUID() },
    ]) {
      await expect(firmA().document.update({ where: { id: doc.id }, data })).rejects.toThrow(
        /cannot change/,
      );
    }
    await expect(
      firmA().document.update({ where: { id: doc.id }, data: { fileName: 'Renamed W-2.pdf' } }),
    ).resolves.toMatchObject({ fileName: 'Renamed W-2.pdf' });
  });
});

describe('retention', () => {
  const setRetention = (id: string, retentionUntil: Date | null) =>
    firmA().document.update({ where: { id }, data: { retentionUntil } });

  it('only moves later: a later date or keep-for-good, never earlier', async () => {
    const doc = await upload({ retentionUntil: days(365) });
    await expect(setRetention(doc.id, days(30))).rejects.toThrow(/only move later/);
    await expect(setRetention(doc.id, days(400))).resolves.toBeDefined();
    await expect(setRetention(doc.id, null)).resolves.toMatchObject({ retentionUntil: null });
  });

  it('keep-for-good (NULL) never becomes a date', async () => {
    const doc = await upload();
    await expect(setRetention(doc.id, days(-1))).rejects.toThrow(/only move later/);
    await expect(setRetention(doc.id, days(3650))).rejects.toThrow(/only move later/);
  });

  it('clearing a legal hold is allowed but cannot unlock an early delete', async () => {
    const doc = await upload({
      direction: 'FIRM_TO_CLIENT',
      retentionUntil: days(30),
      legalHold: true,
    });
    await expect(
      firmA().document.update({ where: { id: doc.id }, data: { legalHold: false } }),
    ).resolves.toMatchObject({ legalHold: false });
    await expect(setRetention(doc.id, days(-1))).rejects.toThrow(/only move later/);
    expect((await firmA().document.deleteMany({ where: { id: doc.id } })).count).toBe(0);
  });
});

describe('deleting documents', () => {
  const remove = async (id: string) => (await firmA().document.deleteMany({ where: { id } })).count;

  it("a client's upload can be deleted while its engagement is open", async () => {
    expect(await remove((await upload()).id)).toBe(1);
  });

  it('a firm document only after retention, and never under legal hold', async () => {
    const firmDoc = { direction: 'FIRM_TO_CLIENT' as const };
    expect(await remove((await upload({ ...firmDoc, retentionUntil: days(30) })).id)).toBe(0);
    expect(await remove((await upload(firmDoc)).id)).toBe(0);
    expect(await remove((await upload({ ...firmDoc, retentionUntil: days(-1) })).id)).toBe(1);
    expect(
      await remove((await upload({ ...firmDoc, retentionUntil: days(-1), legalHold: true })).id),
    ).toBe(0);
  });

  it("a client's upload stays once its engagement is no longer open", async () => {
    const doc = await upload();
    await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.engagement.update({
        where: { id: ids.open },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
    );
    try {
      expect(await remove(doc.id)).toBe(0);
    } finally {
      await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.engagement.update({ where: { id: ids.open }, data: { status: 'ACTIVE' } }),
      );
    }
  });
});

describe('document requests', () => {
  const request = (data: { status?: 'NOT_AVAILABLE' | 'REJECTED'; statusNote?: string } = {}) =>
    firmA().documentRequest.create({
      data: {
        businessId: ids.firmA,
        clientId: ids.client1,
        engagementId: ids.open,
        categoryId: ids.category,
        title: 'W-2 from your employer',
        dueOn: days(14),
        ...data,
      },
    });

  it('"I don\'t have this" and "marked missing" need a reason', async () => {
    for (const status of ['NOT_AVAILABLE', 'REJECTED'] as const) {
      await expect(request({ status })).rejects.toThrow(/check constraint/i);
      await expect(request({ status, statusNote: ' ' })).rejects.toThrow(/check constraint/i);
      await expect(request({ status, statusNote: 'Employer closed' })).resolves.toMatchObject({
        status,
      });
    }
  });

  it('an upload answers a request; requests are never deleted', async () => {
    const r = await request();
    await expect(upload({ requestId: r.id })).resolves.toMatchObject({ requestId: r.id });
    await expect(firmA().documentRequest.deleteMany({ where: { id: r.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});
