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
const ids = { firmA: '', firmB: '', memberA: '', memberB: '', staffA: '', managerA: '' };
const u = { owner: randomUUID(), staff: randomUUID(), manager: randomUUID(), ownerB: randomUUID() };
const firm = () => db.forBusiness(ids.firmA);
/** The acting person (documents are for the acting Owner or Admin only). */
const as = (actor: string, business = ids.firmA) =>
  db.forBusiness(business, { actorUserId: actor });
const asOwner = () => as(u.owner);
/** The document scanner: a job with no actor. */
const scanner = () => db.forBusiness(ids.firmA);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let n = 0;
const doc = (data: Record<string, unknown> = {}) => {
  const name = `file-${n++}.pdf`;
  return asOwner().staffDocument.create({
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
  const users = Object.values(u);
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
    role: 'OWNER' | 'STAFF' | 'MANAGER',
  ) =>
    tx.membership
      .create({ data: { businessId: business, userId, role, status: 'ACTIVE' } })
      .then((m) => m.id);
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.memberA = await add(tx, ids.firmA, u.owner, 'OWNER');
    ids.staffA = await add(tx, ids.firmA, u.staff, 'STAFF');
    ids.managerA = await add(tx, ids.firmA, u.manager, 'MANAGER');
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.memberB = await add(tx, ids.firmB, u.ownerB, 'OWNER');
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('staff documents and sessions: isolation', () => {
  it('a firm sees only its own', async () => {
    const d = await doc();
    const s = await session();
    const other = as(u.ownerB, ids.firmB);
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

  it('accepts only the listed types, up to 100 MB, with a plain name and a SHA-256', async () => {
    await expect(doc({ contentType: 'application/zip' })).rejects.toThrow();
    await expect(doc({ contentType: 'text/html' })).rejects.toThrow();
    await expect(doc({ sizeBytes: 0 })).rejects.toThrow();
    await expect(doc({ sizeBytes: 104_857_601 })).rejects.toThrow();
    await expect(doc({ sizeBytes: 104_857_600 })).resolves.toBeTruthy();
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
      asOwner().staffDocument.update({ where: { id: d.id }, data });
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
    await expect(asOwner().staffDocument.delete({ where: { id: d.id } })).rejects.toThrow();
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

describe('staff documents: the wall', () => {
  it('shows and changes documents only to the acting Owner or Admin', async () => {
    const d = await doc();
    for (const actor of [u.staff, u.manager]) {
      const person = as(actor);
      expect(await person.staffDocument.findMany(), actor).toEqual([]);
      expect(await person.staffDocument.findUnique({ where: { id: d.id } })).toBeNull();
      expect(
        await person.staffDocument.updateMany({ where: { id: d.id }, data: { type: 'NDA' } }),
      ).toEqual({ count: 0 });
      await expect(
        person.staffDocument.create({
          data: {
            businessId: ids.firmA,
            membershipId: ids.memberA,
            type: 'NDA',
            fileName: 'w.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1,
            sha256: sha('w'),
            s3Key: `tenant/${ids.firmA}/staff/${ids.memberA}/w.pdf`,
          },
        }),
      ).rejects.toThrow();
    }
    expect((await asOwner().staffDocument.findUnique({ where: { id: d.id } }))?.type).toBe('W4');
  });

  it('shows a session with no actor only pending files, or one it scanned minutes ago', async () => {
    const old = await doc({ scanStatus: 'CLEAN', scannedAt: new Date(Date.now() - 10 * 60_000) });
    const fresh = await doc({ scanStatus: 'CLEAN', scannedAt: new Date() });
    const pending = await doc();
    const seen = (await scanner().staffDocument.findMany()).map((d) => d.id);
    expect(seen).toContain(pending.id);
    expect(seen).toContain(fresh.id);
    expect(seen).not.toContain(old.id);
  });

  it('shows nothing to another firm, acting or not', async () => {
    await doc();
    expect(await as(u.ownerB, ids.firmB).staffDocument.count()).toBe(0);
    expect(await db.forBusiness(ids.firmB).staffDocument.count()).toBe(0);
    // An owner of firm B naming firm A's scope is no manager there.
    expect(await as(u.ownerB, ids.firmA).staffDocument.count()).toBe(0);
  });
});

describe('staff documents: the scanner', () => {
  it('sets the scan result of a PENDING file and nothing else', async () => {
    const d = await doc();
    // updateMany returns no row: the scanner may not read a row once it is scanned, and update()
    // would read it back.
    const update = (data: Record<string, unknown>) =>
      scanner().staffDocument.updateMany({ where: { id: d.id }, data });
    // The scanner can read the pending row it works on.
    expect(await scanner().staffDocument.findUnique({ where: { id: d.id } })).toMatchObject({
      scanStatus: 'PENDING',
    });
    for (const data of [
      { type: 'NDA' },
      { archivedAt: new Date() },
      { fileName: 'renamed.pdf' },
      { sizeBytes: 1 },
      { s3Key: `tenant/${ids.firmA}/staff/${ids.memberA}/moved.pdf` },
      { sha256: sha('other') },
      { membershipId: ids.staffA, s3Key: `tenant/${ids.firmA}/staff/${ids.staffA}/m.pdf` },
      { uploadedById: ids.staffA },
      { type: 'NDA', scanStatus: 'CLEAN', scannedAt: new Date() },
    ]) {
      await expect(update(data), JSON.stringify(data)).rejects.toThrow();
    }
    await expect(update({ scanStatus: 'CLEAN', scannedAt: new Date() })).resolves.toEqual({
      count: 1,
    });
    expect(await asOwner().staffDocument.findUnique({ where: { id: d.id } })).toMatchObject({
      scanStatus: 'CLEAN',
      type: 'W4',
      fileName: d.fileName,
    });
    // Scanned once: the row is out of the scanner's sight, so a second result changes nothing.
    await expect(update({ scanStatus: 'INFECTED', scannedAt: new Date() })).resolves.toEqual({
      count: 0,
    });
  });

  it("cannot create or delete a document, or reach another firm's", async () => {
    await expect(
      scanner().staffDocument.create({
        data: {
          businessId: ids.firmA,
          membershipId: ids.memberA,
          type: 'NDA',
          fileName: 's.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          sha256: sha('s'),
          s3Key: `tenant/${ids.firmA}/staff/${ids.memberA}/s.pdf`,
        },
      }),
    ).rejects.toThrow();
    const d = await doc();
    await expect(scanner().staffDocument.delete({ where: { id: d.id } })).rejects.toThrow();
    expect(
      await db.forBusiness(ids.firmB).staffDocument.updateMany({
        where: { id: d.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      }),
    ).toEqual({ count: 0 });
  });
});
