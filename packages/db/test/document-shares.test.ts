// R37, Documents: shares (extra access to one document, with permissions and an expiry) and the
// firm's document settings. Runs as the app role.
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
  staffA: randomUUID(),
  staffB: randomUUID(),
  inactiveStaff: randomUUID(),
  loginUser1: randomUUID(),
  loginUser2: randomUUID(),
  client1: '',
  client2: '',
  login1: '',
  login2: '',
  engagement1: '',
  engagement2: '',
  docShared: '',
  docInternal: '',
  docOfClient2: '',
  docB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

const file = (businessId: string, direction: 'FIRM_TO_CLIENT' | 'INTERNAL') => ({
  businessId,
  direction,
  fileName: 'File.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  s3Key: `tenant/${businessId}/documents/${randomUUID()}`,
});

type Share = Partial<{
  documentId: string;
  recipientKind: 'CLIENT' | 'MEMBER';
  clientAccountId: string;
  memberUserId: string;
  expiresAt: Date;
  revokedAt: Date;
  revokedByUserId: string;
  canUpload: boolean;
}>;
const client = (data: Share = {}) =>
  A().documentShare.create({
    data: {
      businessId: ids.firmA,
      documentId: ids.docShared,
      recipientKind: 'CLIENT',
      clientAccountId: ids.login1,
      grantedByUserId: ids.staffA,
      ...data,
    },
  });
/** A new document shared with client 1, so a test's grants do not meet another test's. */
const freshDoc = async () =>
  (
    await A().document.create({
      data: {
        ...file(ids.firmA, 'FIRM_TO_CLIENT'),
        clientId: ids.client1,
        engagementId: ids.engagement1,
      },
    })
  ).id;
