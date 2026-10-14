// R35: staff documents and sessions. Each firm sees only its own, and the shape and change rules
// hold. Runs as the app role.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', memberA: '', memberB: '' };
const firm = () => db.forBusiness(ids.firmA);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let n = 0;
const doc = (data: Record<string, unknown> = {}) => {
  const name = `file-${n++}.pdf`;
  return firm().staffDocument.create({
    data: {
      businessId: ids.firmA,
      membershipId: ids.memberA,
      type: 'W4',
      fileName: name,
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sha256: sha(name),
      s3Key: `tenant/${ids.firmA}/staff/${ids.memberA}/${name}`,
      ...data,
    },
  });
};
const session = (data: Record<string, unknown> = {}) =>
  firm().staffSession.create({
    data: {
      businessId: ids.firmA,
      membershipId: ids.memberA,
      tokenHash: sha(`session-${n++}`),
      device: 'Chrome on macOS',
      ip: '203.0.113.7',
      ...data,
    },
  });

beforeAll(async () => {
  const users = [randomUUID(), randomUUID()];
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of users) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@s.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `xa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `xb-${run}`, name: 'B' } })).id;
  });
  const add = (
    tx: Parameters<Parameters<typeof runInScope>[2]>[0],
    business: string,
    userId: string,
  ) =>
    tx.membership
      .create({ data: { businessId: business, userId, role: 'OWNER', status: 'ACTIVE' } })
      .then((m) => m.id);
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.memberA = await add(tx, ids.firmA, users[0]!);
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.memberB = await add(tx, ids.firmB, users[1]!);
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('staff documents and sessions: isolation', () => {
  it('a firm sees only its own', async () => {
    const d = await doc();
    const s = await session();
    const other = db.forBusiness(ids.firmB);
    expect(await other.staffDocument.findUnique({ where: { id: d.id } })).toBeNull();
    expect(await other.staffSession.findUnique({ where: { id: s.id } })).toBeNull();
    expect(
      await other.staffDocument.updateMany({ where: { id: d.id }, data: { type: 'NDA' } }),
    ).toEqual({ count: 0 });
  });

  it("refuses a row for another firm or another firm's member", async () => {
    await expect(
      db.forBusiness(ids.firmB).staffDocument.create({
        data: {
          businessId: ids.firmA,
          membershipId: ids.memberA,
          type: 'NDA',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          sha256: sha('x'),
          s3Key: `tenant/${ids.firmA}/staff/${ids.memberA}/x.pdf`,
        },
      }),
    ).rejects.toThrow();
    await expect(
      doc({ membershipId: ids.memberB, s3Key: `tenant/${ids.firmA}/staff/${ids.memberB}/y.pdf` }),
    ).rejects.toThrow();
    await expect(session({ membershipId: ids.memberB })).rejects.toThrow();
  });
});

describe('staff documents: rules', () => {
  it("keeps the file in the member's private folder, once", async () => {
    await expect(
      doc({ s3Key: `tenant/${ids.firmB}/staff/${ids.memberA}/z.pdf` }),
    ).rejects.toThrow();
    await expect(
      doc({ s3Key: `tenant/${ids.firmA}/staff/${ids.memberB}/z.pdf` }),
    ).rejects.toThrow();
    await expect(doc({ s3Key: `tenant/${ids.firmA}/documents/z.pdf` })).rejects.toThrow();
    const d = await doc();
    await expect(doc({ s3Key: d.s3Key })).rejects.toThrow();
  });

  it('accepts only the listed types, up to 10 MB, with a plain name and a SHA-256', async () => {
    await expect(doc({ contentType: 'application/zip' })).rejects.toThrow();
    await expect(doc({ contentType: 'text/html' })).rejects.toThrow();
    await expect(doc({ sizeBytes: 0 })).rejects.toThrow();
    await expect(doc({ sizeBytes: 10_485_761 })).rejects.toThrow();
    await expect(doc({ sizeBytes: 10_485_760 })).resolves.toBeTruthy();
    await expect(doc({ fileName: '../secrets.pdf' })).rejects.toThrow();
    await expect(doc({ fileName: 'a\\b.pdf' })).rejects.toThrow();
    await expect(doc({ sha256: 'abc' })).rejects.toThrow();
    await expect(
      doc({
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: 'a.docx',
      }),
    ).resolves.toBeTruthy();
  });

  it('changes only the type, the archive time and the scan result', async () => {
    const d = await doc();
    const update = (data: Record<string, unknown>) =>
      firm().staffDocument.update({ where: { id: d.id }, data });
    await expect(update({ fileName: 'renamed.pdf' })).rejects.toThrow();
    await expect(
      update({ s3Key: `tenant/${ids.firmA}/staff/${ids.memberA}/moved.pdf` }),
    ).rejects.toThrow();
    await expect(update({ type: 'NDA' })).resolves.toBeTruthy(); // reclassify
    await expect(update({ scanStatus: 'CLEAN' })).rejects.toThrow(); // needs its time
    await expect(update({ scanStatus: 'CLEAN', scannedAt: new Date() })).resolves.toBeTruthy();
    await expect(update({ scanStatus: 'INFECTED', scannedAt: new Date() })).rejects.toThrow(); // once
    await expect(update({ archivedAt: new Date() })).resolves.toBeTruthy();
    await expect(update({ archivedAt: null })).rejects.toThrow(); // stays archived
  });

  it('is never deleted', async () => {
    const d = await doc();
    await expect(firm().staffDocument.delete({ where: { id: d.id } })).rejects.toThrow();
  });
});

describe('staff sessions: rules', () => {
  it('needs a hashed identifier, short device text and a readable IP', async () => {
    await expect(session({ tokenHash: 'raw-refresh-token' })).rejects.toThrow();
    await expect(session({ device: '' })).rejects.toThrow();
    await expect(session({ device: 'x'.repeat(101) })).rejects.toThrow();
    await expect(session({ ip: 'not an ip' })).rejects.toThrow();
    await expect(session({ ip: '2001:db8::1', place: null })).resolves.toBeTruthy();
    await expect(session({ ip: null })).resolves.toBeTruthy();
    const s = await session();
    await expect(session({ tokenHash: s.tokenHash })).rejects.toThrow();
  });

  it('is seen again or ended, once, and an ended session does not change', async () => {
    const s = await session();
    const update = (data: Record<string, unknown>) =>
      firm().staffSession.update({ where: { id: s.id }, data });
    await expect(update({ tokenHash: sha('other') })).rejects.toThrow();
    await expect(update({ membershipId: ids.memberB })).rejects.toThrow();
    await expect(update({ lastActiveAt: new Date() })).resolves.toBeTruthy();
    await expect(update({ revokedAt: new Date() })).resolves.toBeTruthy();
    await expect(update({ lastActiveAt: new Date() })).rejects.toThrow();
    await expect(update({ revokedAt: null })).rejects.toThrow();
    await expect(firm().staffSession.delete({ where: { id: s.id } })).rejects.toThrow();
  });
});
