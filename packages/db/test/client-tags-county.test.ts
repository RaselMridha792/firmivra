// R37, Clients: tags and county. Runs as the
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
  clientB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);

const newTag = (name = `Tag ${randomUUID().slice(0, 6)}`, data: Record<string, unknown> = {}) =>
  A().tag.create({ data: { businessId: ids.firmA, name, ...data } });
const tagClient = (tagId: string, clientId = ids.client, data: Record<string, unknown> = {}) =>
  A().clientTag.create({ data: { businessId: ids.firmA, clientId, tagId, ...data } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@ct.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `cta-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `ctb-${run}`, name: 'B' } })).id;
  });
  const setup = (businessId: string, userId: string) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } });
      return (await tx.client.create({ data: { businessId, displayName: 'Client (fake)' } })).id;
    });
  ids.client = await setup(ids.firmA, ids.staffA);
  ids.clientB = await setup(ids.firmB, ids.staffB);
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's tags, and refuses to cross firms", async () => {
    const tag = await newTag();
    await tagClient(tag.id);
    expect(await B().tag.findUnique({ where: { id: tag.id } })).toBeNull();
    expect(await B().clientTag.count({ where: { tagId: tag.id } })).toBe(0);
    expect((await B().tag.updateMany({ where: { id: tag.id }, data: { name: 'x' } })).count).toBe(
      0,
    );
    expect((await B().clientTag.deleteMany({ where: { tagId: tag.id } })).count).toBe(0);
    await expect(B().tag.create({ data: { businessId: ids.firmA, name: 'x' } })).rejects.toThrow(
      /row-level security/i,
    );
    await expect(
      B().tag.create({ data: { businessId: ids.firmB, name: 'x', createdByUserId: ids.staffA } }),
    ).rejects.toThrow(/foreign key/i);
    // Firm B tagging its own client with firm A's tag, or firm A's client with its own tag.
    await expect(
      B().clientTag.create({
        data: { businessId: ids.firmB, clientId: ids.clientB, tagId: tag.id },
      }),
    ).rejects.toThrow(/foreign key/i);
    const own = await B().tag.create({ data: { businessId: ids.firmB, name: 'Own' } });
    await expect(
      B().clientTag.create({
        data: { businessId: ids.firmB, clientId: ids.client, tagId: own.id },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('tags', () => {
  it('have a short one-line name, unique among the firm’s live tags ignoring case', async () => {
    const name = `Back Taxes ${run}`;
    await newTag(name);
    await expect(newTag(` ${name.toUpperCase()} `)).rejects.toThrow(/Unique/i);
    for (const bad of [' ', 'x'.repeat(51), 'a\nb']) {
      await expect(newTag(bad)).rejects.toThrow(/tags_name/);
    }
    // Once archived, the name is free again.
    const old = await newTag(`Old ${run}`);
    await A().tag.update({ where: { id: old.id }, data: { archivedAt: new Date() } });
    await expect(newTag(`old ${run}`)).resolves.toBeTruthy();
  });

  it('are archived for good, never deleted, and an archived tag is not applied', async () => {
    const tag = await newTag();
    await A().tag.update({ where: { id: tag.id }, data: { archivedAt: new Date() } });
    await expect(
      A().tag.update({ where: { id: tag.id }, data: { archivedAt: null } }),
    ).rejects.toThrow(/stays archived/);
    await expect(A().tag.delete({ where: { id: tag.id } })).rejects.toThrow(/permission denied/);
    await expect(tagClient(tag.id)).rejects.toThrow(/archived tag cannot be applied/);
  });

  it('a client has a tag once; taking it off deletes the row', async () => {
    const tag = await newTag();
    await tagClient(tag.id, ids.client, { addedByUserId: ids.staffA });
    await expect(tagClient(tag.id)).rejects.toThrow(/Unique/i);
    await expect(
      A().clientTag.delete({ where: { clientId_tagId: { clientId: ids.client, tagId: tag.id } } }),
    ).resolves.toBeTruthy();
    await expect(tagClient(tag.id)).resolves.toBeTruthy();
  });
});

describe('client county', () => {
  const profile = (clientId: string, data: Record<string, unknown> = {}) =>
    A().clientProfile.upsert({
      where: { clientId },
      update: data,
      create: { clientId, businessId: ids.firmA, ...data },
    });

  it('county is a short line', async () => {
    for (const county of [' ', 'x'.repeat(101), 'a\nb']) {
      await expect(profile(ids.client, { county })).rejects.toThrow(/client_profiles_county/);
    }
    await expect(profile(ids.client, { county: 'Gwinnett' })).resolves.toMatchObject({
      county: 'Gwinnett',
    });
  });
});
