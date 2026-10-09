// PrismaEsignDirectory (R13, parts 1b and 1e) on the real database: firm A's reader finds firm
// A's client, service, portal login, member and vault document, and never firm B's (forBusiness, row-level
// security), even when asked for firm B's ids. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { PrismaEsignDirectory } from '../../src/esign/requests/esign-directory.js';

const fx = inject('fixtures');
const db = createDatabase(fx.appUrl, TEST_CLIENT_OPTIONS);
type Ids = { client: string; engagement: string; login: string; member: string; document: string };
const ids = {} as Record<'a' | 'b', Ids>;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const firms = { a: [fx.firmA.id, fx.users.ownerA, fx.users.clientA] as const };
  const all = { ...firms, b: [fx.firmB.id, fx.users.ownerB, fx.users.clientB] as const };
  for (const [k, [businessId, member, login]] of Object.entries(all)) {
    ids[k as 'a' | 'b'] = await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      const client = await tx.client.create({
        data: { businessId, displayName: `Fake R13 ${k}`, assignedUserId: member.id },
      });
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: 'Fake tax' },
      });
      const engagement = await tx.engagement.create({
        data: { businessId, clientId: client.id, serviceId: service.id, title: 'Fake 2025' },
      });
      const account = await tx.clientAccount.findFirstOrThrow({ where: { userId: login.id } });
      const document = await tx.document.create({
        data: {
          businessId,
          clientId: client.id,
          engagementId: engagement.id,
          direction: 'CLIENT_TO_FIRM',
          fileName: `Fake R13 ${k}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 1234,
          sha256: 'b'.repeat(64),
          s3Key: `tenant/${businessId}/documents/${randomUUID()}`,
        },
      });
      // As the scanner would (a new document starts PENDING).
      await tx.document.update({
        where: { id: document.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
      return {
        client: client.id,
        engagement: engagement.id,
        login: account.id,
        member: member.id,
        document: document.id,
      };
    });
  }
  await owner.$disconnect();
});

afterAll(async () => {
  await db.disconnect();
});

describe('PrismaEsignDirectory', () => {
  it("reads the firm's own rows, and never another firm's", async () => {
    const dir = new PrismaEsignDirectory(db);
    const a = fx.firmA.id;
    expect(await dir.client(a, ids.a.client)).toEqual({
      id: ids.a.client,
      displayName: 'Fake R13 a',
      assignedUserId: fx.users.ownerA.id,
      archived: false,
    });
    expect(await dir.engagement(a, ids.a.engagement)).toMatchObject({ clientId: ids.a.client });
    expect(await dir.clientLogin(a, ids.a.login)).toMatchObject({ id: ids.a.login });
    expect(await dir.member(a, ids.a.member)).toMatchObject({ active: true });
    const document = await dir.document(a, ids.a.document);
    expect(document).toEqual({
      id: ids.a.document,
      clientId: ids.a.client,
      fileName: 'Fake R13 a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1234,
      sha256: 'b'.repeat(64),
      s3Key: expect.stringMatching(new RegExp(`^tenant/${a}/documents/`)) as string,
      scanStatus: 'CLEAN',
    });

    expect(await dir.client(a, ids.b.client)).toBeNull();
    expect(await dir.engagement(a, ids.b.engagement)).toBeNull();
    expect(await dir.clientLogin(a, ids.b.login)).toBeNull();
    expect(await dir.member(a, ids.b.member)).toBeNull();
    expect(await dir.document(a, ids.b.document)).toBeNull();
    // Firm B's reader, the other way round.
    expect(await dir.client(fx.firmB.id, ids.a.client)).toBeNull();
    expect(await dir.member(fx.firmB.id, ids.a.member)).toBeNull();
    expect(await dir.document(fx.firmB.id, ids.a.document)).toBeNull();
    expect(await dir.document(fx.firmB.id, ids.b.document)).toMatchObject({ id: ids.b.document });
  });
});