const member = (data: Share = {}) =>
  A().documentShare.create({
    data: {
      businessId: ids.firmA,
      documentId: ids.docShared,
      recipientKind: 'MEMBER',
      memberUserId: ids.staffA,
      grantedByUserId: ids.staffA,
      ...data,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.staffA, 'STAFF'],
      [ids.staffB, 'STAFF'],
      [ids.inactiveStaff, 'STAFF'],
      [ids.loginUser1, 'CLIENT'],
      [ids.loginUser2, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@ds.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `dsa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `dsb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const b = ids.firmA;
    await tx.membership.create({
      data: { businessId: b, userId: ids.staffA, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { businessId: b, userId: ids.inactiveStaff, role: 'STAFF', status: 'DEACTIVATED' },
    });
    const service = await tx.service.create({
      data: { businessId: b, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
    });
    const make = async (n: number, userId: string) => {
      const c = await tx.client.create({ data: { businessId: b, displayName: `Client ${n}` } });
      const e = await tx.engagement.create({
        data: { businessId: b, clientId: c.id, serviceId: service.id, title: '2025' },
      });
      const a = await tx.clientAccount.create({
        data: {
          businessId: b,
          userId,
          clientId: c.id,
          email: `${userId}@ds.test`,
          status: 'ACTIVE',
        },
      });
      return { c: c.id, e: e.id, a: a.id };
    };
    const one = await make(1, ids.loginUser1);
    const two = await make(2, ids.loginUser2);
    Object.assign(ids, {
      client1: one.c,
      engagement1: one.e,
      login1: one.a,
      client2: two.c,
      engagement2: two.e,
      login2: two.a,
    });
    const doc = (
      clientId: string,
      engagementId: string,
      direction: 'FIRM_TO_CLIENT' | 'INTERNAL',
    ) => tx.document.create({ data: { ...file(b, direction), clientId, engagementId } });
    ids.docShared = (await doc(one.c, one.e, 'FIRM_TO_CLIENT')).id;
    ids.docInternal = (await doc(one.c, one.e, 'INTERNAL')).id;
    ids.docOfClient2 = (await doc(two.c, two.e, 'FIRM_TO_CLIENT')).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const b = ids.firmB;
    await tx.membership.create({
      data: { businessId: b, userId: ids.staffB, role: 'OWNER', status: 'ACTIVE' },
    });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's shares or settings, and refuses to point at them", async () => {
    const share = await member();
    await A().documentSettings.create({ data: { businessId: ids.firmA } });
    expect(await B().documentShare.findUnique({ where: { id: share.id } })).toBeNull();
    expect(
      (await B().documentShare.updateMany({ where: { id: share.id }, data: { canSign: true } }))
        .count,
    ).toBe(0);
    expect(await B().documentSettings.findUnique({ where: { businessId: ids.firmA } })).toBeNull();
    await expect(
      B().documentShare.create({
        data: {
          businessId: ids.firmA,
          documentId: ids.docShared,
          recipientKind: 'MEMBER',
          memberUserId: ids.staffA,
          grantedByUserId: ids.staffA,
        },
      }),
    ).rejects.toThrow(/active member|row-level security/i);
    // Firm B's own grant naming firm A's document, login or member: the same-firm foreign keys.
    for (const data of [
      { documentId: ids.docShared, recipientKind: 'MEMBER' as const, memberUserId: ids.staffB },
      { recipientKind: 'MEMBER' as const, memberUserId: ids.staffA },
    ]) {
      await expect(
        B().documentShare.create({
          data: {
            businessId: ids.firmB,
            grantedByUserId: ids.staffB,
            documentId: ids.docB || ids.docShared,
            ...data,
          },
        }),
      ).rejects.toThrow(/foreign key|active member/i);
    }
    await expect(
      B().documentSettings.create({
        data: { businessId: ids.firmB, defaultReviewerUserId: ids.staffA },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('who a document is shared with', () => {
  it('a client gets a document of theirs that is not internal', async () => {
    await expect(client({ documentId: ids.docInternal })).rejects.toThrow(/not internal/);
    await expect(client({ documentId: ids.docOfClient2 })).rejects.toThrow(/not internal/);
    await expect(client({ clientAccountId: ids.login2 })).rejects.toThrow(/not internal/);
    await expect(client({ canUpload: true })).resolves.toMatchObject({ canUpload: true });
  });

  it('a member is active and may see an internal document', async () => {
    await expect(member({ memberUserId: ids.inactiveStaff })).rejects.toThrow(/active member/);
    await expect(member({ documentId: ids.docInternal })).resolves.toBeTruthy();
  });

  it('names exactly one kind of person', async () => {
    for (const data of [
      { recipientKind: 'CLIENT' as const, clientAccountId: undefined },
      { memberUserId: ids.staffA },
      { recipientKind: 'MEMBER' as const, memberUserId: undefined },
    ]) {
      await expect(client(data as Share)).rejects.toThrow(
        /not internal|active member|document_shares_recipient/,
      );
    }
  });

  it('one live grant per document and person; a new one after revoking', async () => {
    const doc = ids.docOfClient2;
    const first = await client({ documentId: doc, clientAccountId: ids.login2 });
    await expect(client({ documentId: doc, clientAccountId: ids.login2 })).rejects.toThrow(
      /Unique/i,
    );
    await A().documentShare.update({
      where: { id: first.id },
      data: { revokedAt: new Date(), revokedByUserId: ids.staffA },
    });
    await expect(client({ documentId: doc, clientAccountId: ids.login2 })).resolves.toBeTruthy();
  });
});

describe('grant rules', () => {
  it('expires in the future, and starts live', async () => {
    const documentId = await freshDoc();
    await expect(client({ documentId, expiresAt: hours(-1) })).rejects.toThrow(
      /expires in the future/,
    );
    await expect(
      client({ documentId, revokedAt: new Date(), revokedByUserId: ids.staffA }),
    ).rejects.toThrow(/starts live/);
    await expect(client({ documentId, expiresAt: hours(48) })).resolves.toBeTruthy();
  });

  it('changes permissions and expiry while live; never the person; a revoked grant is final', async () => {
    const share = await member({ documentId: ids.docOfClient2 });
    await expect(
      A().documentShare.update({
        where: { id: share.id },
        data: { canDownload: false, canSign: true, expiresAt: hours(72) },
      }),
    ).resolves.toMatchObject({ canDownload: false, canSign: true });
    await expect(
      A().documentShare.update({ where: { id: share.id }, data: { documentId: ids.docShared } }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      A().documentShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } }),
    ).rejects.toThrow(/document_shares_revoked/);
    await A().documentShare.update({
      where: { id: share.id },
      data: { revokedAt: new Date(), revokedByUserId: ids.staffA },
    });
    await expect(
      A().documentShare.update({ where: { id: share.id }, data: { canUpload: true } }),
    ).rejects.toThrow(/revoked grant cannot change/);
    await expect(A().documentShare.delete({ where: { id: share.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('document settings', () => {
  const settings = (data: Record<string, unknown>) =>
    A().documentSettings.update({ where: { businessId: ids.firmA }, data });
  it('keeps days and sizes in range, and the types to the platform’s', async () => {
    for (const data of [
      { requestReminderDaysBefore: 0 },
      { requestReminderDaysBefore: 31 },
      { requestExpiryDays: 366 },
      { documentExpiryReminderDays: 0 },
      { shareExpiryDays: 400 },
      { uploadMaxBytes: 10 * 1024 * 1024 + 1 },
      { uploadMaxBytes: 0 },
      { uploadTypes: ['text/csv'] },
    ]) {
      await expect(settings(data)).rejects.toThrow(/document_settings_/);
    }
    await expect(
      settings({
        requestReminderDaysBefore: 3,
        shareExpiryDays: 30,
        uploadMaxBytes: 5_000_000,
        uploadTypes: ['application/pdf'],
        defaultReviewerUserId: ids.staffA,
      }),
    ).resolves.toBeTruthy();
  });
});
