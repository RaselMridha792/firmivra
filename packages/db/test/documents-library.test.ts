// R37, Documents: the library columns on documents (folder, details, review, validity, versions,
// archive and trash) and the folder tree. Runs as the app role.
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
  client: '',
  client2: '',
  engagement: '',
  engagement2: '',
  engagementB: '',
  clientB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);

type Doc = Partial<{
  direction: 'FIRM_TO_CLIENT' | 'INTERNAL';
  clientId: string;
  engagementId: string;
  folderId: string;
  description: string;
  tags: string[];
  reviewStatus: 'NEEDS_REVIEW' | 'IN_REVIEW' | 'VERIFIED' | 'COMPLETED';
  reviewedAt: Date;
  reviewedByUserId: string;
  reviewerUserId: string;
  notifyClient: boolean;
  archivedAt: Date;
  trashedAt: Date;
}>;
/** A firm document of client 1 (the firm can upload at any time). */
const newDoc = (data: Doc = {}) =>
  A().document.create({
    data: {
      businessId: ids.firmA,
      clientId: ids.client,
      engagementId: ids.engagement,
      direction: 'FIRM_TO_CLIENT',
      fileName: 'Return.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
      s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
      ...data,
    },
  });
const newFolder = (data: Record<string, unknown> = {}) =>
  A().documentFolder.create({
    data: { businessId: ids.firmA, name: `Folder ${randomUUID().slice(0, 6)}`, ...data },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@dl.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `dla-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `dlb-${run}`, name: 'B' } })).id;
  });
  const setup = (businessId: string, userId: string) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } });
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
      });
      const out: string[] = [];
      for (const name of ['One', 'Two']) {
        const client = await tx.client.create({ data: { businessId, displayName: name } });
        const engagement = await tx.engagement.create({
          data: { businessId, clientId: client.id, serviceId: service.id, title: '2025' },
        });
        out.push(client.id, engagement.id);
      }
      return out as [string, string, string, string];
    });
  [ids.client, ids.engagement, ids.client2, ids.engagement2] = await setup(ids.firmA, ids.staffA);
  [ids.clientB, ids.engagementB] = (await setup(ids.firmB, ids.staffB)).slice(0, 2) as [
    string,
    string,
  ];
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's folders, and refuses to point at them", async () => {
    const folder = await newFolder();
    expect(await B().documentFolder.findUnique({ where: { id: folder.id } })).toBeNull();
    expect(
      (await B().documentFolder.updateMany({ where: { id: folder.id }, data: { name: 'x' } }))
        .count,
    ).toBe(0);
    expect((await B().documentFolder.deleteMany({ where: { id: folder.id } })).count).toBe(0);
    await expect(
      B().documentFolder.create({ data: { businessId: ids.firmA, name: 'x' } }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      B().documentFolder.create({
        data: { businessId: ids.firmB, name: 'x', parentId: folder.id },
      }),
    ).rejects.toThrow(/scope of a live parent|foreign key/i);
    await expect(
      B().document.create({
        data: {
          businessId: ids.firmB,
          clientId: ids.clientB,
          engagementId: ids.engagementB,
          direction: 'INTERNAL',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'b'.repeat(64),
          s3Key: `tenant/${ids.firmB}/documents/${randomUUID()}`,
          folderId: folder.id,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('refuses a reviewer from another firm', async () => {
    await expect(newDoc({ reviewerUserId: ids.staffB })).rejects.toThrow(/foreign key/i);
    await expect(newDoc({ reviewerUserId: ids.staffA })).resolves.toBeTruthy();
  });
});

describe('details', () => {
  it('keeps the description to one short line and the tags few, short and different', async () => {
    for (const data of [
      { description: ' ' },
      { description: 'x'.repeat(501) },
      { description: 'two\nlines' },
      { tags: ['a', 'A'] },
      { tags: [''] },
      { tags: ['x'.repeat(41)] },
      { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
    ]) {
      await expect(newDoc(data)).rejects.toThrow(/documents_(description|tags)/);
    }
    await expect(
      newDoc({ description: '2025 W-2 from Acme (fake)', tags: ['w-2', 'income'] }),
    ).resolves.toBeTruthy();
  });

  it('verified and completed carry who and when; the other states do not', async () => {
    const at = new Date();
    for (const data of [
      { reviewStatus: 'VERIFIED' as const },
      { reviewStatus: 'NEEDS_REVIEW' as const, reviewedAt: at, reviewedByUserId: ids.staffA },
      { reviewStatus: 'COMPLETED' as const, reviewedAt: at },
    ]) {
      await expect(newDoc(data)).rejects.toThrow(/documents_review/);
    }
    await expect(
      newDoc({ reviewStatus: 'VERIFIED', reviewedAt: at, reviewedByUserId: ids.staffA }),
    ).resolves.toBeTruthy();
    await expect(newDoc({ reviewStatus: 'NEEDS_REVIEW' })).resolves.toBeTruthy();
  });

  it("'notify the client' is for documents shared with the client; archive and trash are exclusive", async () => {
    await expect(newDoc({ direction: 'INTERNAL', notifyClient: true })).rejects.toThrow(
      /documents_notify_client/,
    );
    await expect(newDoc({ notifyClient: true })).resolves.toBeTruthy();
    await expect(newDoc({ archivedAt: new Date(), trashedAt: new Date() })).rejects.toThrow(
      /documents_archive_or_trash/,
    );
    const doc = await newDoc();
    const archived = await A().document.update({
      where: { id: doc.id },
      data: { archivedAt: new Date() },
    });
    expect(archived.archivedAt).not.toBeNull();
    await expect(
      A().document.update({ where: { id: doc.id }, data: { trashedAt: new Date() } }),
    ).rejects.toThrow(/documents_archive_or_trash/);
  });
});

describe('folders', () => {
  it('names are one line and unique among live folders of a parent', async () => {
    for (const name of [' ', 'x'.repeat(81), 'a\nb']) {
      await expect(newFolder({ name })).rejects.toThrow(/document_folders_name/);
    }
    const root = await newFolder({ name: `Root ${run}` });
    await expect(newFolder({ name: `root ${run}` })).rejects.toThrow(/Unique/i);
    await newFolder({ name: 'Taxes', parentId: root.id });
    await expect(newFolder({ name: ' taxes ', parentId: root.id })).rejects.toThrow(/Unique/i);
    // The same name under another parent, or once the first is archived, is fine.
    await expect(newFolder({ name: 'Taxes' })).resolves.toBeTruthy();
    const old = await newFolder({ name: `Old ${run}` });
    await A().documentFolder.update({ where: { id: old.id }, data: { archivedAt: new Date() } });
    await expect(newFolder({ name: `Old ${run}` })).resolves.toBeTruthy();
  });

  it('has no cycle, at most 5 levels, and a subfolder has its parent scope', async () => {
    let parent = await newFolder();
    const chain = [parent.id];
    for (let i = 0; i < 4; i++) {
      parent = await newFolder({ parentId: parent.id });
      chain.push(parent.id);
    }
    await expect(newFolder({ parentId: parent.id })).rejects.toThrow(/at most 5 levels/);
    await expect(
      A().documentFolder.update({ where: { id: chain[0]! }, data: { parentId: chain[4]! } }),
    ).rejects.toThrow(/not inside itself/);
    const firm = await newFolder({ scope: 'FIRM' });
    await expect(newFolder({ parentId: firm.id })).rejects.toThrow(/scope of a live parent/);
    await expect(newFolder({ scope: 'FIRM', parentId: firm.id })).resolves.toBeTruthy();
    await expect(
      A().documentFolder.update({ where: { id: firm.id }, data: { scope: 'CLIENT' } }),
    ).rejects.toThrow(/scope of a folder cannot change/);
  });

  it('a firm folder gives clients nothing, and takes internal documents only', async () => {
    await expect(newFolder({ scope: 'FIRM', allowClientUploads: true })).rejects.toThrow(
      /document_folders_firm_scope/,
    );
    await expect(newFolder({ scope: 'FIRM', defaultClientAccess: 'VIEW' })).rejects.toThrow(
      /document_folders_firm_scope/,
    );
    const firm = await newFolder({ scope: 'FIRM' });
    await expect(newDoc({ folderId: firm.id })).rejects.toThrow(/internal documents only/);
    await expect(newDoc({ folderId: firm.id, direction: 'INTERNAL' })).resolves.toBeTruthy();
    const client = await newFolder({
      defaultClientAccess: 'VIEW_UPLOAD',
      allowClientUploads: true,
    });
    await expect(newDoc({ folderId: client.id })).resolves.toBeTruthy();
  });

  it('takes no document once archived, and is deleted only while empty', async () => {
    const folder = await newFolder();
    const doc = await newDoc({ folderId: folder.id });
    await expect(A().documentFolder.delete({ where: { id: folder.id } })).rejects.toThrow(
      /foreign key/i,
    );
    await A().document.update({ where: { id: doc.id }, data: { folderId: null } });
    await expect(A().documentFolder.delete({ where: { id: folder.id } })).resolves.toBeTruthy();
    const archived = await newFolder();
    await A().documentFolder.update({
      where: { id: archived.id },
      data: { archivedAt: new Date() },
    });
    await expect(newDoc({ folderId: archived.id })).rejects.toThrow(/archived folder takes no/);
    await expect(
      A().documentFolder.update({ where: { id: archived.id }, data: { archivedAt: null } }),
    ).rejects.toThrow(/stays archived/);
  });
});
