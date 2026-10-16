// R37, Documents: request types (templates) and their items, and document versions. Runs as the
// app role.
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
  category: '',
  clientB: '',
  engagementB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);

const newType = (data: { name?: string; ownerUserId?: string } = {}) =>
  A().documentRequestTemplate.create({
    data: { businessId: ids.firmA, name: `Type ${randomUUID().slice(0, 6)}`, ...data },
  });
const newDoc = (
  data: {
    replacesId?: string;
    versionNo?: number;
    clientId?: string;
    engagementId?: string;
    direction?: 'FIRM_TO_CLIENT' | 'INTERNAL';
  } = {},
) =>
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
const clean = (id: string) =>
  A().document.update({ where: { id }, data: { scanStatus: 'CLEAN', scannedAt: new Date() } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@dt.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `dta-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `dtb-${run}`, name: 'B' } })).id;
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
      const category = await tx.documentCategory.create({ data: { businessId, name: 'Income' } });
      return [...out, category.id] as [string, string, string, string, string];
    });
  [ids.client, ids.engagement, ids.client2, ids.engagement2, ids.category] = await setup(
    ids.firmA,
    ids.staffA,
  );
  [ids.clientB, ids.engagementB] = (await setup(ids.firmB, ids.staffB)).slice(0, 2) as [
    string,
    string,
  ];
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's request types or items", async () => {
    const type = await newType();
    const item = await A().documentRequestTemplateItem.create({
      data: { businessId: ids.firmA, templateId: type.id, title: 'ID' },
    });
    expect(await B().documentRequestTemplate.findUnique({ where: { id: type.id } })).toBeNull();
    expect(await B().documentRequestTemplateItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect(
      (
        await B().documentRequestTemplate.updateMany({
          where: { id: type.id },
          data: { description: 'x' },
        })
      ).count,
    ).toBe(0);
    expect(
      (await B().documentRequestTemplateItem.deleteMany({ where: { id: item.id } })).count,
    ).toBe(0);
    await expect(
      B().documentRequestTemplate.create({ data: { businessId: ids.firmA, name: 'x' } }),
    ).rejects.toThrow(/row-level security/i);
    // Firm B's rows naming firm A's type, member or category: the same-firm foreign keys.
    await expect(
      B().documentRequestTemplateItem.create({
        data: { businessId: ids.firmB, templateId: type.id, title: 'x' },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().documentRequestTemplate.create({
        data: { businessId: ids.firmB, name: 'x', ownerUserId: ids.staffA },
      }),
    ).rejects.toThrow(/foreign key/i);
    const own = await B().documentRequestTemplate.create({
      data: { businessId: ids.firmB, name: 'B type' },
    });
    await expect(
      B().documentRequestTemplateItem.create({
        data: { businessId: ids.firmB, templateId: own.id, title: 'x', categoryId: ids.category },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().documentRequestPacket.create({
        data: {
          businessId: ids.firmB,
          clientId: ids.clientB,
          engagementId: ids.engagementB,
          title: 'x',
          templateId: type.id,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('request types', () => {
  it('names are unique among the firm’s live types and among a member’s own lists', async () => {
    const name = `Personal Tax ${run}`;
    await newType({ name });
    await expect(newType({ name: ` ${name.toLowerCase()} ` })).rejects.toThrow(/Unique/i);
    await expect(newType({ name, ownerUserId: ids.staffA })).resolves.toBeTruthy();
    for (const bad of [' ', 'x'.repeat(101)]) {
      await expect(newType({ name: bad })).rejects.toThrow(/document_request_templates_text/);
    }
  });

  it('keeps its items, replaces them when edited, and is archived rather than deleted', async () => {
    const type = await newType();
    const item = await A().documentRequestTemplateItem.create({
      data: { businessId: ids.firmA, templateId: type.id, title: 'W-2', categoryId: ids.category },
    });
    await expect(
      A().documentRequestTemplateItem.create({
        data: { businessId: ids.firmA, templateId: type.id, title: ' ' },
      }),
    ).rejects.toThrow(/document_request_template_items_text/);
    await expect(
      A().documentRequestTemplateItem.delete({ where: { id: item.id } }),
    ).resolves.toBeTruthy();
    await expect(A().documentRequestTemplate.delete({ where: { id: type.id } })).rejects.toThrow(
      /permission denied/,
    );
    await A().documentRequestTemplate.update({
      where: { id: type.id },
      data: { archivedAt: new Date() },
    });
    await expect(
      A().documentRequestTemplate.update({ where: { id: type.id }, data: { archivedAt: null } }),
    ).rejects.toThrow(/stays archived/);
    await expect(
      A().documentRequestTemplate.update({
        where: { id: type.id },
        data: { ownerUserId: ids.staffA },
      }),
    ).rejects.toThrow(/cannot change/);
  });

  it('a request keeps the type it was made from', async () => {
    const type = await newType();
    const packet = await A().documentRequestPacket.create({
      data: {
        businessId: ids.firmA,
        clientId: ids.client,
        engagementId: ids.engagement,
        title: 'Docs',
        templateId: type.id,
      },
    });
    expect(packet.templateId).toBe(type.id);
  });
});

describe('versions', () => {
  it('a replacement is the next version of the same client, engagement and direction', async () => {
    const v1 = await newDoc();
    const v2 = await newDoc({ replacesId: v1.id });
    expect(v2.versionNo).toBe(2);
    // A caller cannot pick the number; one document has one replacement.
    expect((await newDoc({ replacesId: v2.id, versionNo: 9 })).versionNo).toBe(3);
    await expect(newDoc({ replacesId: v1.id })).rejects.toThrow(/Unique/i);
    for (const data of [
      { clientId: ids.client2, engagementId: ids.engagement2 },
      { direction: 'INTERNAL' as const },
    ]) {
      await expect(newDoc({ replacesId: (await newDoc()).id, ...data })).rejects.toThrow(
        /same client, engagement and direction/,
      );
    }
    await expect(
      A().document.update({ where: { id: v2.id }, data: { replacesId: null } }),
    ).rejects.toThrow(/set when it is made/);
  });

  it('the old version is superseded when its replacement is CLEAN, not before', async () => {
    const v1 = await newDoc();
    const v2 = await newDoc({ replacesId: v1.id });
    expect(
      (await A().document.findUniqueOrThrow({ where: { id: v1.id } })).supersededAt,
    ).toBeNull();
    await expect(
      A().document.update({ where: { id: v1.id }, data: { supersededAt: new Date() } }),
    ).rejects.toThrow(/clean replacement/);
    await clean(v2.id);
    expect(
      (await A().document.findUniqueOrThrow({ where: { id: v1.id } })).supersededAt,
    ).not.toBeNull();
    await expect(
      A().document.update({ where: { id: v1.id }, data: { supersededAt: null } }),
    ).rejects.toThrow(/superseded_at is set once/);
  });

  it("another firm's document cannot be replaced", async () => {
    const v1 = await newDoc();
    await expect(
      B().document.create({
        data: {
          businessId: ids.firmB,
          clientId: ids.clientB,
          engagementId: ids.engagementB,
          direction: 'FIRM_TO_CLIENT',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'c'.repeat(64),
          s3Key: `tenant/${ids.firmB}/documents/${randomUUID()}`,
          replacesId: v1.id,
        },
      }),
    ).rejects.toThrow(/same client, engagement and direction|foreign key/i);
  });
});
