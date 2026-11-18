// End-to-end: Settings > Client Portal > Features, custom tabs (Client Portal Review One, CP-5d
// and CP-5e; guide 7.3 and 9.3). Owner and Admin add a tab that reuses document upload or business
// resources, name it, switch it, choose its audience among business clients (all, a tag, chosen
// clients) and archive it. The portal's menu lists it after the built-in tabs, only in a business
// portal and only to its audience. Every change is audited; another firm never sees or changes it.
// The upload through a tab is in documents-portal.e2e.test.ts. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  DEFAULT_PORTAL_LAYOUT,
  PortalCustomTab,
  PortalCustomTabList,
  PortalTabs,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const run = randomUUID().slice(0, 8);
/** A firm of this file only. */
const slug = `r1-custom-${run}`;
let firmId = '';
const person = (key: string) => ({ id: randomUUID(), email: `r1-custom-${key}-${run}@r1.test` });
const owner = person('owner');
const admin = person('admin');
const staff = person('staff');
/** Business clients: one with the tag, one without, one the firm chooses; and a Personal one. */
const tagged = person('tagged');
const untagged = person('untagged');
const chosen = person('chosen');
const personal = person('personal');
const ids = { tag: '', otherTag: '', tagged: '', untagged: '', chosen: '', personal: '' };
/** A client and a tag of another firm (also this file's own), never a target here. */
const foreign = { client: '', tag: '' };

async function asOwner<T>(work: Parameters<typeof runInScope<T>>[2]): Promise<T> {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(db, { kind: 'business', businessId: firmId }, work);
  } finally {
    await db.$disconnect();
  }
}

