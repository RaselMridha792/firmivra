// End-to-end: R55, Templates (contract in packages/types/src/templates): the library with its
// tabs and visibility (own, team, selected people), create/change with versions and the etag, the
// automation impact check, archive/restore/duplicate/favourites/bulk, preview with sample and live
// data, import, starter templates, categories, merge fields, Branding & Letterhead and
// attachments. Firm B never reads or changes firm A's, and a foreign id in a body answers as an
// unknown one. Every change is audited with ids and field names, never text.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  BulkTemplatesResult,
  DownloadLink,
  ImportTemplateResult,
  InstallStartersResult,
  MergeField,
  MergeFieldList,
  MessageTemplateDetail as DetailShape,
  MessageTemplatePage,
  OkResponse,
  RenderedTemplate,
  StarterTemplatesStatus,
  TemplateAttachment,
  TemplateBranding,
  TemplateCategory,
  TemplateStructureOptions,
  TemplateCategoryList,
  TemplatesSummary,
  TemplateVersion,
  TemplateVersionList,
  UploadPutTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { BUILT_IN_FIELDS } from '../../src/templates/merge-fields.js';
import { STARTERS } from '../../src/templates/template-starters.js';

// Strict, so a leaked field (businessId, an internal id) fails.
const Detail = z.strictObject(DetailShape.shape);
type Detail = z.infer<typeof Detail>;

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      method: 'PUT' as const,
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  completeUpload() {
    return Promise.resolve('MISSING' as const);
  }
  abortUpload() {
    return Promise.resolve();
  }
  head(key: string) {
    const b = this.objects.get(key);
    return Promise.resolve(
      b ? { sizeBytes: b.length, sha256: sha256(b), contentEncoding: null } : null,
    );
  }
  read(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
  put(ticket: UploadPutTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();
const config: { -readonly [K in keyof DocumentsConfig]: DocumentsConfig[K] } = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'guardduty',
};

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55m-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'c1' | 'c2' | 'cB', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.54.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
async function call(
  method: Method,
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

const detail = (res: Response, status = 200): Detail => Detail.parse(ok(res, status));
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;
const make = (body: object = {}, who: Who = people.ownerA, firm: 'a' | 'b' = 'a') =>
  call(
    'post',
    '/templates',
    who,
    { kind: 'EMAIL', name: mark('Tpl'), body: '<p>Hello [Client First Name]</p>', ...body },
    firm,
  ).then((r) => detail(r, 201));
const getT = (id: string, who: Who = people.ownerA) =>
  call('get', `/templates/${id}`, who).then((r) => detail(r));
const patchT = (id: string, body: object, who: Who = people.ownerA) =>
  call('patch', `/templates/${id}`, who, body);

const auditActions = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R55m ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55m-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.adminA.id, 'ADMIN'],
    ['a', people.staffA.id, 'STAFF'],
    ['a', people.staffA2.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  for (const [firm, key, name, assigned] of [
    ['a', 'c1', 'Jamie Sample', people.staffA.id],
    ['a', 'c2', 'Riley Example', people.staffA2.id],
    ['b', 'cB', 'Pat Other', null],
  ] as const) {
    await inFirm(firm, async (tx) => {
      clients[key] = (
        await tx.client.create({
          data: {
            businessId: firms[firm],
            displayName: `${name} (fake)`,
            email: `${key.toLowerCase()}-${run}@client.test`,
            assignedUserId: assigned,
          },
          select: { id: true },
        })
      ).id;
    });
  }
  await inFirm('a', (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firms.a,
        userId: people.clientA.id,
        email: people.clientA.email,
        clientId: clients.c1,
        status: 'ACTIVE',
      },
    }),
  );

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue(config)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('creating and reading', () => {
  it('saves a draft: sanitized, versioned, its fields listed, the author the owner', async () => {
    const t = await make({
      body: '<p>Hi [Client First Name], see [Nope Field]</p><script>alert(1)</script>',
      subject: 'About [Tax Year]',
      tags: ['tax', 'welcome'],
    });
    expect(t).toMatchObject({
      status: 'DRAFT',
      access: 'TEAM',
      version: 1,
      starter: false,
      favorite: false,
      useCount: 0,
      automationCount: 0,
      owner: { userId: people.ownerA.id },
      tags: ['tax', 'welcome'],
    });
    expect(t.body).not.toMatch(/script|alert/i);
    expect(t.mergeFields.used).toEqual(['Tax Year', 'Client First Name', 'Nope Field']);
    expect(t.mergeFields.unknown).toEqual(['Nope Field']);
    const same = await getT(t.id, people.staffA);
    expect(same.id).toBe(t.id);
    expect(same.etag).toBe(t.etag);
    const audit = await auditActions(t.id);
    expect(audit.map((a) => a.action)).toEqual(['message_template.created']);
    expect(JSON.stringify(audit)).not.toMatch(/Hello|Nope Field|alert/);
  });

  it('an SMS is plain text', async () => {
    const t = await make({ kind: 'SMS', body: '<b>Hi</b> [Client First Name]' });
    expect(t.body).toBe('Hi [Client First Name]');
  });

  it('refuses what the rules refuse', async () => {
    const name = mark('Rules');
    await make({ name });
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'EMAIL',
        name: name.toUpperCase(),
        body: 'x',
      }),
      409,
      'DUPLICATE_NAME',
    );
    // The same name in another kind is fine.
    await make({ name, kind: 'SMS' });
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'EMAIL',
        name: mark('A'),
        body: 'x',
        status: 'ACTIVE',
      }),
      400,
      'SUBJECT_REQUIRED',
    );
    // TP-F11: a draft may keep Include in Automations, dormant; a kind automations can't use can't.
    expect(
      detail(
        await call('post', '/templates', people.ownerA, {
          kind: 'EMAIL',
          name: mark('B'),
          body: 'x',
          includeInAutomations: true,
        }),
        201,
      ),
    ).toMatchObject({ status: 'DRAFT', includeInAutomations: true });
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'LETTER_NOTICE',
        name: mark('C'),
        body: 'x',
        subject: 's',
        status: 'ACTIVE',
        includeInAutomations: true,
      }),
      409,
      'NOT_AUTOMATION_ELIGIBLE',
    );
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'EMAIL',
        name: mark('D'),
        body: 'x',
        sharedWithUserIds: [people.staffA.id],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'EMAIL',
        name: mark('E'),
        body: 'x',
        businessId: firms.b,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'EMAIL',
        name: mark('F'),
        body: 'x\u0000y',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/templates', people.clientA, { kind: 'EMAIL', name: 'X', body: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(await call('get', '/templates', undefined), 401, 'UNAUTHENTICATED');
  });

  it('a foreign or unknown category or person in a body is refused the same way', async () => {
    const foreign = TemplateCategory.parse(
      ok(
        await call(
          'post',
          '/template-categories',
          people.ownerB,
          { kind: 'EMAIL', name: mark('B cat') },
          'b',
        ),
        201,
      ),
    );
    const own = TemplateCategory.parse(
      ok(
        await call('post', '/template-categories', people.ownerA, {
          kind: 'SMS',
          name: mark('SMS cat'),
        }),
        201,
      ),
    );
    for (const categoryId of [foreign.id, randomUUID(), own.id]) {
      expectError(
        await call('post', '/templates', people.ownerA, {
          kind: 'EMAIL',
          name: mark('Cat'),
          body: 'x',
          categoryId,
        }),
        409,
        'CATEGORY_NOT_ALLOWED',
      );
    }
    for (const userId of [people.ownerB.id, randomUUID()]) {
      expectError(
        await call('post', '/templates', people.ownerA, {
          kind: 'EMAIL',
          name: mark('Share'),
          body: 'x',
          access: 'SELECTED',
          sharedWithUserIds: [userId],
        }),
        409,
        'NOT_A_MEMBER',
      );
    }
  });
});

