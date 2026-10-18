// End-to-end: R55, the Documents module part 2 (contract packages/types/src/documents/library.ts):
// Frame 5's sharing, the request templates and saved lists, and Frames 3 and 4's request packets
// (dashboard, Create Request, send, checklist items, reminders, complete, cancel, bulk). The
// client's portal never sees a draft's items; Staff reach their own clients; firm B sees nothing.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  BulkRequestPacketsResult,
  DocumentAccess,
  DocumentActivityList,
  DocumentShare,
  RequestPacketDetail,
  RequestPacketPage,
  RequestPacketSummary,
  RequestTemplate,
  RequestTemplateList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55q-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
  client: person('client'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
let app: INestApplication;
const tokens = new Map<string, string>();
const ids = {} as Record<string, string>;

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
  asOwner({ kind: 'business', businessId: firms[firm].id }, work);

async function tokenFor(who: Who) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email })
      .expect(200);
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  return token;
}
async function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm].id);
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who)}`);
  return body === undefined ? req : req.send(body);
}
const portalRequests = async () => {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/portal/${firms.a.slug}/me/document-requests`)
    .set('authorization', `Bearer ${await tokenFor(people.client)}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { items: { id: string; title: string }[] }).items;
};
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = <T>(res: Response, parse: { parse: (v: unknown) => T }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return parse.parse(res.body);
};
const future = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const { ownerA, adminA, staffA, ownerB } = people;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'client' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55q-${key}-${run}`;
      const b = await tx.business.create({
        data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
        select: { id: true },
      });
      firms[key] = { id: b.id, slug };
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', adminA.id, 'ADMIN'],
    ['a', staffA.id, 'STAFF'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({
        data: { businessId: firms[firm].id, userId, role, status: 'ACTIVE' },
      }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a.id;
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${run}`, status: 'ACTIVE' },
    });
    const client = async (key: string, name: string, engagements: number, assigned?: string) => {
      const c = await tx.client.create({
        data: {
          businessId,
          displayName: name,
          email: `${key}-${run}@c.test`,
          assignedUserId: assigned,
        },
      });
      ids[key] = c.id;
      for (let n = 0; n < engagements; n++) {
        const e = await tx.engagement.create({
          data: { businessId, clientId: c.id, serviceId: service.id, title: `${name} ${n}` },
        });
        ids[`${key}e${n}`] = e.id;
      }
    };
    await client('c1', 'Cora One (fake)', 1, staffA.id);
    await client('c2', 'Cal Two (fake)', 2);
    ids.login = (
      await tx.clientAccount.create({
        data: {
          businessId,
          userId: people.client.id,
          clientId: ids.c1!,
          email: people.client.email,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      })
    ).id;
    const doc = async (key: string, direction: 'FIRM_TO_CLIENT' | 'INTERNAL') => {
      const tag = randomUUID();
      const row = await tx.document.create({
        data: {
          businessId,
          clientId: ids.c1!,
          engagementId: ids.c1e0!,
          direction,
          fileName: `${key}.pdf`,
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: createHash('sha256').update(tag).digest('hex'),
          s3Key: `tenant/${businessId}/e2e/${tag}.pdf`,
        },
      });
      ids[key] = row.id;
    };
    await doc('shared', 'FIRM_TO_CLIENT');
    await doc('internal', 'INTERNAL');
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
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('sharing (Frame 5)', () => {
  it('grants, changes and revokes access, within the rules', async () => {
    const before = ok(await call('get', `/documents/${ids.shared}/access`, staffA), DocumentAccess);
    expect(before.shares).toEqual([]);
    expect(before.clientLogins).toEqual([
      { id: ids.login, name: 'Fake client', email: people.client.email, primary: true },
    ]);
    const s = ok(
      await call('post', `/documents/${ids.shared}/shares`, staffA, {
        recipient: { kind: 'CLIENT', clientAccountId: ids.login },
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      DocumentShare,
      201,
    );
    expect(s).toMatchObject({
      recipient: { kind: 'CLIENT', id: ids.login },
      canDownload: true,
      canUpload: false,
      grantedBy: { userId: staffA.id },
    });
    expectError(
      await call('post', `/documents/${ids.shared}/shares`, ownerA, {
        recipient: { kind: 'CLIENT', clientAccountId: ids.login },
      }),
      409,
      'SHARE_EXISTS',
    );
    expectError(
      await call('post', `/documents/${ids.internal}/shares`, ownerA, {
        recipient: { kind: 'CLIENT', clientAccountId: ids.login },
      }),
      409,
      'INTERNAL_DOCUMENT',
    );
    ok(
      await call('post', `/documents/${ids.internal}/shares`, ownerA, {
        recipient: { kind: 'MEMBER', userId: adminA.id },
      }),
      DocumentShare,
      201,
    );
    expectError(
      await call('post', `/documents/${ids.internal}/shares`, ownerA, {
        recipient: { kind: 'MEMBER', userId: ownerB.id },
      }),
      409,
      'NOT_A_MEMBER',
    );
    expect(
      (
        await call('post', `/documents/${ids.shared}/shares`, ownerA, {
          recipient: { kind: 'MEMBER', userId: adminA.id },
          expiresAt: '2020-01-01T00:00:00.000Z',
        })
      ).status,
    ).toBe(400);
    const changed = ok(
      await call('patch', `/documents/${ids.shared}/shares/${s.id}`, ownerA, { canUpload: true }),
      DocumentShare,
    );
    expect(changed.canUpload).toBe(true);
    ok(await call('post', `/documents/${ids.shared}/shares/${s.id}/revoke`, ownerA), {
      parse: (v) => v,
    });
    ok(await call('post', `/documents/${ids.shared}/shares/${s.id}/revoke`, ownerA), {
      parse: (v) => v,
    });
    expectError(
      await call('patch', `/documents/${ids.shared}/shares/${s.id}`, ownerA, { canSign: true }),
      409,
      'INVALID_STATUS',
    );
    expect(
      ok(await call('get', `/documents/${ids.shared}/access`, ownerA), DocumentAccess).shares,
    ).toEqual([]);
    const history = ok(
      await call('get', `/documents/${ids.shared}/access-history`, ownerA),
      DocumentActivityList,
    );
    expect(history.items.map((h) => h.kind)).toEqual(['SHARE_REVOKED', 'SHARE_CHANGED', 'SHARED']);
  });
});

describe('request templates and saved lists', () => {
  it('keeps firm types (MANAGE) and each member own lists', async () => {
    const mine = ok(
      await call('post', '/document-request-templates', staffA, {
        name: 'My W-2 list',
        items: [{ title: 'W-2' }, { title: '1099', required: false }],
      }),
      RequestTemplate,
      201,
    );
    expect(mine).toMatchObject({ owner: 'MINE' });
    expectError(
      await call('post', '/document-request-templates', staffA, {
        name: 'Firm type',
        owner: 'FIRM',
        items: [{ title: 'x' }],
      }),
      403,
      'FORBIDDEN',
    );
    const firm = ok(
      await call('post', '/document-request-templates', ownerA, {
        name: 'Personal Tax',
        owner: 'FIRM',
        items: [{ title: 'W-2' }, { title: 'Photo ID' }],
      }),
      RequestTemplate,
      201,
    );
    ids.template = firm.id;
    expectError(
      await call('post', '/document-request-templates', adminA, {
        name: 'Personal Tax',
        owner: 'FIRM',
        items: [{ title: 'x' }],
      }),
      409,
      'DUPLICATE_NAME',
    );
    const staffView = ok(
      await call('get', '/document-request-templates', staffA),
      RequestTemplateList,
    );
    expect(staffView.items.map((t) => t.name).sort()).toEqual(['My W-2 list', 'Personal Tax']);
    expect(
      ok(await call('get', '/document-request-templates?owner=MINE', ownerA), RequestTemplateList)
        .items,
    ).toEqual([]);
    expectError(
      await call('patch', `/document-request-templates/${mine.id}`, ownerA, { name: 'x' }),
      404,
      'NOT_FOUND',
    );
    const edited = ok(
      await call('patch', `/document-request-templates/${mine.id}`, staffA, {
        items: [{ title: 'Only one' }],
      }),
      RequestTemplate,
    );
    expect(edited.items.map((i) => i.title)).toEqual(['Only one']);
    expectError(
      await call('patch', `/document-request-templates/${firm.id}`, staffA, { name: 'x' }),
      403,
      'FORBIDDEN',
    );
    ok(await call('post', `/document-request-templates/${mine.id}/archive`, staffA), {
      parse: (v) => v,
    });
    expect(
      ok(await call('get', '/document-request-templates?owner=MINE', staffA), RequestTemplateList)
        .items,
    ).toEqual([]);
  });
});

describe('request packets', () => {
  it('creates a draft from a template, retry-safe, hidden from the portal', async () => {
    const key = randomUUID();
    const body = {
      idempotencyKey: key,
      clientId: ids.c1,
      title: '2025 tax documents',
      templateId: ids.template,
      items: [{ title: 'Bank statement', required: false }],
    };
    const draft = ok(
      await call('post', '/document-request-packets', staffA, body),
      RequestPacketDetail,
      201,
    );
    ids.packet = draft.id;
    expect(draft).toMatchObject({
      status: 'DRAFT',
      view: 'DRAFT',
      client: { id: ids.c1 },
      recipient: { kind: 'CLIENT' },
      items: { total: 3, required: 2, received: 0 },
      requestedBy: { userId: staffA.id },
    });
    expect(draft.reference).toMatch(/^DR-\d{4}$/);
    expect(draft.checklist.map((i) => i.title)).toEqual(['W-2', 'Photo ID', 'Bank statement']);
    expect(
      ok(await call('post', '/document-request-packets', staffA, body), RequestPacketDetail, 201)
        .id,
    ).toBe(draft.id);
    expect(await portalRequests()).toEqual([]);
    expectError(
      await call('post', '/document-request-packets', ownerA, {
        idempotencyKey: randomUUID(),
        clientId: ids.c1,
        title: 'For a member',
        recipient: { kind: 'MEMBER', userId: ownerB.id },
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('post', '/document-request-packets', ownerA, {
        idempotencyKey: randomUUID(),
        clientId: ids.c2,
        title: 'x',
      }),
      409,
      'NO_ENGAGEMENT',
    );
    expectError(
      await call('post', '/document-request-packets', staffA, {
        idempotencyKey: randomUUID(),
        clientId: ids.c2,
        serviceId: ids.c2e0,
        title: 'x',
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('edits the draft checklist, then sends it once complete', async () => {
    const id = ids.packet!;
    expectError(
      await call('post', `/document-request-packets/${id}/send`, ownerA),
      400,
      'REQUEST_INCOMPLETE',
    );
    let d = ok(
      await call('post', `/document-request-packets/${id}/items`, ownerA, {
        title: 'Prior return',
      }),
      RequestPacketDetail,
    );
    const [w2, photo, bank, prior] = d.checklist.map((i) => i.id);
    ok(
      await call('patch', `/document-request-packets/${id}/items/${bank}`, ownerA, {
        required: true,
      }),
      RequestPacketDetail,
    );
    d = ok(
      await call('delete', `/document-request-packets/${id}/items/${photo}`, ownerA),
      RequestPacketDetail,
    );
    expect(d.checklist.map((i) => i.title)).toEqual(['W-2', 'Bank statement', 'Prior return']);
    d = ok(
      await call('post', `/document-request-packets/${id}/items/reorder`, ownerA, {
        ids: [prior, bank, w2],
      }),
      RequestPacketDetail,
    );
    expect(d.checklist.map((i) => i.title)).toEqual(['Prior return', 'Bank statement', 'W-2']);
    expectError(
      await call('patch', `/document-request-packets/${id}`, ownerA, {
        dueOn: future(10),
        expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      }),
      400,
      'VALIDATION_FAILED',
    );
    ok(
      await call('patch', `/document-request-packets/${id}`, ownerA, {
        dueOn: future(10),
        messageSubject: 'Documents for your 2025 return',
        messageBody: 'Please upload these.',
        assignedUserId: staffA.id,
      }),
      RequestPacketDetail,
    );
    const sent = ok(
      await call('post', `/document-request-packets/${id}/send`, staffA),
      RequestPacketDetail,
    );
    expect(sent).toMatchObject({
      status: 'OPEN',
      view: 'OUTSTANDING',
      assignedTo: { userId: staffA.id },
    });
    expect(sent.sentAt).toBeTruthy();
    expect((await portalRequests()).map((r) => r.title).sort()).toEqual(
      ['Bank statement', 'Prior return', 'W-2'].sort(),
    );
    expectError(
      await call('patch', `/document-request-packets/${id}`, ownerA, { title: 'New title' }),
      409,
      'REQUEST_SENT',
    );
    expectError(
      await call('post', `/document-request-packets/${id}/items`, ownerA, { title: 'Late' }),
      409,
      'REQUEST_SENT',
    );
    ok(
      await call('patch', `/document-request-packets/${id}`, ownerA, { dueOn: future(12) }),
      RequestPacketDetail,
    );
    expectError(
      await call('post', `/document-request-packets/${id}/send`, ownerA),
      409,
      'INVALID_STATUS',
    );
  });

  it('shows received items, reminds, lists by tab, summarises and completes', async () => {
    const id = ids.packet!;
    const item = ok(
      await call('get', `/document-request-packets/${id}`, ownerA),
      RequestPacketDetail,
    ).checklist[0]!.id;
    await inFirm('a', (tx) =>
      tx.documentRequest.update({ where: { id: item }, data: { status: 'SUBMITTED' } }),
    );
    const d = ok(
      await call('post', `/document-request-packets/${id}/remind`, staffA),
      RequestPacketDetail,
    );
    expect(d).toMatchObject({ view: 'PARTIALLY_RECEIVED', items: { received: 1 } });
    expect(d.activity.map((a) => a.kind)).toEqual([
      'REQUEST_REMINDED',
      'REQUEST_SENT',
      'REQUEST_CREATED',
    ]);
    const tab = async (t: string, who: Who = ownerA) =>
      ok(await call('get', `/document-request-packets?tab=${t}`, who), RequestPacketPage).items.map(
        (p) => p.id,
      );
    expect(await tab('partially_received')).toEqual([id]);
    expect(await tab('outstanding')).toEqual([]);
    expect(await tab('all', staffA)).toEqual([id]);
    expect(
      ok(await call('get', '/document-request-packets?search=dr-', ownerA), RequestPacketPage)
        .total,
    ).toBeGreaterThanOrEqual(0);
    const s = ok(
      await call('get', '/document-request-packets/summary', ownerA),
      RequestPacketSummary,
    );
    expect(s).toMatchObject({ total: 1, partiallyReceived: 1, outstanding: 0, completed: 0 });
    const done = ok(
      await call('post', `/document-request-packets/${id}/complete`, ownerA),
      RequestPacketDetail,
    );
    expect(done).toMatchObject({ status: 'COMPLETED', view: 'COMPLETED' });
    expectError(
      await call('post', `/document-request-packets/${id}/cancel`, ownerA),
      409,
      'INVALID_STATUS',
    );
    expectError(
      await call('post', `/document-request-packets/${id}/remind`, ownerA),
      409,
      'INVALID_STATUS',
    );
  });

  it('cancels a draft with its items, and acts on many at once', async () => {
    const draft = ok(
      await call('post', '/document-request-packets', ownerA, {
        idempotencyKey: randomUUID(),
        clientId: ids.c2,
        serviceId: ids.c2e1,
        title: 'Business docs',
        items: [{ title: 'K-1' }],
      }),
      RequestPacketDetail,
      201,
    );
    const cancelled = ok(
      await call('post', `/document-request-packets/${draft.id}/cancel`, ownerA),
      RequestPacketDetail,
    );
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.checklist.map((i) => i.status)).toEqual(['CANCELLED']);
    const bulk = ok(
      await call('post', '/document-request-packets/bulk', ownerA, {
        action: 'REMIND',
        ids: [ids.packet, draft.id],
      }),
      BulkRequestPacketsResult,
    );
    expect(bulk).toMatchObject({ updated: 0 });
    expect(bulk.skipped.map((x) => x.code)).toEqual(['INVALID_STATUS', 'INVALID_STATUS']);
    expectError(
      await call('post', '/document-request-packets/bulk', ownerA, {
        action: 'ASSIGN',
        ids: [randomUUID()],
        assignedUserId: null,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/document-request-packets/${draft.id}`, staffA),
      404,
      'NOT_FOUND',
    );
  });
});

describe('another firm', () => {
  it('reaches none of it', async () => {
    for (const [method, path, body] of [
      ['get', `/documents/${ids.shared}/access`, undefined],
      [
        'post',
        `/documents/${ids.shared}/shares`,
        { recipient: { kind: 'MEMBER', userId: ownerB.id } },
      ],
      ['get', `/document-request-packets/${ids.packet}`, undefined],
      ['post', `/document-request-packets/${ids.packet}/remind`, undefined],
      ['patch', `/document-request-templates/${ids.template}`, { name: 'x' }],
    ] as const) {
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
    }
    expect(
      ok(await call('get', '/document-request-packets', ownerB, undefined, 'b'), RequestPacketPage)
        .total,
    ).toBe(0);
    expect(
      ok(
        await call('get', '/document-request-templates', ownerB, undefined, 'b'),
        RequestTemplateList,
      ).items,
    ).toEqual([]);
  });
});