beforeAll(async () => {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const firm = await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [u, pool] of [
      [owner, 'STAFF'],
      [admin, 'STAFF'],
      [staff, 'STAFF'],
      [tagged, 'CLIENT'],
      [untagged, 'CLIENT'],
      [chosen, 'CLIENT'],
      [personal, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R1 custom' },
      });
    }
    return tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } });
  });
  firmId = firm.id;
  const otherSlug = `r1-custom-other-${run}`;
  const other = await runInScope(db, { kind: 'platform' }, (tx) =>
    tx.business.create({ data: { slug: otherSlug, name: otherSlug, status: 'ACTIVE' } }),
  );
  await runInScope(db, { kind: 'business', businessId: other.id }, async (tx) => {
    const data = { businessId: other.id };
    foreign.client = (
      await tx.client.create({
        data: { ...data, displayName: 'Fake foreign client', accountType: 'BUSINESS' },
      })
    ).id;
    foreign.tag = (await tx.tag.create({ data: { ...data, name: 'Fake foreign' } })).id;
  });
  await db.$disconnect();
  await asOwner(async (tx) => {
    for (const [u, role] of [
      [owner, 'OWNER'],
      [admin, 'ADMIN'],
      [staff, 'STAFF'],
    ] as const) {
      await tx.membership.create({
        data: { businessId: firmId, userId: u.id, role, status: 'ACTIVE' },
      });
    }
    for (const [key, u, accountType] of [
      ['tagged', tagged, 'BUSINESS'],
      ['untagged', untagged, 'BUSINESS'],
      ['chosen', chosen, 'BUSINESS'],
      ['personal', personal, 'INDIVIDUAL'],
    ] as const) {
      const c = await tx.client.create({
        data: { businessId: firmId, displayName: `Fake ${key} client`, accountType },
      });
      ids[key] = c.id;
      await tx.clientAccount.create({
        data: {
          businessId: firmId,
          userId: u.id,
          clientId: c.id,
          email: u.email,
          status: 'ACTIVE',
        },
      });
    }
    ids.tag = (await tx.tag.create({ data: { businessId: firmId, name: 'Fake payroll' } })).id;
    ids.otherTag = (await tx.tag.create({ data: { businessId: firmId, name: 'Fake other' } })).id;
    await tx.clientTag.create({
      data: { businessId: firmId, clientId: ids.tagged, tagId: ids.tag },
    });
    // The personal client has the tag too: a Personal portal still lists no custom tab.
    await tx.clientTag.create({
      data: { businessId: firmId, clientId: ids.personal, tagId: ids.tag },
    });
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

/** One token per person: the dev token route allows 30 a minute. */
const tokens = new Map<string, string>();
async function tokenOf(email: string): Promise<string> {
  let token = tokens.get(email);
  if (!token) {
    const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email });
    token = (res.body as { token: string }).token;
    tokens.set(email, token);
  }
  return token;
}
async function send(
  method: 'get' | 'put' | 'post' | 'patch',
  path: string,
  who: { email: string },
  body?: object,
) {
  const token = await tokenOf(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}
const code = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const CUSTOM = '/business/settings/portal-tabs/custom';
const create = (who: { email: string }, body: object) => send('post', CUSTOM, who, body);
const created = async (body: object) => {
  const res = await create(owner, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return PortalCustomTab.parse(res.body);
};
/** The custom tabs a client's menu lists, by name. */
const menuOf = async (who: { email: string }) => {
  const res = await send('get', `/portal/${slug}/me/tabs`, who);
  expect(res.status).toBe(200);
  return PortalTabs.parse(res.body).custom.map((t) => t.label);
};
const auditOf = (action: string) =>
  asOwner((tx) =>
    tx.auditLog.findMany({
      where: { businessId: firmId, action },
      orderBy: { createdAt: 'asc' },
      select: { actorUserId: true, entityId: true, metadata: true },
    }),
  );

describe('Settings > Client Portal > Features: custom tabs (CP-5d, CP-5e)', () => {
  it('adds a tab for Owner and Admin only, with a name no other tab has, audited', async () => {
    expect((await create(staff, { label: 'Fake uploads', module: 'DOCUMENTS' })).status).toBe(403);
    expect((await send('get', CUSTOM, staff)).status).toBe(403);
    expect((await create(tagged, { label: 'Fake uploads', module: 'DOCUMENTS' })).status).toBe(403);
    for (const bad of [
      {},
      { label: 'Fake uploads', module: 'MESSAGES' },
      { label: '', module: 'DOCUMENTS' },
      { label: 'x'.repeat(41), module: 'DOCUMENTS' },
      { label: 'Two\nlines', module: 'DOCUMENTS' },
      // The audience and its targets agree.
      { label: 'Fake uploads', module: 'DOCUMENTS', audience: 'TAGS' },
      { label: 'Fake uploads', module: 'DOCUMENTS', audience: 'ALL', tagIds: [ids.tag] },
      { label: 'Fake uploads', module: 'DOCUMENTS', audience: 'CLIENTS', tagIds: [ids.tag] },
      { label: 'Fake uploads', module: 'DOCUMENTS', businessId: randomUUID() },
    ]) {
      expect(code(await create(owner, bad)), JSON.stringify(bad)).toBe('VALIDATION_FAILED');
    }
    // A built-in tab's name, ignoring case.
    expect(code(await create(owner, { label: 'tax returns', module: 'DOCUMENTS' }))).toBe(
      'DUPLICATE_LABEL',
    );

    const tab = await created({ label: 'Fake uploads', module: 'DOCUMENTS' });
    expect(tab).toMatchObject({
      label: 'Fake uploads',
      module: 'DOCUMENTS',
      enabled: true,
      audience: 'ALL',
      tagIds: [],
      clients: [],
    });
    expect(
      code(await create(admin, { label: ' FAKE UPLOADS ', module: 'BUSINESS_RESOURCES' })),
    ).toBe('DUPLICATE_LABEL');
    // Renaming a built-in tab to it is refused too.
    const layout = DEFAULT_PORTAL_LAYOUT.map((i) => ({
      tab: i.tab,
      label: i.tab === 'MESSAGES' ? 'Fake Uploads' : null,
    }));
    const clash = await send('put', '/business/settings/portal-tabs', owner, { layout });
    expect([clash.status, code(clash)]).toEqual([409, 'DUPLICATE_LABEL']);

    const list = PortalCustomTabList.parse((await send('get', CUSTOM, admin)).body);
    expect(list.items.map((t) => t.id)).toEqual([tab.id]);
    expect(await auditOf('portal.custom_tab_created')).toEqual([
      {
        actorUserId: owner.id,
        entityId: tab.id,
        metadata: { module: 'DOCUMENTS', audience: 'ALL', tags: 0, clients: 0 },
      },
    ]);
    // The firm's own view of the built-in tabs lists no custom one.
    const firm = PortalTabs.parse(
      (await send('get', '/business/settings/portal-tabs', owner)).body,
    );
    expect(firm.custom).toEqual([]);
  });

  it('lists a tab only to its audience, only in a business portal, after the built-in tabs', async () => {
    await created({
      label: 'Fake payroll files',
      module: 'DOCUMENTS',
      audience: 'TAGS',
      tagIds: [ids.tag],
    });
    const forOne = await created({
      label: 'Fake resources',
      module: 'BUSINESS_RESOURCES',
      audience: 'CLIENTS',
      clientIds: [ids.chosen],
    });
    expect(forOne.clients).toEqual([{ id: ids.chosen, name: 'Fake chosen client' }]);
    expect(await menuOf(tagged)).toEqual(['Fake uploads', 'Fake payroll files']);
    expect(await menuOf(untagged)).toEqual(['Fake uploads']);
    expect(await menuOf(chosen)).toEqual(['Fake uploads', 'Fake resources']);
    // CP-9.3: a Personal portal lists no custom tab, whatever its tags.
    expect(await menuOf(personal)).toEqual([]);
    const menu = PortalTabs.parse((await send('get', `/portal/${slug}/me/tabs`, chosen)).body);
    expect(menu.custom.find((t) => t.label === 'Fake resources')).toEqual({
      id: forOne.id,
      label: 'Fake resources',
      module: 'BUSINESS_RESOURCES',
    });
    // The custom tab's documents are refused to a client who doesn't see it, and for resources.
    const docs = (who: { email: string }, tabId: string) =>
      send('get', `/portal/${slug}/me/documents?portalTabId=${tabId}`, who);
    const [uploads] = PortalCustomTabList.parse((await send('get', CUSTOM, owner)).body).items;
    expect((await docs(untagged, uploads!.id)).status).toBe(200);
    expect(code(await docs(personal, uploads!.id))).toBe('NOT_FOUND');
    expect(code(await docs(chosen, forOne.id))).toBe('NOT_FOUND');
    expect(code(await docs(untagged, randomUUID()))).toBe('NOT_FOUND');
  });

  it('renames, switches and retargets a tab, audited; a tag or client of another firm is not found', async () => {
    const tab = await created({ label: 'Fake changes', module: 'DOCUMENTS' });
    const patch = (body: object, who = owner, id = tab.id) =>
      send('patch', `${CUSTOM}/${id}`, who, body);
    expect((await patch({ enabled: false }, staff)).status).toBe(403);
    expect(code(await patch({}))).toBe('VALIDATION_FAILED');
    expect(code(await patch({ module: 'BUSINESS_RESOURCES' }))).toBe('VALIDATION_FAILED');
    expect(code(await patch({ label: 'Fake Uploads' }))).toBe('DUPLICATE_LABEL');
    expect(code(await patch({ enabled: false }, owner, randomUUID()))).toBe('NOT_FOUND');
    expect((await patch({ enabled: false }, owner, 'not-an-id')).status).toBe(400);

    const renamed = PortalCustomTab.parse((await patch({ label: 'Fake changed' })).body);
    expect(renamed.label).toBe('Fake changed');
    // Its own name in other letters is fine.
    expect((await patch({ label: 'FAKE CHANGED' })).status).toBe(200);
    expect(await menuOf(untagged)).toContain('FAKE CHANGED');
    expect((await patch({ enabled: false }, admin)).status).toBe(200);
    expect(await menuOf(untagged)).not.toContain('FAKE CHANGED');
    const retarget = await patch({ enabled: true, audience: 'TAGS', tagIds: [ids.otherTag] });
    expect(PortalCustomTab.parse(retarget.body)).toMatchObject({
      audience: 'TAGS',
      tagIds: [ids.otherTag],
      clients: [],
    });
    expect(await menuOf(tagged)).not.toContain('FAKE CHANGED');
    // Another firm's tag or client, or an unknown one, is not found and changes nothing.
    expect(code(await patch({ audience: 'TAGS', tagIds: [randomUUID()] }))).toBe('NOT_FOUND');
    expect(code(await patch({ audience: 'TAGS', tagIds: [foreign.tag] }))).toBe('NOT_FOUND');
    expect(code(await patch({ audience: 'CLIENTS', clientIds: [foreign.client] }))).toBe(
      'NOT_FOUND',
    );
    // An archived tag is not a target either.
    const archivedTag = await asOwner(
      async (tx) =>
        (
          await tx.tag.create({
            data: { businessId: firmId, name: 'Fake archived', archivedAt: new Date() },
          })
        ).id,
    );
    expect(code(await patch({ audience: 'TAGS', tagIds: [archivedTag] }))).toBe('NOT_FOUND');
    const kept = PortalCustomTabList.parse((await send('get', CUSTOM, owner)).body).items.find(
      (t) => t.id === tab.id,
    );
    expect(kept).toMatchObject({ audience: 'TAGS', tagIds: [ids.otherTag] });
    expect(
      (await auditOf('portal.custom_tab_updated')).filter((l) => l.entityId === tab.id),
    ).toEqual([
      { actorUserId: owner.id, entityId: tab.id, metadata: { renamed: true } },
      { actorUserId: owner.id, entityId: tab.id, metadata: { renamed: true } },
      { actorUserId: admin.id, entityId: tab.id, metadata: { renamed: false, enabled: false } },
      {
        actorUserId: owner.id,
        entityId: tab.id,
        metadata: { renamed: false, enabled: true, audience: 'TAGS' },
      },
    ]);
  });

  it('archives a tab for good: gone from the list and the menu, its name free again', async () => {
    const tab = await created({ label: 'Fake archive me', module: 'DOCUMENTS' });
    const archive = (who: { email: string }, id = tab.id) =>
      send('post', `${CUSTOM}/${id}/archive`, who, {});
    expect((await archive(staff)).status).toBe(403);
    const after = await archive(admin);
    expect(after.status).toBe(200);
    expect(PortalCustomTabList.parse(after.body).items.map((t) => t.id)).not.toContain(tab.id);
    expect(await menuOf(untagged)).not.toContain('Fake archive me');
    expect(code(await archive(owner))).toBe('NOT_FOUND');
    expect(code(await send('patch', `${CUSTOM}/${tab.id}`, owner, { enabled: true }))).toBe(
      'NOT_FOUND',
    );
    expect((await auditOf('portal.custom_tab_archived')).map((l) => l.entityId)).toEqual([tab.id]);
    // Nothing is deleted: the row stays, archived.
    const row = await asOwner((tx) =>
      tx.portalTab.findUniqueOrThrow({ where: { id: tab.id }, select: { archivedAt: true } }),
    );
    expect(row.archivedAt).not.toBeNull();
    await created({ label: 'Fake archive me', module: 'BUSINESS_RESOURCES' });
  });

  it("keeps each firm's custom tabs its own", async () => {
    const [mine] = PortalCustomTabList.parse((await send('get', CUSTOM, owner)).body).items;
    // Another firm's Owner neither lists nor changes nor archives them.
    const other = PortalCustomTabList.parse((await send('get', CUSTOM, fx.users.ownerA)).body);
    expect(other.items.map((t) => t.id)).not.toContain(mine!.id);
    expect(
      code(await send('patch', `${CUSTOM}/${mine!.id}`, fx.users.ownerA, { enabled: false })),
    ).toBe('NOT_FOUND');
    expect(code(await send('post', `${CUSTOM}/${mine!.id}/archive`, fx.users.ownerA, {}))).toBe(
      'NOT_FOUND',
    );
    // Its client never sees this firm's menu or a tab's documents by id.
    expect((await send('get', `/portal/${slug}/me/tabs`, fx.users.clientA)).status).toBe(404);
    const byId = await send(
      'get',
      `/portal/${fx.firmA.slug}/me/documents?portalTabId=${mine!.id}`,
      fx.users.clientA,
    );
    expect(code(byId)).toBe('NOT_FOUND');
    // Nor is another firm's client a target here, and nothing is made.
    const before = PortalCustomTabList.parse((await send('get', CUSTOM, owner)).body).items.length;
    const refused = await create(owner, {
      label: 'Fake foreign',
      module: 'DOCUMENTS',
      audience: 'CLIENTS',
      clientIds: [foreign.client],
    });
    expect(code(refused)).toBe('NOT_FOUND');
    const now = PortalCustomTabList.parse((await send('get', CUSTOM, owner)).body).items.length;
    expect(now).toBe(before);
  });
});