describe('who sees what', () => {
  it('private is the owner’s (and the Owner’s and Admin’s); team and selected reach the right people', async () => {
    const priv = await make({ access: 'PRIVATE' }, people.staffA);
    const team = await make({ access: 'TEAM' }, people.staffA);
    const sel = await make(
      { access: 'SELECTED', sharedWithUserIds: [people.staffA2.id] },
      people.staffA,
    );
    expect(sel.sharedWith.map((m) => m.userId)).toEqual([people.staffA2.id]);

    expectError(await call('get', `/templates/${priv.id}`, people.staffA2), 404, 'NOT_FOUND');
    expect((await call('get', `/templates/${priv.id}`, people.adminA)).status).toBe(200);
    expect((await call('get', `/templates/${priv.id}`, people.ownerA)).status).toBe(200);
    expect((await call('get', `/templates/${team.id}`, people.staffA2)).status).toBe(200);
    expect((await call('get', `/templates/${sel.id}`, people.staffA2)).status).toBe(200);
    expectError(
      await call('get', `/templates/${priv.id}`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );

    const ids = (page: z.infer<typeof MessageTemplatePage>) => page.items.map((i) => i.id);
    const staff2 = MessageTemplatePage.parse(
      ok(await call('get', '/templates?tab=all&pageSize=100', people.staffA2)),
    );
    expect(ids(staff2)).toEqual(expect.arrayContaining([team.id, sel.id]));
    expect(ids(staff2)).not.toContain(priv.id);
    const shared = MessageTemplatePage.parse(
      ok(await call('get', '/templates?tab=shared&pageSize=100', people.staffA2)),
    );
    expect(ids(shared)).toEqual(expect.arrayContaining([team.id, sel.id]));
    const mine = MessageTemplatePage.parse(
      ok(await call('get', '/templates?tab=mine&pageSize=100', people.staffA)),
    );
    expect(ids(mine)).toEqual(expect.arrayContaining([priv.id, team.id, sel.id]));
  });

  it('only the owner, an Owner or Admin changes a private or selected template; anyone a team one', async () => {
    const sel = await make(
      { access: 'SELECTED', sharedWithUserIds: [people.staffA2.id] },
      people.staffA,
    );
    const res = await patchT(sel.id, { etag: sel.etag, description: 'x' }, people.staffA2);
    expectError(res, 403, 'NOT_THE_OWNER');
    expectError(
      await call('put', `/templates/${sel.id}/shares`, people.staffA2, { userIds: [] }),
      403,
      'NOT_THE_OWNER',
    );
    expect(
      (await patchT(sel.id, { etag: sel.etag, description: 'by admin' }, people.adminA)).status,
    ).toBe(200);

    const team = await make({ access: 'TEAM' }, people.staffA);
    expect(
      (await patchT(team.id, { etag: team.etag, description: 'by a colleague' }, people.staffA2))
        .status,
    ).toBe(200);
    // A colleague may not change who sees a team template.
    const fresh = await getT(team.id);
    expectError(
      await patchT(team.id, { etag: fresh.etag, access: 'PRIVATE' }, people.staffA2),
      403,
      'NOT_THE_OWNER',
    );
  });

  it('sharing sets SELECTED and the people; members only', async () => {
    const t = await make({}, people.staffA);
    const shared = detail(
      await call('put', `/templates/${t.id}/shares`, people.staffA, {
        userIds: [people.staffA2.id, people.adminA.id],
      }),
    );
    expect(shared.access).toBe('SELECTED');
    expect(shared.sharedWith.map((m) => m.userId).sort()).toEqual(
      [people.staffA2.id, people.adminA.id].sort(),
    );
    expectError(
      await call('put', `/templates/${t.id}/shares`, people.staffA, {
        userIds: [people.ownerB.id],
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('put', `/templates/${randomUUID()}/shares`, people.staffA, { userIds: [] }),
      404,
      'NOT_FOUND',
    );
    // Back to the team: the list of people goes.
    const back = detail(await patchT(t.id, { etag: shared.etag, access: 'TEAM' }, people.staffA));
    expect(back.sharedWith).toEqual([]);
  });
});

describe('changes, versions and the etag', () => {
  it('a change of text adds a version; other fields do not; a stale etag is a conflict', async () => {
    const t = await make({ body: '<p>First</p>' });
    const tagged = detail(await patchT(t.id, { etag: t.etag, tags: ['a'], description: 'About' }));
    expect(tagged).toMatchObject({ version: 1, tags: ['a'], description: 'About' });
    expect(tagged.etag).not.toBe(t.etag);
    expectError(await patchT(t.id, { etag: t.etag, tags: ['b'] }), 409, 'SAVE_CONFLICT');

    const v2 = detail(await patchT(t.id, { etag: tagged.etag, body: '<p>Second</p>' }));
    expect(v2.version).toBe(2);
    const v3 = detail(await patchT(t.id, { etag: v2.etag, name: mark('Renamed') }));
    expect(v3.version).toBe(3);

    const versions = TemplateVersionList.parse(
      ok(await call('get', `/templates/${t.id}/versions`, people.ownerA)),
    );
    expect(versions.items.map((v) => v.version)).toEqual([3, 2, 1]);
    const first = TemplateVersion.parse(
      ok(await call('get', `/templates/${t.id}/versions/1`, people.ownerA)),
    );
    expect(first.body).toBe('<p>First</p>');
    expectError(
      await call('get', `/templates/${t.id}/versions/9`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/templates/${t.id}/versions/0`, people.ownerA),
      400,
      'VALIDATION_FAILED',
    );

    const restored = detail(
      await call('post', `/templates/${t.id}/versions/1/restore`, people.ownerA),
    );
    expect(restored).toMatchObject({ version: 4, body: '<p>First</p>' });
    const actions = (await auditActions(t.id)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['message_template.updated', 'message_template.version_restored']),
    );
  });

  it('refuses an empty change, unknown fields, a missing etag and a change to an archived template', async () => {
    const t = await make();
    expectError(await patchT(t.id, { etag: t.etag }), 400, 'VALIDATION_FAILED');
    expectError(await patchT(t.id, { description: 'x' }), 400, 'VALIDATION_FAILED');
    expectError(await patchT(t.id, { etag: t.etag, kind: 'SMS' }), 400, 'VALIDATION_FAILED');
    expectError(await patchT(randomUUID(), { etag: 'x', description: 'x' }), 404, 'NOT_FOUND');
    const archived = detail(await call('post', `/templates/${t.id}/archive`, people.ownerA, {}));
    expect(archived.status).toBe('ARCHIVED');
    expectError(
      await patchT(t.id, { etag: archived.etag, description: 'x' }),
      409,
      'TEMPLATE_ARCHIVED',
    );
  });

  it('Owner and Admin activate; Staff save drafts and keep editing an active one (CM-F12)', async () => {
    expectError(
      await call('post', '/templates', people.staffA, {
        kind: 'EMAIL',
        name: mark('Staff active'),
        subject: 'S',
        body: 'x',
        status: 'ACTIVE',
      }),
      403,
      'ACTIVATE_NOT_ALLOWED',
    );
    const t = await make({ subject: 'S', access: 'TEAM' }, people.staffA);
    expectError(
      await patchT(t.id, { etag: t.etag, status: 'ACTIVE' }, people.staffA),
      403,
      'ACTIVATE_NOT_ALLOWED',
    );
    const active = detail(await patchT(t.id, { etag: t.etag, status: 'ACTIVE' }, people.adminA));
    expect(active.status).toBe('ACTIVE');
    // Staff still change the words of the active template, which stays active.
    const edited = detail(
      await patchT(t.id, { etag: active.etag, subject: 'Better subject' }, people.staffA),
    );
    expect(edited).toMatchObject({ status: 'ACTIVE', subject: 'Better subject' });
  });

  it('an active email needs a subject; as a draft its automation choice stays, unused (TP-F11)', async () => {
    const t = await make({ subject: 'Hello' });
    const active = detail(
      await patchT(t.id, { etag: t.etag, status: 'ACTIVE', includeInAutomations: true }),
    );
    expect(active).toMatchObject({ status: 'ACTIVE', includeInAutomations: true });
    expectError(await patchT(t.id, { etag: active.etag, subject: null }), 400, 'SUBJECT_REQUIRED');
    // Active with Include in Automations on, set to Draft in one save: allowed, the choice kept.
    const draft = detail(
      await patchT(t.id, { etag: active.etag, status: 'DRAFT', includeInAutomations: true }),
    );
    expect(draft).toMatchObject({ status: 'DRAFT', includeInAutomations: true });
    // What automations are offered (the rule builder's list) leaves it out while it is a draft.
    const offered = async () =>
      MessageTemplatePage.parse(
        ok(
          await call(
            'get',
            '/templates?tab=all&kind=EMAIL&status=ACTIVE&automations=true&pageSize=100',
            people.ownerA,
          ),
        ),
      ).items.map((i) => i.id);
    expect(await offered()).not.toContain(t.id);
    detail(await patchT(t.id, { etag: draft.etag, status: 'ACTIVE' }));
    expect(await offered()).toContain(t.id);
  });

  it('previews the unsaved words in place of the saved ones, and saves nothing (TP-F04)', async () => {
    const t = await make({ subject: 'Saved subject', body: '<p>Saved words</p>' });
    const shown = RenderedTemplate.parse(
      ok(
        await call('post', `/templates/${t.id}/preview`, people.ownerA, {
          draft: {
            subject: 'Unsaved subject',
            body: '<p>Unsaved words for [Client First Name]</p><script>x()</script>',
          },
        }),
      ),
    );
    expect(shown.subject).toBe('Unsaved subject');
    expect(shown.body).toContain('Unsaved words for');
    expect(shown.body).not.toContain('Saved words');
    expect(shown.body).not.toContain('<script');
    const after = await getT(t.id);
    expect(after).toMatchObject({ subject: 'Saved subject', version: t.version });
    expect(after.body).toContain('Saved words');
  });
});

describe('automations that use a template', () => {
  it('ask to confirm a disruptive change or an archive', async () => {
    const t = await make({ subject: 'S', status: 'ACTIVE', includeInAutomations: true });
    await inFirm('a', async (tx) => {
      const rule = await tx.automationRule.create({
        data: { businessId: firms.a, name: mark('Rule'), category: 'CLIENTS' },
      });
      const v = await tx.automationRuleVersion.create({
        data: {
          businessId: firms.a,
          ruleId: rule.id,
          version: 1,
          triggerModule: 'CLIENTS',
          triggerEvent: 'client.created',
          actions: [{ id: 'a1', type: 'SEND_EMAIL', templateId: t.id }],
        },
      });
      await tx.automationRule.update({
        where: { id: rule.id },
        data: { status: 'ACTIVE', currentVersionId: v.id },
      });
    });
    const used = await getT(t.id);
    expect(used.automationCount).toBe(1);
    expectError(
      await patchT(t.id, { etag: used.etag, body: '<p>Changed</p>' }),
      409,
      'AUTOMATION_IN_USE',
    );
    // A small edit that does not touch the text goes through.
    const tagged = detail(await patchT(t.id, { etag: used.etag, tags: ['x'] }));
    expectError(
      await call('post', `/templates/${t.id}/archive`, people.ownerA, {}),
      409,
      'AUTOMATION_IN_USE',
    );
    const changed = detail(
      await patchT(t.id, {
        etag: tagged.etag,
        body: '<p>Changed</p>',
        confirmAutomationImpact: true,
      }),
    );
    expect(changed.version).toBe(2);
    const archived = detail(
      await call('post', `/templates/${t.id}/archive`, people.ownerA, {
        confirmAutomationImpact: true,
      }),
    );
    expect(archived).toMatchObject({ status: 'ARCHIVED', includeInAutomations: false });
  });
});

describe('archive, restore, duplicate, favourites', () => {
  it('archives and restores (as a draft), repeating is harmless, nothing is deleted', async () => {
    const t = await make();
    const a1 = detail(await call('post', `/templates/${t.id}/archive`, people.ownerA, {}));
    const a2 = detail(await call('post', `/templates/${t.id}/archive`, people.ownerA, {}));
    expect(a1.status).toBe('ARCHIVED');
    expect(a2.etag).toBe(a1.etag);
    const hidden = MessageTemplatePage.parse(
      ok(await call('get', '/templates?pageSize=100', people.ownerA)),
    );
    expect(hidden.items.map((i) => i.id)).not.toContain(t.id);
    const withArchived = MessageTemplatePage.parse(
      ok(await call('get', '/templates?status=ARCHIVED&pageSize=100', people.ownerA)),
    );
    expect(withArchived.items.map((i) => i.id)).toContain(t.id);
    const back = detail(await call('post', `/templates/${t.id}/restore`, people.ownerA));
    expect(back.status).toBe('DRAFT');
    expect((await auditActions(t.id)).map((a) => a.action)).toEqual([
      'message_template.created',
      'message_template.archived',
      'message_template.restored',
    ]);
    expectError(
      await call('post', `/templates/${t.id}/archive`, people.ownerB, {}, 'b'),
      404,
      'NOT_FOUND',
    );
  });

  it('duplicates as a private draft copy with a free name', async () => {
    const t = await make({ subject: 'S', status: 'ACTIVE', tags: ['x'], access: 'TEAM' });
    const copy = detail(await call('post', `/templates/${t.id}/duplicate`, people.staffA), 201);
    const copy2 = detail(await call('post', `/templates/${t.id}/duplicate`, people.staffA), 201);
    expect(copy).toMatchObject({
      name: `${t.name} (Copy)`,
      status: 'DRAFT',
      access: 'PRIVATE',
      version: 1,
      tags: ['x'],
      owner: { userId: people.staffA.id },
      starter: false,
    });
    expect(copy2.name).toBe(`${t.name} (Copy 2)`);
    expect(copy.id).not.toBe(t.id);
  });

  it('a favourite is the caller’s own', async () => {
    const t = await make();
    const fav = detail(await call('put', `/templates/${t.id}/favorite`, people.staffA));
    expect(fav.favorite).toBe(true);
    detail(await call('put', `/templates/${t.id}/favorite`, people.staffA));
    expect((await getT(t.id, people.staffA2)).favorite).toBe(false);
    const list = MessageTemplatePage.parse(
      ok(await call('get', '/templates?tab=favorites&pageSize=100', people.staffA)),
    );
    expect(list.items.map((i) => i.id)).toContain(t.id);
    const off = detail(await call('delete', `/templates/${t.id}/favorite`, people.staffA));
    expect(off.favorite).toBe(false);
    expectError(
      await call('put', `/templates/${randomUUID()}/favorite`, people.staffA),
      404,
      'NOT_FOUND',
    );
  });
});

describe('the library', () => {
  it('filters, searches, sorts and pages; the summary counts what the caller may see', async () => {
    const tag = `lib${run}`;
    const names = [mark('Alpha'), mark('Bravo'), mark('Charlie')];
    for (const [i, name] of names.entries())
      await make({ name, tags: [tag], subject: i === 0 ? `Subject ${tag}` : null });
    const q = async (query: string, who: Who = people.ownerA) =>
      MessageTemplatePage.parse(ok(await call('get', `/templates?${query}`, who)));
    const byTag = await q(`tag=${tag}&sort=name&direction=asc&pageSize=2`);
    expect(byTag.total).toBe(3);
    expect(byTag.items.map((i) => i.name)).toEqual(names.slice(0, 2));
    expect(
      (await q(`tag=${tag}&sort=name&direction=desc&pageSize=2&page=2`)).items.map((i) => i.name),
    ).toEqual([names[0]]);
    expect((await q(`search=Subject ${tag}`)).total).toBe(1);
    expect((await q(`tag=${tag}&kind=SMS`)).total).toBe(0);
    expect((await q(`tag=${tag}&status=ACTIVE`)).total).toBe(0);
    expectError(
      await call('get', '/templates?pageSize=101', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', '/templates?sort=bogus', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );

    const summary = TemplatesSummary.parse(
      ok(await call('get', '/templates/summary', people.staffA2)),
    );
    expect(summary.total).toBeGreaterThanOrEqual(3);
    expect(summary.recent.length).toBeLessThanOrEqual(5);
    expect(summary.uncategorized.find((u) => u.kind === 'EMAIL')?.templateCount).toBeGreaterThan(0);
    // Firm B sees none of firm A's.
    const other = TemplatesSummary.parse(
      ok(await call('get', '/templates/summary', people.ownerB, undefined, 'b')),
    );
    expect(other.recent.some((r) => names.includes(r.name))).toBe(false);
  });

  it('Uncategorized lists only the templates in no category, so the counts add up (TP-F03)', async () => {
    const tag = `unc${run}`;
    const cat = TemplateCategory.parse(
      ok(
        await call('post', '/template-categories', people.ownerA, {
          kind: 'EMAIL',
          name: mark('Filed'),
        }),
        201,
      ),
    );
    const filed = await make({ tags: [tag], categoryId: cat.id });
    const loose = await make({ tags: [tag] });
    const q = async (query: string) =>
      MessageTemplatePage.parse(ok(await call('get', `/templates?${query}`, people.ownerA)));
    const none = await q(`tag=${tag}&uncategorized=true`);
    expect(none.items.map((i) => i.id)).toEqual([loose.id]);
    expect((await q(`tag=${tag}&categoryId=${cat.id}`)).items.map((i) => i.id)).toEqual([filed.id]);
    expect((await q(`tag=${tag}`)).total).toBe(2);
    expectError(
      await call('get', '/templates?uncategorized=maybe', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('bulk actions', () => {
  it('archives, categorises and tags; skips what it can’t change; 404 when nothing is found', async () => {
    const mine = await make({}, people.staffA);
    const priv = await make({ access: 'PRIVATE' }, people.staffA);
    const team = await make({ access: 'TEAM' }, people.ownerA);
    const cat = TemplateCategory.parse(
      ok(
        await call('post', '/template-categories', people.ownerA, {
          kind: 'EMAIL',
          name: mark('Bulk'),
        }),
        201,
      ),
    );
    const ids = [mine.id, priv.id, team.id, randomUUID()];

    const tagged = BulkTemplatesResult.parse(
      ok(
        await call('post', '/templates/bulk', people.staffA, {
          action: 'ADD_TAG',
          ids,
          tag: 'bulk',
        }),
      ),
    );
    // staffA owns two; the team template is anyone's; the random id is not found.
    expect(tagged.updated).toBe(3);
    expect(tagged.skipped.map((s) => s.reason)).toEqual(['NOT_FOUND']);
    const again = BulkTemplatesResult.parse(
      ok(
        await call('post', '/templates/bulk', people.staffA, {
          action: 'ADD_TAG',
          ids: [mine.id],
          tag: 'BULK',
        }),
      ),
    );
    expect(again).toMatchObject({
      updated: 0,
      skipped: [{ id: mine.id, reason: 'ALREADY_TAGGED' }],
    });
    const untagged = BulkTemplatesResult.parse(
      ok(
        await call('post', '/templates/bulk', people.staffA, {
          action: 'REMOVE_TAG',
          ids: [mine.id],
          tag: 'bulk',
        }),
      ),
    );
    expect(untagged.updated).toBe(1);

    const set = BulkTemplatesResult.parse(
      ok(
        await call('post', '/templates/bulk', people.ownerA, {
          action: 'SET_CATEGORY',
          ids: [mine.id, team.id],
          categoryId: cat.id,
        }),
      ),
    );
    expect(set.updated).toBe(2);
    expectError(
      await call('post', '/templates/bulk', people.ownerA, {
        action: 'SET_CATEGORY',
        ids: [mine.id],
        categoryId: randomUUID(),
      }),
      409,
      'CATEGORY_NOT_ALLOWED',
    );

    const archived = BulkTemplatesResult.parse(
      ok(
        await call('post', '/templates/bulk', people.ownerA, {
          action: 'ARCHIVE',
          ids: [mine.id, priv.id],
          confirm: true,
        }),
      ),
    );
    expect(archived.updated).toBe(2);
    expect((await getT(priv.id)).status).toBe('ARCHIVED');
    expectError(
      await call('post', '/templates/bulk', people.ownerA, { action: 'ARCHIVE', ids: [mine.id] }),
      400,
      'VALIDATION_FAILED',
    );
    // Firm B's ids are not found, as random ones.
    expectError(
      await call(
        'post',
        '/templates/bulk',
        people.ownerB,
        { action: 'ADD_TAG', ids: [mine.id, priv.id], tag: 'x' },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/templates/bulk', people.ownerA, {
        action: 'ADD_TAG',
        ids: [randomUUID()],
        tag: 'x',
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('preview and test send', () => {
  it('renders sample data, then a client’s own; unresolved fields are listed; values are never markup', async () => {
    const t = await make({
      subject: 'For [Client First Name] at [Business Name]',
      body: '<p>Dear [Client Full Name], [Appointment Date], [Referral Code], [Tax Year]</p>',
    });
    await call('post', '/template-merge-fields', people.ownerA, {
      key: 'Referral Code',
      label: 'Referral code',
      fallback: 'ABC123',
    });
    const sample = RenderedTemplate.parse(
      ok(await call('post', `/templates/${t.id}/preview`, people.ownerA, {})),
    );
    expect(sample.sample).toBe(true);
    expect(sample.body).toContain('Jamie Sample');
    expect(sample.body).toContain('ABC123');
    expect(sample.unresolved).toEqual([]);

    const live = RenderedTemplate.parse(
      ok(
        await call('post', `/templates/${t.id}/preview`, people.ownerA, {
          clientId: clients.c1,
          sample: { 'Tax Year': '<b>2025</b>' },
        }),
      ),
    );
    expect(live.sample).toBe(false);
    expect(live.subject).toContain('Firm r55m-a');
    expect(live.body).toContain('Jamie Sample (fake)');
    expect(live.body).toContain('&lt;b&gt;2025&lt;/b&gt;');
    expect(live.body).not.toContain('<b>2025');
    expect(live.unresolved).toEqual(['Appointment Date']);
    const audit = await auditActions(t.id);
    expect(audit.some((a) => a.action === 'message_template.previewed')).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/Jamie/);

    const sms = await make({ kind: 'SMS', body: 'Hi [Client First Name]' });
    expect(
      RenderedTemplate.parse(
        ok(await call('post', `/templates/${sms.id}/preview`, people.ownerA, {})),
      ).sms,
    ).toEqual({ characters: 8, parts: 1 });
  });

  it('a client or record of another firm, or out of Staff’s reach, is not found', async () => {
    const t = await make();
    for (const clientId of [clients.cB, randomUUID()]) {
      expectError(
        await call('post', `/templates/${t.id}/preview`, people.ownerA, { clientId }),
        404,
        'NOT_FOUND',
      );
    }
    // Staff reach only their own clients.
    expectError(
      await call('post', `/templates/${t.id}/preview`, people.staffA, { clientId: clients.c2 }),
      404,
      'NOT_FOUND',
    );
    expect(
      (await call('post', `/templates/${t.id}/preview`, people.staffA, { clientId: clients.c1 }))
        .status,
    ).toBe(200);
    for (const key of ['appointmentId', 'invoiceId', 'taskId']) {
      expectError(
        await call('post', `/templates/${t.id}/preview`, people.ownerA, { [key]: randomUUID() }),
        404,
        'NOT_FOUND',
      );
    }
    expectError(
      await call('post', `/templates/${t.id}/preview`, people.ownerB, {}, 'b'),
      404,
      'NOT_FOUND',
    );
  });

  it('a test goes only to the caller’s own address; the sending is not available yet', async () => {
    const t = await make();
    expectError(
      await call('post', `/templates/${t.id}/test-send`, people.ownerA, {
        channel: 'EMAIL',
        toEmail: 'someone@else.test',
      }),
      400,
      'TEST_SEND_REFUSED',
    );
    expectError(
      await call('post', `/templates/${t.id}/test-send`, people.ownerA, {
        channel: 'SMS',
        toPhone: '+15550001111',
      }),
      400,
      'TEST_SEND_REFUSED',
    );
    expectError(
      await call('post', `/templates/${t.id}/test-send`, people.ownerA, {
        channel: 'EMAIL',
        toEmail: people.ownerA.email,
      }),
      503,
      'TEST_SEND_UNAVAILABLE',
    );
    expectError(
      await call('post', `/templates/${t.id}/test-send`, people.ownerA, { channel: 'EMAIL' }),
      503,
      'TEST_SEND_UNAVAILABLE',
    );
    expectError(
      await call('post', `/templates/${randomUUID()}/test-send`, people.ownerA, {
        channel: 'EMAIL',
      }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('import', () => {
  it('makes a private draft from HTML or text, sanitized, and counts what it removed', async () => {
    const html = ImportTemplateResult.parse(
      ok(
        await call('post', '/templates/import', people.staffA, {
          kind: 'LETTER_NOTICE',
          name: mark('Imp'),
          format: 'HTML',
          content:
            '<h2>Notice</h2><p onclick="x()">Hello</p><script>alert(1)</script><a href="javascript:alert(1)">go</a>',
        }),
        201,
      ),
    );
    Detail.parse(html.template);
    expect(html.template).toMatchObject({
      status: 'DRAFT',
      access: 'PRIVATE',
      owner: { userId: people.staffA.id },
    });
    expect(html.template.body).not.toMatch(/script|onclick|javascript/i);
    expect(html.removed).toBeGreaterThanOrEqual(3);
    const text = ImportTemplateResult.parse(
      ok(
        await call('post', '/templates/import', people.staffA, {
          kind: 'EMAIL',
          name: mark('Txt'),
          format: 'TEXT',
          content: 'Line one\nstill one <b>\n\nSecond paragraph',
        }),
        201,
      ),
    );
    expect(text.template.body).toBe(
      '<p>Line one<br />still one &lt;b&gt;</p><p>Second paragraph</p>',
    );
    expect(text.removed).toBe(0);
    expectError(
      await call('post', '/templates/import', people.staffA, {
        kind: 'EMAIL',
        name: 'X',
        format: 'DOCX',
        content: 'x',
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('a Word document becomes a private draft, sanitized, and the file is never kept (TP-F16)', async () => {
    // A synthetic .docx: a heading, bold merge fields, a script as words, an https and a javascript: link.
    const docx = readFileSync(new URL('../fixtures/import-sample.docx', import.meta.url));
    const facts = {
      fileName: 'welcome.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: docx.length,
      sha256: sha256(docx),
    };
    const upload = async (who: Who = people.staffA) => {
      const ticket = UploadPutTicket.parse(
        ok(await call('post', '/templates/import/uploads', who, facts), 201),
      );
      expect(ticket.url).toContain(`tenant/${firms.a}/template-imports/`);
      storage.put(ticket, docx);
      return ticket;
    };
    const ticket = await upload();
    // Firm B's member and another member of firm A can't use the ticket.
    expectError(
      await call(
        'post',
        '/templates/import',
        people.ownerB,
        { kind: 'EMAIL', name: 'X', format: 'DOCX', uploadToken: ticket.uploadToken },
        'b',
      ),
      410,
      'UPLOAD_EXPIRED',
    );
    const imported = ImportTemplateResult.parse(
      ok(
        await call('post', '/templates/import', people.staffA, {
          kind: 'EMAIL',
          name: mark('Welcome'),
          format: 'DOCX',
          uploadToken: ticket.uploadToken,
        }),
        201,
      ),
    );
    const t = imported.template;
    expect(t).toMatchObject({ status: 'DRAFT', access: 'PRIVATE', includeInAutomations: false });
    expect(t.body).toContain('<h1>Welcome Letter (fake)</h1>');
    expect(t.body).toContain('<strong>[Business Name]</strong>');
    expect(t.body).toContain('&lt;script&gt;');
    expect(t.body).not.toContain('<script');
    expect(t.body).toContain('href="https://portal.example.test/upload"');
    expect(t.body).not.toContain('javascript:');
    // The Word document is gone from storage, and the ticket can't be used again.
    expect([...storage.objects.keys()].some((k) => k.includes('/template-imports/'))).toBe(false);
    expectError(
      await call('post', '/templates/import', people.staffA, {
        kind: 'EMAIL',
        name: 'Again',
        format: 'DOCX',
        uploadToken: ticket.uploadToken,
      }),
      410,
      'UPLOAD_EXPIRED',
    );
    expect((await auditActions(t.id)).map((a) => a.metadata)).toContainEqual(
      expect.objectContaining({ format: 'DOCX' }),
    );

    // Rich kinds only: an SMS is refused, and its upload is deleted too.
    const sms = await upload();
    expectError(
      await call('post', '/templates/import', people.staffA, {
        kind: 'SMS',
        name: 'X',
        format: 'DOCX',
        uploadToken: sms.uploadToken,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect([...storage.objects.keys()].some((k) => k.includes('/template-imports/'))).toBe(false);
    // Not a .docx name, or over 10 MB, is refused at the ticket.
    expectError(
      await call('post', '/templates/import/uploads', people.staffA, {
        ...facts,
        fileName: 'welcome.pdf',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/templates/import/uploads', people.staffA, {
        ...facts,
        sizeBytes: 10 * 1024 * 1024 + 1,
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

/** TP-F18: the developer guide's section 8, name by name, with its kind and category. */
const GUIDE: [string, string, string][] = [
  ['New Client Welcome Email', 'EMAIL', 'Email / Client Communication'],
  ['Existing Client Welcome Back', 'EMAIL', 'Email / Client Communication'],
  ['Missing Documents Follow-Up', 'EMAIL', 'Email / Client Communication'],
  ['Document Received Confirmation', 'EMAIL', 'Email / Client Communication'],
  ['General Client Follow-Up', 'EMAIL', 'Email / Client Communication'],
  ['Client Portal Invitation', 'EMAIL', 'Email / Client Communication'],
  ['Tax Season Opening Announcement', 'EMAIL', 'Tax Season'],
  ['Tax Organizer Ready', 'EMAIL', 'Tax Season'],
  ['Tax Appointment Preparation', 'EMAIL', 'Tax Season'],
  ['Tax Documents Still Needed', 'EMAIL', 'Tax Season'],
  ['Tax Return Ready for Review', 'EMAIL', 'Tax Season'],
  ['Tax Return Signature Request', 'EMAIL', 'Tax Season'],
  ['Tax Return Filed Confirmation', 'EMAIL', 'Tax Season'],
  ['Extension Filed Confirmation', 'EMAIL', 'Tax Season'],
  ['Estimated Tax Payment Reminder', 'EMAIL', 'Tax Season'],
  ['Appointment Confirmation', 'APPOINTMENT', 'Appointments'],
  ['Appointment Reminder — 24 Hours', 'APPOINTMENT', 'Appointments'],
  ['Appointment Reminder — 1 Hour', 'APPOINTMENT', 'Appointments'],
  ['Appointment Rescheduled', 'APPOINTMENT', 'Appointments'],
  ['Missed Appointment / No-Show Follow-Up', 'APPOINTMENT', 'Appointments'],
  ['Post-Appointment Follow-Up', 'APPOINTMENT', 'Appointments'],
  ['Invoice Issued', 'INVOICE_PAYMENT', 'Invoices & Payments'],
  ['Payment Due Soon', 'INVOICE_PAYMENT', 'Invoices & Payments'],
  ['Payment Overdue — First Notice', 'INVOICE_PAYMENT', 'Invoices & Payments'],
  ['Payment Overdue — Final Reminder', 'INVOICE_PAYMENT', 'Invoices & Payments'],
  ['Payment Received / Receipt', 'INVOICE_PAYMENT', 'Invoices & Payments'],
  ['Monthly Bookkeeping Document Request', 'BOOKKEEPING', 'Bookkeeping'],
  ['Bookkeeping Records Missing', 'BOOKKEEPING', 'Bookkeeping'],
  ['Monthly Books Completed', 'BOOKKEEPING', 'Bookkeeping'],
  ['Quarterly Bookkeeping Review', 'BOOKKEEPING', 'Bookkeeping'],
  ['Year-End Bookkeeping Checklist', 'BOOKKEEPING', 'Bookkeeping'],
  ['Payroll Information Reminder', 'PAYROLL', 'Payroll'],
  ['Payroll Completed Notification', 'PAYROLL', 'Payroll'],
  ['Payroll Document / Employee Info Request', 'PAYROLL', 'Payroll'],
  ['New Lead First Response', 'LEAD_FOLLOW_UP', 'Leads'],
  ['Lead Follow-Up — No Response', 'LEAD_FOLLOW_UP', 'Leads'],
  ['Consultation Reminder', 'LEAD_FOLLOW_UP', 'Leads'],
  ['Post-Consultation Follow-Up', 'LEAD_FOLLOW_UP', 'Leads'],
  ['Engagement Agreement Sent', 'ENGAGEMENT_AGREEMENT', 'Engagement / Documents'],
  ['Engagement Agreement Reminder', 'ENGAGEMENT_AGREEMENT', 'Engagement / Documents'],
  ['Document Signature Request', 'EMAIL', 'Engagement / Documents'],
  ['Secure Document Upload Request', 'DOCUMENT_REQUEST', 'Engagement / Documents'],
  ['New Portal Message Notification', 'PORTAL_MESSAGE', 'Portal / Notices'],
  ['Important Client Notice', 'LETTER_NOTICE', 'Portal / Notices'],
  ['Monthly Tax & Business Newsletter', 'CAMPAIGN', 'Marketing / Campaign'],
  ['Tax Deadline Reminder Campaign', 'CAMPAIGN', 'Marketing / Campaign'],
  ['Service Announcement / New Service', 'CAMPAIGN', 'Marketing / Campaign'],
  ['Standard Client Follow-Up Task Checklist', 'TASK', 'Internal / Workflow'],
];

describe('starter templates', () => {
  it('are the guide’s 48, name by name, with nothing written in that merge fields supply (TP-F18)', () => {
    expect(STARTERS.map((s) => [s.name, s.kind, s.category])).toEqual(GUIDE);
    expect(new Set(STARTERS.map((s) => s.key)).size).toBe(48);
    for (const s of STARTERS) {
      const words = `${s.subject ?? ''} ${s.body}`;
      // No year, amount, phone number or link written in.
      expect(words, s.name).not.toMatch(/\b20\d\d\b|\$\s?\d|\(\d{3}\)|https?:\/\//);
      // Every [field] is one the templates know.
      for (const [, field] of words.matchAll(/\[([^\]]+)\]/g)) {
        expect(
          BUILT_IN_FIELDS.map((f) => f.key),
          `${s.name}: [${field}]`,
        ).toContain(field);
      }
    }
  });

  it('are 48, install once, and are editable afterwards', async () => {
    // A firm's own template, or a starter of the earlier list, leaves all 48 to add (TP-F18: the
    // screen offered them only to a firm with no templates at all).
    const own = await make({ name: mark('Own') });
    await inFirm('a', (tx) =>
      tx.messageTemplate.update({ where: { id: own.id }, data: { starterKey: 'email-thank-you' } }),
    );
    const before = StarterTemplatesStatus.parse(
      ok(await call('get', '/templates/starters', people.staffA)),
    );
    expect(before).toEqual({ available: 48, installed: 0 });
    expectError(await call('post', '/templates/starters', people.staffA), 403, 'FORBIDDEN');
    const first = InstallStartersResult.parse(
      ok(await call('post', '/templates/starters', people.adminA)),
    );
    expect(first).toEqual({ installed: 48, alreadyThere: 0 });
    const second = InstallStartersResult.parse(
      ok(await call('post', '/templates/starters', people.ownerA)),
    );
    expect(second).toEqual({ installed: 0, alreadyThere: 48 });
    expect(
      StarterTemplatesStatus.parse(ok(await call('get', '/templates/starters', people.staffA)))
        .installed,
    ).toBe(48);

    const list = MessageTemplatePage.parse(
      ok(await call('get', '/templates?search=New Client Welcome&pageSize=100', people.staffA)),
    );
    const welcome = list.items.find((i) => i.name === 'New Client Welcome Email');
    expect(welcome).toMatchObject({ starter: true, status: 'ACTIVE', access: 'TEAM' });
    expect(welcome?.category?.name).toBe('Email / Client Communication');
    expect((await getT(welcome!.id)).description).toBe(
      'Welcome, portal access, next steps and contact information.',
    );
    const edited = await patchT(
      welcome!.id,
      { etag: (await getT(welcome!.id)).etag, subject: 'Hello there' },
      people.staffA2,
    );
    expect(edited.status).toBe(200);
    // Firm B has none.
    expect(
      StarterTemplatesStatus.parse(
        ok(await call('get', '/templates/starters', people.ownerB, undefined, 'b')),
      ).installed,
    ).toBe(0);
  });
});

describe('structures (TP-F08)', () => {
  const ids = {} as Record<'task' | 'taskB' | 'docs' | 'intake', string>;
  let serviceName = '';
  beforeAll(async () => {
    await inFirm('a', async (tx) => {
      ids.task = (
        await tx.taskTemplate.create({
          data: {
            businessId: firms.a,
            name: mark('Onboarding'),
            checklist: [
              { label: 'Confirm the details', required: true },
              { label: 'Open the file', required: false },
            ],
          },
        })
      ).id;
      ids.docs = (
        await tx.documentRequestTemplate.create({
          data: {
            businessId: firms.a,
            name: mark('Tax documents'),
            items: {
              create: [
                { title: 'W-2 forms', required: true, sortOrder: 0 },
                { title: 'Receipts', required: false, sortOrder: 1 },
              ],
            },
          },
        })
      ).id;
      serviceName = mark('Tax prep');
      const service = await tx.service.create({
        data: { businessId: firms.a, kind: 'ANNUAL_TAX', name: serviceName },
      });
      ids.intake = (
        await tx.intakeTemplate.create({ data: { businessId: firms.a, serviceId: service.id } })
      ).id;
    });
    await inFirm('b', async (tx) => {
      ids.taskB = (
        await tx.taskTemplate.create({ data: { businessId: firms.b, name: mark('Firm B task') } })
      ).id;
    });
  });
  const link = (
    id: string,
    moduleTemplateId: string | null,
    etag: string,
    who: Who = people.ownerA,
  ) => call('put', `/templates/${id}/linked-template`, who, { moduleTemplateId, etag });

  it('a Task, Document Request or Intake template stands for one of the firm’s own, and only one', async () => {
    const t = await make({ kind: 'TASK', body: 'Follow the checklist' });
    const linked = detail(await link(t.id, ids.task, t.etag));
    expect(linked.linkedTemplate).toMatchObject({
      kind: 'TASK',
      id: ids.task,
      steps: ['Confirm the details', 'Open the file'],
    });
    // The text and its version stay as they were.
    expect(linked.version).toBe(t.version);
    expect(linked.linkedTemplateId).toBe(ids.task);
    // The list row carries it too: its Use starts a task from that task template (part 2).
    const rows = MessageTemplatePage.parse(
      ok(
        await call(
          'get',
          `/templates?kind=TASK&search=${encodeURIComponent(t.name)}`,
          people.ownerA,
        ),
      ),
    );
    expect(rows.items.find((r) => r.id === t.id)?.linkedTemplateId).toBe(ids.task);
    // One library template stands for each task template.
    const other = await make({ kind: 'TASK', body: 'Another' });
    expectError(await link(other.id, ids.task, other.etag), 409, 'STRUCTURE_IN_USE');
    // Another firm's is not found, never told apart from none.
    expectError(await link(other.id, ids.taskB, other.etag), 404, 'NOT_FOUND');
    expectError(await link(other.id, randomUUID(), other.etag), 404, 'NOT_FOUND');
    // Only those three kinds stand for one; a stale version is refused.
    const email = await make({ subject: 'S' });
    expectError(await link(email.id, ids.task, email.etag), 400, 'VALIDATION_FAILED');
    expectError(await link(other.id, null, 'stale'), 409, 'SAVE_CONFLICT');

    const options = TemplateStructureOptions.parse(
      ok(await call('get', '/templates/structure-options?kind=TASK', people.staffA)),
    );
    expect(options.items.find((o) => o.id === ids.task)?.usedByTemplateId).toBe(t.id);
    expect(options.items.map((o) => o.id)).not.toContain(ids.taskB);

    const docs = await make({ kind: 'DOCUMENT_REQUEST', body: 'Please upload these' });
    expect(detail(await link(docs.id, ids.docs, docs.etag)).linkedTemplate?.steps).toEqual([
      'W-2 forms',
      'Receipts (optional)',
    ]);
    const intake = await make({ kind: 'INTAKE_ORGANIZER', body: 'Please complete it' });
    expect(detail(await link(intake.id, ids.intake, intake.etag)).linkedTemplate?.name).toBe(
      `${serviceName} intake`,
    );
    // Cleared, the task template is free again.
    const cleared = detail(await link(t.id, null, linked.etag));
    expect(cleared.linkedTemplate).toBeNull();
    expect(cleared.linkedTemplateId).toBeNull();
    expect(detail(await link(other.id, ids.task, other.etag)).linkedTemplate?.id).toBe(ids.task);
    expect((await auditActions(t.id)).map((a) => a.action)).toContain('message_template.linked');
  });

  it('Tax Workflow and Bookkeeping keep a structure of their shape; each change is a version that keeps it', async () => {
    const structure = { sections: [{ title: 'Income', items: ['W-2s', '1099s'] }] };
    const t = await make({ kind: 'TAX_WORKFLOW', body: 'Our workflow', structure });
    expect(t.structure).toEqual(structure);
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'TAX_WORKFLOW',
        name: mark('Empty'),
        body: 'x',
        structure: { sections: [] },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'EMAIL',
        name: mark('Not here'),
        body: 'x',
        structure,
      }),
      400,
      'VALIDATION_FAILED',
    );

    const changed = { sections: [...structure.sections, { title: 'Review', items: ['Sign'] }] };
    const v2 = detail(await patchT(t.id, { etag: t.etag, structure: changed }));
    expect(v2).toMatchObject({ version: 2, structure: changed });
    const kept = await inFirm('a', (tx) =>
      tx.messageTemplateVersion.findMany({
        where: { templateId: t.id },
        orderBy: { version: 'asc' },
        select: { structure: true },
      }),
    );
    expect(kept.map((v) => v.structure)).toEqual([structure, changed]);
    // Restoring version 1 brings its structure back; a copy carries the structure.
    const restored = detail(
      await call('post', `/templates/${t.id}/versions/1/restore`, people.ownerA),
    );
    expect(restored.structure).toEqual(structure);
    const copy = detail(await call('post', `/templates/${t.id}/duplicate`, people.ownerA), 201);
    expect(copy.structure).toEqual(structure);

    const books = {
      documentRequests: [{ title: 'Bank statements', frequency: 'MONTHLY' }],
      closeChecklist: ['Reconcile the accounts'],
      clientUpdates: ['Your books are up to date'],
    };
    expect(
      (await make({ kind: 'BOOKKEEPING', body: 'Monthly', structure: books })).structure,
    ).toEqual(books);
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'BOOKKEEPING',
        name: mark('Nothing'),
        body: 'x',
        structure: { documentRequests: [], closeChecklist: [], clientUpdates: [] },
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('categories', () => {
  it('everyone reads; Owner and Admin add, rename, reorder, merge, archive and restore', async () => {
    const a = TemplateCategory.parse(
      ok(
        await call('post', '/template-categories', people.ownerA, {
          kind: 'SMS',
          name: mark('One'),
        }),
        201,
      ),
    );
    const b = TemplateCategory.parse(
      ok(
        await call('post', '/template-categories', people.adminA, {
          kind: 'SMS',
          name: mark('Two'),
          description: 'Second',
        }),
        201,
      ),
    );
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    expectError(
      await call('post', '/template-categories', people.adminA, {
        kind: 'SMS',
        name: a.name.toUpperCase(),
      }),
      409,
      'DUPLICATE_NAME',
    );
    // The same name in another kind is fine.
    ok(
      await call('post', '/template-categories', people.adminA, { kind: 'EMAIL', name: a.name }),
      201,
    );
    expectError(
      await call('post', '/template-categories', people.staffA, { kind: 'SMS', name: 'X' }),
      403,
      'FORBIDDEN',
    );

    const listed = TemplateCategoryList.parse(
      ok(await call('get', '/template-categories?kind=SMS', people.staffA)),
    );
    expect(listed.items.map((c) => c.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    const renamed = TemplateCategory.parse(
      ok(
        await call('put', `/template-categories/${a.id}`, people.ownerA, { name: mark('Renamed') }),
      ),
    );
    expect(renamed.id).toBe(a.id);
    expectError(
      await call('put', `/template-categories/${a.id}`, people.ownerA, { name: b.name }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('put', `/template-categories/${randomUUID()}`, people.ownerA, { name: 'X' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('put', `/template-categories/${a.id}`, people.ownerB, { name: 'X' }, 'b'),
      404,
      'NOT_FOUND',
    );

    const order = TemplateCategoryList.parse(
      ok(
        await call('put', '/template-categories/order', people.ownerA, {
          kind: 'SMS',
          ids: [b.id, a.id],
        }),
      ),
    );
    const sms = order.items.filter((c) => [a.id, b.id].includes(c.id)).map((c) => c.id);
    expect(sms).toEqual([b.id, a.id]);
    expectError(
      await call('put', '/template-categories/order', people.ownerA, {
        kind: 'SMS',
        ids: [b.id, b.id],
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('put', '/template-categories/order', people.ownerA, {
        kind: 'EMAIL',
        ids: [a.id],
      }),
      404,
      'NOT_FOUND',
    );

    const t = await make({ kind: 'SMS', body: 'x', categoryId: a.id });
    expect(t.category?.id).toBe(a.id);
    const merged = TemplateCategory.parse(
      ok(await call('post', `/template-categories/${a.id}/merge`, people.ownerA, { intoId: b.id })),
    );
    expect(merged).toMatchObject({ id: b.id });
    expect((await getT(t.id)).category?.id).toBe(b.id);
    const list2 = TemplateCategoryList.parse(
      ok(await call('get', '/template-categories?kind=SMS&includeArchived=true', people.ownerA)),
    );
    expect(list2.items.find((c) => c.id === a.id)?.archivedAt).not.toBeNull();
    expectError(
      await call('post', `/template-categories/${b.id}/merge`, people.ownerA, { intoId: a.id }),
      409,
      'CATEGORY_NOT_ALLOWED',
    );
    expectError(
      await call('post', `/template-categories/${b.id}/merge`, people.ownerA, { intoId: b.id }),
      409,
      'CATEGORY_NOT_ALLOWED',
    );
    // An archived category can't take a template; restoring it can.
    expectError(
      await call('post', '/templates', people.ownerA, {
        kind: 'SMS',
        name: mark('Arch'),
        body: 'x',
        categoryId: a.id,
      }),
      409,
      'CATEGORY_NOT_ALLOWED',
    );
    expect(
      TemplateCategory.parse(
        ok(await call('post', `/template-categories/${a.id}/restore`, people.ownerA)),
      ).archivedAt,
    ).toBeNull();
    expect(
      TemplateCategory.parse(
        ok(await call('post', `/template-categories/${b.id}/archive`, people.adminA)),
      ).archivedAt,
    ).not.toBeNull();
  });
});

describe('merge fields and branding', () => {
  it('lists the built-in and custom fields; Owner and Admin add, change and delete custom ones', async () => {
    const key = `Code${run.replace(/[^a-z]/gi, 'x')}`;
    const made = MergeField.parse(
      ok(
        await call('post', '/template-merge-fields', people.ownerA, {
          key,
          label: 'Code',
          fallback: 'none',
        }),
        201,
      ),
    );
    expect(made).toMatchObject({ token: `[${key}]`, group: 'CUSTOM', fallback: 'none' });
    expectError(
      await call('post', '/template-merge-fields', people.ownerA, {
        key: key.toLowerCase(),
        label: 'Dup',
      }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/template-merge-fields', people.ownerA, {
        key: 'client first name',
        label: 'Clash',
      }),
      409,
      'FIELD_IN_USE',
    );
    expectError(
      await call('post', '/template-merge-fields', people.staffA, { key: 'Other', label: 'X' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/template-merge-fields', people.ownerA, { key: 'Bad]', label: 'X' }),
      400,
      'VALIDATION_FAILED',
    );

    const asStaff = MergeFieldList.parse(
      ok(await call('get', '/template-merge-fields', people.staffA)),
    );
    expect(asStaff.items.some((f) => f.key === 'Client First Name')).toBe(true);
    expect(asStaff.items.some((f) => f.key === 'Balance Due')).toBe(false);
    expect(asStaff.items.some((f) => f.customId === made.customId)).toBe(true);
    const asOwnerList = MergeFieldList.parse(
      ok(await call('get', '/template-merge-fields', people.ownerA)),
    );
    expect(asOwnerList.items.some((f) => f.key === 'Balance Due' && f.sensitive)).toBe(true);

    const updated = MergeField.parse(
      ok(
        await call('put', `/template-merge-fields/${made.customId}`, people.adminA, {
          key,
          label: 'Code, renamed',
        }),
      ),
    );
    expect(updated.label).toBe('Code, renamed');
    const user = await make({ body: `<p>[${key}]</p>` });
    expect(user.mergeFields.unknown).toEqual([]);
    expectError(
      await call('put', `/template-merge-fields/${made.customId}`, people.adminA, {
        key: `${key}Z`,
        label: 'x',
      }),
      409,
      'FIELD_IN_USE',
    );
    expectError(
      await call('delete', `/template-merge-fields/${made.customId}`, people.ownerA),
      409,
      'FIELD_IN_USE',
    );
    await call('post', `/templates/${user.id}/archive`, people.ownerA, {});
    ok(await call('delete', `/template-merge-fields/${made.customId}`, people.ownerA));
    OkResponse.parse({ ok: true });
    expectError(
      await call('delete', `/template-merge-fields/${made.customId}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('delete', `/template-merge-fields/${randomUUID()}`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
  });

  it('branding: defaults, then saved by Owner or Admin, text only', async () => {
    const before = TemplateBranding.parse(
      ok(await call('get', '/template-branding', people.staffA)),
    );
    expect(before).toMatchObject({
      footerText: null,
      letterheadEnabled: true,
      updatedAt: null,
      businessName: `Firm r55m-a-${run}`,
    });
    expectError(
      await call('put', '/template-branding', people.staffA, { footerText: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('put', '/template-branding', people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    const saved = TemplateBranding.parse(
      ok(
        await call('put', '/template-branding', people.adminA, {
          footerText: '<b>Thanks</b>',
          letterheadEnabled: false,
        }),
      ),
    );
    expect(saved).toMatchObject({ footerText: 'Thanks', letterheadEnabled: false });
    expect(saved.updatedAt).not.toBeNull();
    const cleared = TemplateBranding.parse(
      ok(await call('put', '/template-branding', people.ownerA, { footerText: null })),
    );
    expect(cleared).toMatchObject({ footerText: null, letterheadEnabled: false });
    // Firm B's branding is its own.
    expect(
      TemplateBranding.parse(
        ok(await call('get', '/template-branding', people.ownerB, undefined, 'b')),
      ).letterheadEnabled,
    ).toBe(true);
  });
});

describe('attachments', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
  const start = (id: string, bytes: Buffer, over: object = {}, who: Who = people.ownerA) =>
    call('post', `/templates/${id}/attachments/uploads`, who, {
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      ...over,
    });

  it('uploads in three steps, downloads and removes; the stored bytes are checked', async () => {
    const t = await make();
    const ticket = UploadPutTicket.parse(ok(await start(t.id, pdf)));
    storage.put(ticket, pdf);
    const confirmed = TemplateAttachment.parse(
      ok(
        await call('post', '/templates/attachments/uploads/confirm', people.ownerA, {
          uploadToken: ticket.uploadToken,
        }),
      ),
    );
    expect(confirmed).toMatchObject({ fileName: 'guide.pdf', sizeBytes: pdf.length });
    expect((await getT(t.id)).attachments.map((a) => a.id)).toEqual([confirmed.id]);
    // The same ticket can't be confirmed twice.
    expectError(
      await call('post', '/templates/attachments/uploads/confirm', people.ownerA, {
        uploadToken: ticket.uploadToken,
      }),
      410,
      'UPLOAD_EXPIRED',
    );

    const link = DownloadLink.parse(
      ok(
        await call('get', `/templates/${t.id}/attachments/${confirmed.id}/download`, people.staffA),
      ),
    );
    expect(link.url).toContain('?download');
    expectError(
      await call('get', `/templates/${t.id}/attachments/${randomUUID()}/download`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'get',
        `/templates/${t.id}/attachments/${confirmed.id}/download`,
        people.ownerB,
        undefined,
        'b',
      ),
      404,
      'NOT_FOUND',
    );

    expect(
      OkResponse.parse(
        ok(await call('delete', `/templates/${t.id}/attachments/${confirmed.id}`, people.ownerA)),
      ),
    ).toEqual({ ok: true });
    expect((await getT(t.id)).attachments).toEqual([]);
    expectError(
      await call('delete', `/templates/${t.id}/attachments/${confirmed.id}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
  });

  it('refuses a wrong type or name, a different file, someone else’s ticket and an archived template', async () => {
    const t = await make();
    expectError(await start(t.id, pdf, { contentType: 'text/html' }), 400, 'VALIDATION_FAILED');
    expectError(await start(t.id, pdf, { fileName: 'guide.docx' }), 400, 'VALIDATION_FAILED');
    expectError(await start(t.id, pdf, { sizeBytes: 11 * 1024 * 1024 }), 400, 'VALIDATION_FAILED');
    expectError(await start(randomUUID(), pdf), 404, 'NOT_FOUND');
    expectError(await start(t.id, pdf, {}, people.clientA), 403, 'FORBIDDEN');

    const wrong = UploadPutTicket.parse(ok(await start(t.id, pdf)));
    storage.put(wrong, Buffer.from('not the same bytes at all!!!!!!!!!'));
    expectError(
      await call('post', '/templates/attachments/uploads/confirm', people.ownerA, {
        uploadToken: wrong.uploadToken,
      }),
      409,
      'UPLOAD_MISMATCH',
    );
    // The refused object is deleted.
    expect([...storage.objects.keys()].some((k) => k === wrong.url.slice('memory:'.length))).toBe(
      false,
    );

    const notPdf = Buffer.from('this is plain text, not a pdf');
    const fake = UploadPutTicket.parse(ok(await start(t.id, notPdf)));
    storage.put(fake, notPdf);
    expectError(
      await call('post', '/templates/attachments/uploads/confirm', people.ownerA, {
        uploadToken: fake.uploadToken,
      }),
      409,
      'UPLOAD_MISMATCH',
    );

    const mine = UploadPutTicket.parse(ok(await start(t.id, pdf)));
    storage.put(mine, pdf);
    expectError(
      await call('post', '/templates/attachments/uploads/confirm', people.adminA, {
        uploadToken: mine.uploadToken,
      }),
      410,
      'UPLOAD_EXPIRED',
    );
    expectError(
      await call(
        'post',
        '/templates/attachments/uploads/confirm',
        people.ownerB,
        { uploadToken: mine.uploadToken },
        'b',
      ),
      410,
      'UPLOAD_EXPIRED',
    );
    expectError(
      await call('post', '/templates/attachments/uploads/confirm', people.ownerA, {
        uploadToken: 'nope',
      }),
      410,
      'UPLOAD_EXPIRED',
    );

    await call('post', `/templates/${t.id}/archive`, people.ownerA, {});
    expectError(await start(t.id, pdf), 409, 'TEMPLATE_ARCHIVED');
  });
});
