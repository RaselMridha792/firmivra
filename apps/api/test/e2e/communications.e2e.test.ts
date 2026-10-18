// End-to-end: R55, Communications (contract in packages/types/src/communications), the segments,
// lists and consent step: the criteria catalog, dynamic segments counted each time, saved lists,
// masked members, archiving, and consent. Staff reach only the clients assigned to them; a reader
// cannot change anything; firm B sees none of firm A's. No audit row holds an address or a name.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  CommunicationAttachment,
  MessageTemplateDetail,
  UploadTicket,
  CommunicationActivityPage,
  CommunicationExport,
  CommunicationRecipientPage,
  CommunicationResults,
  RenderedTemplate,
  AudienceCandidatePage,
  AudienceSummary,
  CommunicationDetail,
  CommunicationPage,
  CommunicationReview,
  CommunicationSenderList,
  CommunicationsOverview,
  ConsentView,
  SegmentDetail,
  SegmentFieldList,
  SelectAllAudienceResult,
  SegmentMemberPage,
  SegmentPage,
  SegmentPreview,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  CommunicationDelivery,
  type ProviderEvent,
} from '../../src/communications/communications-delivery.service.js';
import {
  COMMUNICATION_PROVIDERS,
  type CommunicationProvider,
  DeliveryError,
  type DeliveryMessage,
} from '../../src/communications/communications-provider.js';
import { REPORT_FILES, type ReportFiles } from '../../src/reports/report-files.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
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
  put(ticket: UploadTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();

/** A Gmail stand-in that records what it was given and can refuse an address. */
class FakeGmail implements CommunicationProvider {
  readonly provider = 'gmail';
  readonly channel = 'EMAIL' as const;
  readonly supports = { opens: true, clicks: false };
  readonly sent: DeliveryMessage[] = [];
  readonly fail = new Map<string, DeliveryError>();
  send(m: DeliveryMessage) {
    const f = this.fail.get(m.to);
    if (f) return Promise.reject(f);
    this.sent.push(m);
    return Promise.resolve({ messageId: `g-${this.sent.length}-${randomUUID().slice(0, 6)}` });
  }
}
const gmail = new FakeGmail();

class MemoryFiles implements ReportFiles {
  readonly objects = new Map<string, Buffer>();
  put(key: string, bytes: Uint8Array) {
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }
  presignDownload(input: { key: string; fileName: string }) {
    return Promise.resolve(`memory:${input.key}?name=${encodeURIComponent(input.fileName)}`);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
const files = new MemoryFiles();

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55c-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  readerA: person('reader-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'cB', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.59.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
    [method](`/api/v1/business/communications${path}`)
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
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;
const { ownerA, staffA, readerA, ownerB } = people;

const seg = async (id: string, who: Who = ownerA) =>
  SegmentDetail.parse(ok(await call('get', `/segments/${id}`, who)));
const dynamic = (over: object = {}, who: Who = ownerA) =>
  call('post', '/segments', who, {
    name: mark('Active'),
    type: 'DYNAMIC',
    audience: 'CLIENTS',
    criteria: { conditions: [{ field: 'client.status', op: 'IS', value: 'ACTIVE' }] },
    ...over,
  });
const auditRows = (entityId: string) =>
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
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55c ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55c-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', staffA.id, 'STAFF'],
    ['a', readerA.id, 'TAX_PREPARER'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const client = async (key: 'c1' | 'c2' | 'c3', name: string, over: object = {}) => {
      clients[key] = (
        await tx.client.create({
          data: { businessId, displayName: name, email: `${key}-${run}@client.test`, ...over },
          select: { id: true },
        })
      ).id;
    };
    await client('c1', 'Jamie Sample (fake)', { status: 'ACTIVE', assignedUserId: staffA.id });
    await client('c2', 'Riley Example (fake)', { status: 'ACTIVE' });
    await client('c3', 'Casey Planner (fake)', { status: 'ON_HOLD', assignedUserId: staffA.id });
  });
  await inFirm('b', async (tx) => {
    clients.cB = (
      await tx.client.create({
        data: { businessId: firms.b, displayName: 'Firm B client (fake)', status: 'ACTIVE' },
        select: { id: true },
      })
    ).id;
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(COMMUNICATION_PROVIDERS)
    .useValue([gmail])
    .overrideProvider(REPORT_FILES)
    .useValue(files)
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('segments', () => {
  it('serves the criteria catalog, narrowed by audience', async () => {
    const all = SegmentFieldList.parse(ok(await call('get', '/segments/fields', ownerA)));
    expect(all.items.map((f) => f.field)).toContain('client.status');
    expect(all.items.map((f) => f.field)).toContain('lead.status');
    ok(await call('get', '/segments/fields', readerA));
    expectError(await call('get', '/segments/fields', undefined), 401, 'UNAUTHENTICATED');
  });

  it('counts a dynamic segment each time, within the caller’s reach', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    expect(made.type).toBe('DYNAMIC');
    expect(made.memberCount).toBe(3 - 1); // c1 and c2 are ACTIVE, c3 is ON_HOLD
    expect(made.criteriaSummary).toMatch(/Client status/);
    // Staff reach only c1 of the two.
    expect((await seg(made.id, staffA)).memberCount).toBe(1);
    // A new active client appears in the next read.
    await inFirm('a', (tx) =>
      tx.client.create({
        data: {
          businessId: firms.a,
          displayName: 'Later Client (fake)',
          email: `later-${run}@client.test`,
          status: 'ACTIVE',
        },
      }),
    );
    expect((await seg(made.id)).memberCount).toBe(3);
    const rows = await auditRows(made.id);
    expect(rows.map((r) => r.action)).toEqual(['communication_segment.created']);
    expect(JSON.stringify(rows)).not.toMatch(/client\.test|Jamie|Riley/);
  });

  it('refuses criteria the catalog does not offer, and a name already used', async () => {
    expectError(
      await dynamic({ criteria: { conditions: [{ field: 'client.ssn', op: 'IS', value: 'x' }] } }),
      400,
      'INVALID_CRITERIA',
    );
    expectError(
      await dynamic({
        criteria: { conditions: [{ field: 'client.status', op: 'CONTAINS', value: 'ACT' }] },
      }),
      400,
      'INVALID_CRITERIA',
    );
    expectError(
      await dynamic({
        criteria: { conditions: [{ field: 'client.status', op: 'IS', value: 'NOPE' }] },
      }),
      400,
      'INVALID_CRITERIA',
    );
    expectError(await dynamic({ audience: 'LEADS' }), 400, 'INVALID_CRITERIA');
    const name = mark('Same');
    ok(await dynamic({ name }), 201);
    expectError(await dynamic({ name: name.toUpperCase() }), 409, 'DUPLICATE_NAME');
    expect((await call('post', '/segments', ownerA, { name: 'x', type: 'DYNAMIC' })).status).toBe(
      400,
    );
    expect(
      (await call('post', '/segments', ownerA, { name: 'x', type: 'STATIC', criteria: {} })).status,
    ).toBe(400);
  });

  it('updates with an etag, and a stale save is refused', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    const changed = SegmentDetail.parse(
      ok(
        await call('patch', `/segments/${made.id}`, ownerA, {
          etag: made.etag,
          criteria: { conditions: [{ field: 'client.status', op: 'IS', value: 'ON_HOLD' }] },
        }),
      ),
    );
    expect(changed.memberCount).toBe(1);
    expectError(
      await call('patch', `/segments/${made.id}`, ownerA, { etag: made.etag, description: 'x' }),
      409,
      'SAVE_CONFLICT',
    );
  });

  it('lists with filters and pages', async () => {
    const name = mark('Findable');
    ok(await dynamic({ name }), 201);
    const found = SegmentPage.parse(
      ok(await call('get', `/segments?search=${encodeURIComponent(name)}`, ownerA)),
    );
    expect(found.items.map((s) => s.name)).toEqual([name]);
    expect(
      SegmentPage.parse(ok(await call('get', '/segments?type=STATIC&pageSize=2', ownerA))).pageSize,
    ).toBe(2);
    expect((await call('get', '/segments?bogus=1', ownerA)).status).toBe(400);
  });

  it('previews criteria without saving, with masked samples', async () => {
    const before = SegmentPage.parse(ok(await call('get', '/segments', ownerA))).total;
    const p = SegmentPreview.parse(
      ok(
        await call('post', '/segments/preview', ownerA, {
          audience: 'CLIENTS',
          criteria: {
            conditions: [{ field: 'client.status', op: 'IS_ANY_OF', value: ['ACTIVE', 'ON_HOLD'] }],
          },
          sample: 2,
        }),
      ),
    );
    expect(p.count).toBeGreaterThanOrEqual(3);
    expect(p.sample).toHaveLength(2);
    for (const s of p.sample) expect(s.secondary).toMatch(/^.\*\*\*@/);
    expect(SegmentPage.parse(ok(await call('get', '/segments', ownerA))).total).toBe(before);
  });

  it('keeps a saved list, replaces its members, and masks them', async () => {
    const made = SegmentDetail.parse(
      ok(
        await call('post', '/segments', ownerA, {
          name: mark('List'),
          type: 'STATIC',
          clientIds: [clients.c1, clients.c2, clients.c1],
        }),
        201,
      ),
    );
    expect(made.memberCount).toBe(2);
    expect(made.criteria).toBeNull();
    const members = SegmentMemberPage.parse(
      ok(await call('get', `/segments/${made.id}/members`, ownerA)),
    );
    expect(members.items.map((m) => m.label)).toEqual([
      'Jamie Sample (fake)',
      'Riley Example (fake)',
    ]);
    expect(members.items[0]?.secondary).toMatch(/^c\*\*\*@client\.test$/);
    // Staff see only the member assigned to them.
    expect(
      SegmentMemberPage.parse(ok(await call('get', `/segments/${made.id}/members`, staffA))).total,
    ).toBe(1);
    const replaced = SegmentDetail.parse(
      ok(
        await call('put', `/segments/${made.id}/members`, ownerA, {
          clientIds: [clients.c3],
          etag: made.etag,
        }),
      ),
    );
    expect(replaced.memberCount).toBe(1);
    // A client of another firm cannot be named.
    expect(
      (
        await call('put', `/segments/${made.id}/members`, ownerA, {
          clientIds: [clients.cB],
          etag: replaced.etag,
        })
      ).status,
    ).toBe(400);
    // A dynamic segment has no members to set by hand.
    const dyn = SegmentDetail.parse(ok(await dynamic(), 201));
    expect(
      (await call('put', `/segments/${dyn.id}/members`, ownerA, { clientIds: [], etag: dyn.etag }))
        .status,
    ).toBe(400);
  });

  it('duplicates, archives and restores', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    const copy = SegmentDetail.parse(
      ok(await call('post', `/segments/${made.id}/duplicate`, ownerA), 201),
    );
    expect(copy.name).toBe(`${made.name} (copy)`);
    expect(copy.id).not.toBe(made.id);
    expect(
      SegmentDetail.parse(ok(await call('post', `/segments/${made.id}/archive`, ownerA))).archived,
    ).toBe(true);
    const archived = SegmentPage.parse(ok(await call('get', '/segments?archived=true', ownerA)));
    expect(archived.items.map((s) => s.id)).toContain(made.id);
    const live = SegmentPage.parse(
      ok(await call('get', `/segments?search=${encodeURIComponent(made.name)}`, ownerA)),
    );
    expect(live.items.map((s) => s.id)).not.toContain(made.id);
    expect(
      SegmentDetail.parse(ok(await call('post', `/segments/${made.id}/restore`, ownerA))).archived,
    ).toBe(false);
  });

  it('will not archive a segment a scheduled communication uses', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    await inFirm('a', async (tx) => {
      const c = await tx.communication.create({
        data: {
          businessId: firms.a,
          channel: 'EMAIL',
          name: 'Scheduled (fake)',
          status: 'SCHEDULED',
          createdByUserId: ownerA.id,
          scheduledFor: new Date(Date.now() + 86_400_000),
          timezone: 'America/New_York',
        },
      });
      await tx.communicationAudienceEntry.create({
        data: { businessId: firms.a, communicationId: c.id, kind: 'SEGMENT', segmentId: made.id },
      });
    });
    expectError(await call('post', `/segments/${made.id}/archive`, ownerA), 409, 'SEGMENT_IN_USE');
  });

  it('lets a reader read and nothing more', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    ok(await call('get', '/segments', readerA));
    ok(await call('get', `/segments/${made.id}`, readerA));
    expectError(await dynamic({}, readerA), 403, 'FORBIDDEN');
    expectError(
      await call('patch', `/segments/${made.id}`, readerA, { etag: made.etag, description: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(await call('post', `/segments/${made.id}/archive`, readerA), 403, 'FORBIDDEN');
  });

  it('shows firm B nothing of firm A', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    expectError(
      await call('get', `/segments/${made.id}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'patch',
        `/segments/${made.id}`,
        ownerB,
        { etag: made.etag, description: 'x' },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
    expect(
      SegmentPage.parse(ok(await call('get', '/segments', ownerB, undefined, 'b'))).items,
    ).toHaveLength(0);
    expectError(await call('get', `/segments/${randomUUID()}`, ownerA), 404, 'NOT_FOUND');
  });
});

describe('consent', () => {
  it('records a standing on a channel and reads it back', async () => {
    expect(
      ConsentView.parse(ok(await call('get', `/consent?clientId=${clients.c1}`, ownerA))).items,
    ).toHaveLength(0);
    const set = ConsentView.parse(
      ok(
        await call('put', '/consent', ownerA, {
          clientId: clients.c1,
          channel: 'EMAIL',
          status: 'OPTED_OUT',
          reason: 'Asked on the phone',
        }),
      ),
    );
    expect(set.items).toHaveLength(1);
    expect(set.items[0]).toMatchObject({ channel: 'EMAIL', status: 'OPTED_OUT', source: 'staff' });
    const again = ConsentView.parse(
      ok(
        await call('put', '/consent', ownerA, {
          clientId: clients.c1,
          channel: 'EMAIL',
          status: 'OPTED_IN',
        }),
      ),
    );
    expect(again.items[0]?.status).toBe('OPTED_IN');
    const rows = await auditRows(clients.c1);
    expect(rows.map((r) => r.action)).toEqual([
      'communication_consent.set',
      'communication_consent.set',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/phone|client\.test/);
  });

  it('reaches only the caller’s contacts, and only for those who may change', async () => {
    const c2 = { clientId: clients.c2, channel: 'SMS', status: 'OPTED_OUT' };
    expectError(await call('put', '/consent', staffA, c2), 404, 'NOT_FOUND');
    expectError(await call('get', `/consent?clientId=${clients.c2}`, staffA), 404, 'NOT_FOUND');
    expectError(await call('put', '/consent', readerA, c2), 403, 'FORBIDDEN');
    expectError(await call('put', '/consent', ownerB, c2, 'b'), 404, 'NOT_FOUND');
    expect(
      (await call('put', '/consent', ownerA, { channel: 'SMS', status: 'OPTED_OUT' })).status,
    ).toBe(400);
    expect((await call('put', '/consent', ownerA, { ...c2, channel: 'ANNOUNCEMENT' })).status).toBe(
      400,
    );
    expect((await call('get', '/consent', ownerA)).status).toBe(400);
  });
});

// ---------- Campaigns ----------

const detailOf = (res: Response, status = 200) => CommunicationDetail.parse(ok(res, status));
const draft = async (over: object = {}, who: Who = ownerA) =>
  detailOf(await call('post', '', who, { channel: 'EMAIL', name: mark('Campaign'), ...over }), 201);
const edit = async (id: string, body: object, who: Who = ownerA) =>
  call('patch', `/${id}`, who, { etag: (await getDetail(id, who)).etag, ...body });
const getDetail = async (id: string, who: Who = ownerA) =>
  detailOf(await call('get', `/${id}`, who));
const audienceOf = async (id: string, body: object = {}, who: Who = ownerA) =>
  call('put', `/${id}/audience`, who, { etag: (await getDetail(id, who)).etag, ...body });
const key = () => randomUUID();
const people2 = {} as Record<'p1' | 'p2' | 'p3' | 'p4' | 'p5', string>;
let leadSame = '';

describe('campaigns', () => {
  beforeAll(async () => {
    await inFirm('a', async (tx) => {
      const mk = async (
        k: keyof typeof people2,
        name: string,
        over: { email?: string | null; phone?: string | null; assignedUserId?: string } = {},
      ) => {
        people2[k] = (
          await tx.client.create({
            data: {
              businessId: firms.a,
              displayName: name,
              email: over.email === undefined ? `${k}-${run}@camp.test` : over.email,
              phone: over.phone === undefined ? '(555) 010-2030' : over.phone,
              assignedUserId: over.assignedUserId,
            },
            select: { id: true },
          })
        ).id;
      };
      await mk('p1', 'Pat One (fake)', { assignedUserId: staffA.id });
      await mk('p2', 'Pat Two (fake)');
      await mk('p3', 'Pat Three (fake)', { email: null });
      await mk('p4', 'Pat Four (fake)');
      await mk('p5', 'Pat Five (fake)', { email: 'not-an-address' });
      // A lead who writes from the same address as Pat One.
      const service = await tx.service.create({
        data: { businessId: firms.a, kind: 'BUSINESS_DEVELOPMENT', name: `Camp service ${run}` },
        select: { id: true },
      });
      leadSame = (
        await tx.lead.create({
          data: {
            businessId: firms.a,
            serviceId: service.id,
            firstName: 'Lee',
            lastName: 'Lead (fake)',
            email: `p1-${run}@camp.test`,
          },
          select: { id: true },
        })
      ).id;
    });
  });

  it('is not ready until a provider is connected, then lists its sender', async () => {
    const before = CommunicationsOverview.parse(ok(await call('get', '/overview', ownerA)));
    const email = before.channels.find((c) => c.channel === 'EMAIL');
    expect(email).toMatchObject({ ready: false, route: 'INTEGRATIONS', senderCount: 0 });
    expect(before.channels.find((c) => c.channel === 'ANNOUNCEMENT')?.ready).toBe(true);
    expectError(await call('post', '', ownerA, { channel: 'EMAIL' }), 409, 'CHANNEL_UNAVAILABLE');
    await inFirm('a', (tx) =>
      tx.integrationConnection.create({
        data: {
          businessId: firms.a,
          provider: 'gmail',
          status: 'CONNECTED',
          accountLabel: 'Fake Firm Mail',
        },
      }),
    );
    const after = CommunicationsOverview.parse(ok(await call('get', '/overview', ownerA)));
    expect(after.channels.find((c) => c.channel === 'EMAIL')).toMatchObject({
      ready: true,
      senderCount: 1,
    });
    const senders = CommunicationSenderList.parse(ok(await call('get', '/senders', ownerA)));
    expect(senders.items).toMatchObject([
      { channel: 'EMAIL', label: 'Fake Firm Mail', verified: true, isDefault: true },
    ]);
    // No SMS provider: a text cannot be started.
    expectError(await call('post', '', ownerA, { channel: 'SMS' }), 409, 'CHANNEL_UNAVAILABLE');
    // A reader cannot start anything.
    expectError(await call('post', '', readerA, { channel: 'EMAIL' }), 403, 'FORBIDDEN');
  });

  it('takes a sender only from the firm’s own healthy connections', async () => {
    const other = await inFirm('b', (tx) =>
      tx.integrationConnection.create({
        data: {
          businessId: firms.b,
          provider: 'gmail',
          status: 'CONNECTED',
          accountLabel: 'B mail',
        },
      }),
    );
    const d = await draft();
    expect((await edit(d.id, { senderId: other.id })).status).toBe(400);
    expect((await edit(d.id, { senderId: randomUUID() })).status).toBe(400);
    const mine = (await getDetail(d.id)).sender;
    expect(detailOf(await edit(d.id, { senderId: null })).sender).toBeNull();
    expect(detailOf(await edit(d.id, { senderId: mine?.id })).sender?.id).toBe(mine?.id);
  });

  it('starts a draft, autosaves with an etag, and refuses a stale save', async () => {
    const d = await draft();
    expect(d).toMatchObject({ status: 'DRAFT', editable: true, canSend: true, opens: 'COMPOSER' });
    expect(d.sender?.label).toBe('Fake Firm Mail');
    const saved = detailOf(
      await call('patch', `/${d.id}`, ownerA, {
        etag: d.etag,
        subject: 'Hello [Client First Name]',
        body: '<p>Dear [Client First Name], <script>alert(1)</script>welcome to [Business Name]. [Mystery Field]</p>',
        previewText: 'A short preview',
      }),
    );
    expect(saved.body).not.toContain('<script>');
    expect(saved.mergeFields.used).toEqual(['Client First Name', 'Business Name', 'Mystery Field']);
    expect(saved.mergeFields.unknown).toEqual(['Mystery Field']);
    expectError(
      await call('patch', `/${d.id}`, ownerA, { etag: d.etag, name: 'again' }),
      409,
      'SAVE_CONFLICT',
    );
    const rows = await auditRows(d.id);
    expect(rows.map((r) => r.action)).toEqual(['communication.created', 'communication.updated']);
    expect(JSON.stringify(rows)).not.toMatch(/Hello|welcome|Mystery/);
    expect((await call('patch', `/${d.id}`, ownerA, { etag: saved.etag })).status).toBe(400);
    expect((await call('patch', `/${d.id}`, ownerA, { etag: saved.etag, sms: 'x' })).status).toBe(
      400,
    );
  });

  it('refuses a template of the wrong kind and copies a good one as a snapshot', async () => {
    const t = await inFirm('a', (tx) =>
      tx.messageTemplate.create({
        data: {
          businessId: firms.a,
          kind: 'EMAIL',
          name: mark('Tpl'),
          subject: 'From the template',
          body: '<p>Template body</p>',
          status: 'ACTIVE',
          ownerUserId: ownerA.id,
          version: 3,
        },
      }),
    );
    const sms = await inFirm('a', (tx) =>
      tx.messageTemplate.create({
        data: {
          businessId: firms.a,
          kind: 'SMS',
          name: mark('Sms'),
          body: 'text',
          status: 'ACTIVE',
          ownerUserId: ownerA.id,
        },
      }),
    );
    expectError(
      await call('post', '', ownerA, { channel: 'EMAIL', templateId: sms.id }),
      409,
      'TEMPLATE_NOT_ALLOWED',
    );
    const d = await draft({ templateId: t.id });
    expect(d).toMatchObject({ subject: 'From the template', template: { id: t.id, version: 3 } });
    expect(d.body).toBe('<p>Template body</p>');
    // The master is untouched by editing the draft.
    await edit(d.id, { body: '<p>Changed</p>' });
    const master = await inFirm('a', (tx) =>
      tx.messageTemplate.findUniqueOrThrow({ where: { id: t.id } }),
    );
    expect(master.body).toBe('<p>Template body</p>');
  });

  it('keeps the channel’s rules: no subject on an announcement’s reply, content loss needs a yes', async () => {
    const d = await draft();
    const withSubject = detailOf(
      await call('patch', `/${d.id}`, ownerA, {
        etag: d.etag,
        subject: 'Subject',
        replyTo: 'reply@camp.test',
        body: '<p>Hi</p>',
      }),
    );
    expectError(
      await call('patch', `/${d.id}`, ownerA, { etag: withSubject.etag, channel: 'ANNOUNCEMENT' }),
      409,
      'CONTENT_WOULD_BE_LOST',
    );
    const ann = detailOf(
      await call('patch', `/${d.id}`, ownerA, {
        etag: withSubject.etag,
        channel: 'ANNOUNCEMENT',
        confirmStripContent: true,
      }),
    );
    expect(ann).toMatchObject({ channel: 'ANNOUNCEMENT', replyTo: null, sender: null });
    expect(ann.subject).toBe('Subject');
    expect(
      (
        await edit(d.id, {
          publishStartsAt: '2030-01-02T00:00:00Z',
          publishEndsAt: '2030-01-01T00:00:00Z',
        })
      ).status,
    ).toBe(400);
    const ok1 = detailOf(
      await edit(d.id, {
        publishStartsAt: '2030-01-01T00:00:00Z',
        publishEndsAt: '2030-01-02T00:00:00Z',
        visibility: 'dashboard',
      }),
    );
    expect(ok1.visibility).toBe('dashboard');
    expect((await edit(d.id, { previewText: 'x' })).status).toBe(400);
  });

  it('works out the audience: duplicates, missing and bad addresses, opt-outs, manual exclusions', async () => {
    const d = await draft({ name: mark('Audience') });
    const set = AudienceSummary.parse(
      ok(
        await audienceOf(d.id, {
          clientIds: [people2.p1, people2.p2, people2.p3, people2.p4, people2.p5],
          leadIds: [leadSame],
          excludeClientIds: [people2.p2],
        }),
      ),
    );
    // The lead shares Pat One's address (the lead is left out), p3 has no email, p5 has a bad one,
    // p2 is out by hand.
    expect(set).toMatchObject({
      selectedCount: 6,
      manualExcludedCount: 1,
      finalCount: 2,
      autoExcluded: { duplicate: 1, missingChannel: 1, invalid: 1, unsubscribed: 0 },
    });
    expect(set.chips.map((c) => c.kind).sort()).toEqual([
      'CLIENT',
      'CLIENT',
      'CLIENT',
      'CLIENT',
      'CLIENT',
      'EXCLUDE_CLIENT',
      'LEAD',
    ]);
    // Opting Pat One out lets the lead have that address.
    ok(
      await call('put', '/consent', ownerA, {
        clientId: people2.p1,
        channel: 'EMAIL',
        status: 'OPTED_OUT',
      }),
    );
    const again = AudienceSummary.parse(ok(await call('get', `/${d.id}/audience`, ownerA)));
    expect(again).toMatchObject({ finalCount: 2, autoExcluded: { unsubscribed: 1, duplicate: 0 } });
    // A segment adds its members; a person in two places counts once.
    const seg = SegmentDetail.parse(
      ok(
        await call('post', '/segments', ownerA, {
          name: mark('Camp list'),
          type: 'STATIC',
          clientIds: [people2.p2, people2.p4],
        }),
        201,
      ),
    );
    const withSeg = AudienceSummary.parse(
      ok(await audienceOf(d.id, { segmentIds: [seg.id], clientIds: [people2.p4] })),
    );
    expect(withSeg.selectedCount).toBe(2);
    expect(withSeg.chips.find((c) => c.kind === 'SEGMENT')).toMatchObject({ id: seg.id, count: 2 });
    // Other firms' people and unknown segments are refused.
    expect((await audienceOf(d.id, { clientIds: [clients.cB] })).status).toBe(400);
    expect((await audienceOf(d.id, { segmentIds: [randomUUID()] })).status).toBe(400);
  });

  it('lists candidates for the channel with their standing, masked', async () => {
    const d = await draft();
    const page = AudienceCandidatePage.parse(
      ok(await call('get', `/audience/candidates?communicationId=${d.id}&search=Pat`, ownerA)),
    );
    const by = (n: string) => page.items.find((i) => i.label.startsWith(n));
    expect(by('Pat Two')).toMatchObject({ eligible: true, ineligibleReason: null });
    expect(by('Pat Two')?.secondary).toMatch(/^p\*\*\*@camp\.test$/);
    expect(by('Pat One')).toMatchObject({ eligible: false, ineligibleReason: 'UNSUBSCRIBED' });
    expect(by('Pat Three')).toMatchObject({ eligible: false, ineligibleReason: 'MISSING_CHANNEL' });
    expect(by('Pat Five')).toMatchObject({ eligible: false, ineligibleReason: 'INVALID' });
    expect(JSON.stringify(page)).not.toContain(`p2-${run}@`);
    const all = SelectAllAudienceResult.parse(
      ok(
        await call('post', '/audience/select-all', ownerA, {
          communicationId: d.id,
          search: 'Pat',
        }),
      ),
    );
    expect(all.clientIds).toContain(people2.p2);
    expect(all.clientIds).not.toContain(people2.p1);
    expect(all.clientIds).not.toContain(people2.p3);
    expect(all.truncated).toBe(false);
    // Staff see only their own client.
    const mine = await draft({}, staffA);
    const staffPage = AudienceCandidatePage.parse(
      ok(await call('get', `/audience/candidates?communicationId=${mine.id}&search=Pat`, staffA)),
    );
    expect(staffPage.items.map((i) => i.id)).toEqual([people2.p1]);
    expectError(
      await call('get', `/audience/candidates?communicationId=${d.id}`, staffA),
      404,
      'NOT_FOUND',
    );
  });

  it('reviews, blocks what is missing, and sends once however many times it is asked', async () => {
    const d = await draft({ name: mark('Send') });
    const empty = CommunicationReview.parse(ok(await call('get', `/${d.id}/review`, ownerA)));
    expect(empty.canSend).toBe(false);
    expect(
      empty.checks
        .filter((c) => c.severity === 'BLOCK')
        .map((c) => c.code)
        .sort(),
    ).toEqual(['EMPTY_BODY', 'MISSING_SUBJECT', 'NO_RECIPIENTS']);
    const k = key();
    const blocked = await call('post', `/${d.id}/send`, ownerA, {
      idempotencyKey: k,
      etag: d.etag,
    });
    expectError(blocked, 409, 'NOT_READY');
    await edit(d.id, {
      subject: 'Hello [Client First Name]',
      body: '<p>Hi [Client First Name], see [Appointment Date]</p>',
    });
    ok(await audienceOf(d.id, { clientIds: [people2.p2, people2.p4] }));
    const review = CommunicationReview.parse(ok(await call('get', `/${d.id}/review`, ownerA)));
    expect(review.canSend).toBe(true);
    expect(review.checks.find((c) => c.code === 'UNRESOLVED_FIELDS')?.severity).toBe('WARN');
    expect(review.audience.finalCount).toBe(2);
    expect(review.preview.subject).toMatch(/^Hello Pat$/);
    const fresh = await getDetail(d.id);
    // The count moved since it was shown.
    expectError(
      await call('post', `/${d.id}/send`, ownerA, {
        idempotencyKey: key(),
        etag: fresh.etag,
        expectedFinalCount: 5,
      }),
      409,
      'AUDIENCE_CHANGED',
    );
    const sent = detailOf(
      await call('post', `/${d.id}/send`, ownerA, {
        idempotencyKey: k,
        etag: fresh.etag,
        expectedFinalCount: 2,
      }),
    );
    expect(sent).toMatchObject({
      status: 'SENDING',
      editable: false,
      finalCount: 2,
      opens: 'RESULTS',
    });
    expect(sent.audience).toMatchObject({ finalCount: 2, selectedCount: 2 });
    // A double click or a retry answers the same campaign and sends nothing more.
    const retry = detailOf(
      await call('post', `/${d.id}/send`, ownerA, { idempotencyKey: k, etag: fresh.etag }),
    );
    expect(retry.id).toBe(d.id);
    const recipients = await inFirm('a', (tx) =>
      tx.communicationRecipient.findMany({ where: { communicationId: d.id } }),
    );
    expect(recipients.map((r) => r.status)).toEqual(['QUEUED', 'QUEUED']);
    expect(recipients.every((r) => /\*\*\*/.test(r.addressMask))).toBe(true);
    // Another key on the same campaign is not a new send.
    expectError(
      await call('post', `/${d.id}/send`, ownerA, { idempotencyKey: key(), etag: fresh.etag }),
      409,
      'NOT_EDITABLE',
    );
    // A sent campaign no longer changes.
    expectError(
      await call('patch', `/${d.id}`, ownerA, { etag: sent.etag, name: 'later' }),
      409,
      'NOT_EDITABLE',
    );
    expectError(
      await call('put', `/${d.id}/audience`, ownerA, { etag: sent.etag, clientIds: [] }),
      409,
      'NOT_EDITABLE',
    );
    const rows = await auditRows(d.id);
    expect(rows.map((r) => r.action)).toContain('communication.sent');
    expect(JSON.stringify(rows)).not.toMatch(/camp\.test|Hello|Pat /);
    // It moves to the sent history and can be cancelled while sending: what is queued stops.
    const cancelled = detailOf(
      await call('post', `/${d.id}/cancel`, ownerA, { reason: 'Wrong list' }),
    );
    expect(cancelled).toMatchObject({ status: 'CANCELLED' });
    const stopped = await inFirm('a', (tx) =>
      tx.communicationRecipient.findMany({ where: { communicationId: d.id } }),
    );
    expect(stopped.map((r) => [r.status, r.failureCode])).toEqual([
      ['NOT_SENT', 'cancelled'],
      ['NOT_SENT', 'cancelled'],
    ]);
  });

  it('schedules for later, reschedules before the lock, and cancels', async () => {
    const d = await draft({ name: mark('Later') });
    await edit(d.id, { subject: 'Later', body: '<p>Later</p>' });
    ok(await audienceOf(d.id, { clientIds: [people2.p2] }));
    const soon = new Date(Date.now() + 60_000).toISOString();
    expectError(
      await call('post', `/${d.id}/schedule`, ownerA, {
        idempotencyKey: key(),
        scheduledFor: soon,
        etag: (await getDetail(d.id)).etag,
      }),
      409,
      'SCHEDULE_IN_PAST',
    );
    const at = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const k = key();
    const etag = (await getDetail(d.id)).etag;
    const sch = detailOf(
      await call('post', `/${d.id}/schedule`, ownerA, {
        idempotencyKey: k,
        scheduledFor: at,
        etag,
      }),
    );
    expect(sch).toMatchObject({ status: 'SCHEDULED', opens: 'SCHEDULED_DETAIL', editable: true });
    expect(sch.lockedAt).toBe(new Date(Date.parse(at) - 5 * 60_000).toISOString());
    expect(
      detailOf(
        await call('post', `/${d.id}/schedule`, ownerA, {
          idempotencyKey: k,
          scheduledFor: at,
          etag,
        }),
      ).id,
    ).toBe(d.id);
    const later = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const moved = detailOf(
      await call('post', `/${d.id}/reschedule`, ownerA, { scheduledFor: later, etag: sch.etag }),
    );
    expect(moved.scheduledFor).toBe(later);
    const list = CommunicationPage.parse(ok(await call('get', '/?tab=scheduled', ownerA)));
    expect(list.items.map((r) => r.id)).toContain(d.id);
    // A scheduled campaign can still be edited before its lock.
    ok(await edit(d.id, { name: mark('Renamed') }));
    // Inside the lock it is fixed.
    await inFirm('a', (tx) =>
      tx.communication.update({
        where: { id: d.id },
        data: { scheduledFor: new Date(Date.now() + 2 * 60_000) },
      }),
    );
    expectError(
      await call('post', `/${d.id}/reschedule`, ownerA, {
        scheduledFor: later,
        etag: (await getDetail(d.id)).etag,
      }),
      409,
      'LOCKED',
    );
    expectError(await edit(d.id, { name: 'no' }), 409, 'LOCKED');
    const gone = detailOf(await call('post', `/${d.id}/cancel`, ownerA, {}));
    expect(gone.status).toBe('CANCELLED');
    expect(gone.cancelledAt).not.toBeNull();
    // Cancelling again is a no-op.
    expect(detailOf(await call('post', `/${d.id}/cancel`, ownerA, {})).status).toBe('CANCELLED');
  });

  it('publishes an announcement to the eligible clients at once', async () => {
    const d = await draft({ channel: 'ANNOUNCEMENT', name: mark('News') });
    await edit(d.id, { subject: 'Office closed Friday', body: '<p>Closed.</p>' });
    ok(await audienceOf(d.id, { clientIds: [people2.p1, people2.p3] }));
    const sent = detailOf(
      await call('post', `/${d.id}/send`, ownerA, {
        idempotencyKey: key(),
        etag: (await getDetail(d.id)).etag,
      }),
    );
    // An announcement needs no email address: both clients get it in the portal.
    expect(sent).toMatchObject({ status: 'SENT', finalCount: 2, sender: null });
    expect(sent.sentAt).not.toBeNull();
    const list = CommunicationPage.parse(ok(await call('get', '/?tab=announcements', ownerA)));
    expect(list.items.map((r) => r.id)).toContain(d.id);
  });

  it('lists the tabs, filters and archives', async () => {
    const d = await draft({ name: mark('Findme') });
    const find = async (q: string, who: Who = ownerA) =>
      CommunicationPage.parse(ok(await call('get', `/?${q}`, who)));
    expect(
      (await find(`tab=drafts&search=${encodeURIComponent(d.name)}`)).items.map((r) => r.id),
    ).toEqual([d.id]);
    expect((await find(`tab=sent&search=${encodeURIComponent(d.name)}`)).items).toHaveLength(0);
    expect((await find('channel=SMS&pageSize=5')).pageSize).toBe(5);
    expect((await call('get', '/?tab=nope', ownerA)).status).toBe(400);
    const arch = detailOf(await call('post', `/${d.id}/archive`, ownerA));
    expect(arch.archived).toBe(true);
    expect(
      (await find(`archived=true&search=${encodeURIComponent(d.name)}`)).items.map((r) => r.id),
    ).toEqual([d.id]);
    expect(detailOf(await call('post', `/${d.id}/restore`, ownerA)).archived).toBe(false);
    const copy = detailOf(await call('post', `/${d.id}/duplicate`, ownerA), 201);
    expect(copy).toMatchObject({ status: 'DRAFT', sourceId: d.id, sourceKind: 'DUPLICATE' });
    expect(copy.name).toBe(`${d.name} (copy)`);
  });

  it('shows Staff only their own, and firm B nothing', async () => {
    const mine = await draft({}, staffA);
    const theirs = await draft({}, ownerA);
    ok(await call('get', `/${mine.id}`, staffA));
    expectError(await call('get', `/${theirs.id}`, staffA), 404, 'NOT_FOUND');
    expectError(
      await call('patch', `/${theirs.id}`, staffA, { etag: theirs.etag, name: 'x' }),
      404,
      'NOT_FOUND',
    );
    expectError(await call('post', `/${theirs.id}/cancel`, staffA, {}), 404, 'NOT_FOUND');
    ok(await call('get', `/${mine.id}`, ownerA));
    expectError(await call('get', `/${theirs.id}`, ownerB, undefined, 'b'), 404, 'NOT_FOUND');
    expect(
      CommunicationPage.parse(ok(await call('get', '/', ownerB, undefined, 'b'))).items,
    ).toHaveLength(0);
    expectError(await call('get', `/${randomUUID()}`, ownerA), 404, 'NOT_FOUND');
    expectError(await call('get', '/not-a-uuid', ownerA), 400, 'VALIDATION_FAILED');
  });
});

// ---------- Delivery, results and what follows ----------

/** A sent campaign to Pat Two and Pat Four, ready for the job. */
async function sentCampaign(over: { body?: string; who?: string[]; name?: string } = {}) {
  const d = await draft({ name: over.name ?? mark('Out') });
  await edit(d.id, {
    subject: 'Hello [Client First Name]',
    body: over.body ?? '<p>Hi [Client First Name]</p>',
  });
  ok(await audienceOf(d.id, { clientIds: over.who ?? [people2.p2, people2.p4] }));
  const out = detailOf(
    await call('post', `/${d.id}/send`, ownerA, {
      idempotencyKey: key(),
      etag: (await getDetail(d.id)).etag,
    }),
  );
  return out;
}
const runJob = () => delivery().run({ businessIds: [firms.a] });
const delivery = () => app.get(CommunicationDelivery, { strict: false });
const recipientsOf = (id: string) =>
  inFirm('a', (tx) =>
    tx.communicationRecipient.findMany({
      where: { communicationId: id },
      orderBy: { createdAt: 'asc' },
    }),
  );
const mailAddress = (k: string) => `${k}-${run}@camp.test`;

describe('delivery and results', () => {
  it('hands each message to the provider, personalised, and finishes the campaign', async () => {
    const c = await sentCampaign();
    gmail.sent.length = 0;
    const r = await runJob();
    expect(r).toMatchObject({ skipped: false, sent: 2, failed: 0 });
    expect(gmail.sent.map((m) => [m.to, m.subject, m.body]).sort()).toEqual(
      [
        [mailAddress('p2'), 'Hello Pat', '<p>Hi Pat</p>'],
        [mailAddress('p4'), 'Hello Pat', '<p>Hi Pat</p>'],
      ].sort(),
    );
    const rows = await recipientsOf(c.id);
    expect(rows.map((x) => x.status)).toEqual(['SENT', 'SENT']);
    expect(rows.every((x) => x.providerMessageId?.startsWith('g-'))).toBe(true);
    expect((await getDetail(c.id)).status).toBe('SENT');
    // A second run has nothing to do.
    gmail.sent.length = 0;
    expect(await runJob()).toMatchObject({ sent: 0 });
    expect(gmail.sent).toHaveLength(0);
    const audit = await auditRows(c.id);
    expect(audit.map((a) => a.action)).toContain('communication.finished');
    expect(JSON.stringify(audit)).not.toMatch(/camp\.test|Hello/);
  });

  it('folds provider events into the results, once each, and honours an unsubscribe', async () => {
    const c = await sentCampaign({ who: [people2.p2, people2.p4] });
    await runJob();
    const [a, b] = await recipientsOf(c.id);
    const at = new Date();
    const ev = (r: { id: string }, type: ProviderEvent['type'], id: string, over = {}) =>
      delivery().applyEvent(firms.a, {
        communicationId: c.id,
        recipientId: r.id,
        type,
        providerEventId: id,
        occurredAt: at,
        ...over,
      });
    expect(await ev(a!, 'DELIVERED', `d1-${c.id}`)).toBe('applied');
    expect(await ev(a!, 'DELIVERED', `d1-${c.id}`)).toBe('duplicate');
    expect(await ev(b!, 'DELIVERED', `d2-${c.id}`)).toBe('applied');
    expect(await ev(a!, 'OPENED', `o1-${c.id}`)).toBe('applied');
    expect(await ev(a!, 'OPENED', `o2-${c.id}`)).toBe('applied');
    expect(await ev(a!, 'CLICKED', `c1-${c.id}`)).toBe('applied');
    const res = CommunicationResults.parse(ok(await call('get', `/${c.id}/results`, ownerA)));
    expect(res.metrics).toMatchObject({
      totalRecipients: 2,
      delivered: { count: 2, ratePercent: 100 },
      opened: { count: 1, ratePercent: 50 },
      pending: { count: 0 },
      failed: { count: 0 },
    });
    // The provider reports opens but not clicks: the card says so instead of a zero.
    expect(res.supports).toEqual({ opens: true, clicks: false });
    expect(res.metrics.clicked.ratePercent).toBeNull();
    expect(res.funnel.map((f) => [f.stage, f.count])).toEqual([
      ['SENT', 2],
      ['DELIVERED', 2],
      ['OPENED', 1],
      ['CLICKED', 1],
    ]);
    expect(res.trend).toHaveLength(1);
    expect(res.trend[0]).toMatchObject({ delivered: 2, opened: 2, clicked: 1 });
    const page = CommunicationRecipientPage.parse(
      ok(await call('get', `/${c.id}/recipients?engagement=opened`, ownerA)),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ openCount: 2, clickCount: 1, status: 'CLICKED' });
    expect(page.items[0]?.addressMask).toMatch(/^p\*\*\*@camp\.test$/);
    expect(
      CommunicationRecipientPage.parse(
        ok(await call('get', `/${c.id}/recipients?engagement=not_opened`, ownerA)),
      ).items,
    ).toHaveLength(1);
    const act = CommunicationActivityPage.parse(
      ok(await call('get', `/${c.id}/activity?type=OPENED`, ownerA)),
    );
    expect(act.total).toBe(2);
    expect(act.items.every((i) => i.source === 'PROVIDER')).toBe(true);
    // An unsubscribe updates consent, so the next campaign leaves the person out.
    expect(await ev(b!, 'UNSUBSCRIBED', `u1-${c.id}`)).toBe('applied');
    const consent = ConsentView.parse(
      ok(await call('get', `/consent?clientId=${b!.clientId}`, ownerA)),
    );
    expect(consent.items[0]).toMatchObject({
      channel: 'EMAIL',
      status: 'OPTED_OUT',
      source: 'unsubscribe_link',
    });
    expect(
      CommunicationResults.parse(ok(await call('get', `/${c.id}/results`, ownerA))).metrics
        .unsubscribed.count,
    ).toBe(1);
    // An event for another firm's campaign, or for no one, changes nothing.
    expect(
      await delivery().applyEvent(firms.b, {
        communicationId: c.id,
        recipientId: a!.id,
        type: 'OPENED',
        providerEventId: `x-${c.id}`,
        occurredAt: at,
      }),
    ).toBe('ignored');
    await inFirm('a', (tx) =>
      tx.communicationConsent.deleteMany({ where: { clientId: b!.clientId } }),
    );
  });

  it('records a refusal, and a resend makes a new draft for those who can still get it', async () => {
    const c = await sentCampaign({ who: [people2.p2, people2.p4], name: mark('Fails') });
    gmail.fail.set(mailAddress('p2'), new DeliveryError('mailbox_full', false));
    const r = await runJob();
    gmail.fail.clear();
    expect(r).toMatchObject({ sent: 1, failed: 1 });
    const rows = await recipientsOf(c.id);
    expect(rows.map((x) => [x.status, x.failureCode]).sort()).toEqual([
      ['FAILED', 'mailbox_full'],
      ['SENT', null],
    ]);
    const res = CommunicationResults.parse(ok(await call('get', `/${c.id}/results`, ownerA)));
    expect(res.metrics.failed.count).toBe(1);
    expect(res.failureReasons).toEqual([{ code: 'mailbox_full', label: 'mailbox full', count: 1 }]);
    expect(res.canResendFailed).toBe(true);
    const again = detailOf(await call('post', `/${c.id}/resend-failed`, ownerA), 201);
    expect(again).toMatchObject({ status: 'DRAFT', sourceId: c.id, sourceKind: 'RESEND_FAILED' });
    expect(again.audience).toMatchObject({ finalCount: 1, selectedCount: 1 });
    // The original is untouched.
    expect((await getDetail(c.id)).status).toBe('SENT');
    // Someone who opted out since is not offered the resend.
    ok(
      await call('put', '/consent', ownerA, {
        clientId: people2.p2,
        channel: 'EMAIL',
        status: 'OPTED_OUT',
      }),
    );
    expectError(
      await call('post', `/${c.id}/resend-failed`, ownerA),
      409,
      'NO_ELIGIBLE_RECIPIENTS',
    );
    await inFirm('a', (tx) =>
      tx.communicationConsent.deleteMany({ where: { clientId: people2.p2 } }),
    );
    // A follow-up aimed at those who did not open.
    const follow = detailOf(
      await call('post', `/${c.id}/follow-up`, ownerA, { group: 'FAILED' }),
      201,
    );
    expect(follow).toMatchObject({ sourceKind: 'FOLLOW_UP', sourceId: c.id });
    expectError(
      await call('post', `/${c.id}/follow-up`, ownerA, { group: 'CLICKED' }),
      409,
      'NO_ELIGIBLE_RECIPIENTS',
    );
  });

  it('keeps going while a connection needs attention, and does not send while paused', async () => {
    const c = await sentCampaign({ who: [people2.p2] });
    ok(await call('post', `/${c.id}/pause`, ownerA));
    gmail.sent.length = 0;
    expect(await runJob()).toMatchObject({ sent: 0 });
    expectError(await call('post', `/${c.id}/pause`, ownerA), 409, 'NOT_EDITABLE');
    ok(await call('post', `/${c.id}/resume`, ownerA));
    await inFirm('a', (tx) =>
      tx.integrationConnection.updateMany({
        where: { businessId: firms.a, provider: 'gmail' },
        data: { status: 'NEEDS_ATTENTION', statusReason: 'authorization_expired' },
      }),
    );
    expect(await runJob()).toMatchObject({ sent: 0, failed: 0 });
    expect((await recipientsOf(c.id)).map((x) => x.status)).toEqual(['QUEUED']);
    expect((await getDetail(c.id)).status).toBe('SENDING');
    await inFirm('a', (tx) =>
      tx.integrationConnection.updateMany({
        where: { businessId: firms.a, provider: 'gmail' },
        data: { status: 'CONNECTED', statusReason: null },
      }),
    );
    expect(await runJob()).toMatchObject({ sent: 1 });
    expect((await getDetail(c.id)).status).toBe('SENT');
    // While it is still going out the results are partial and cannot be exported or followed up.
    const going = await sentCampaign({ who: [people2.p2] });
    expectError(await call('post', `/${going.id}/resend-failed`, ownerA), 409, 'STILL_SENDING');
    await runJob();
  });

  it('starts a scheduled campaign when its time comes, and cancels one that cannot go', async () => {
    const d = await draft({ name: mark('Timed') });
    await edit(d.id, { subject: 'Timed', body: '<p>Timed [Client First Name]</p>' });
    ok(await audienceOf(d.id, { clientIds: [people2.p2] }));
    ok(
      await call('post', `/${d.id}/schedule`, ownerA, {
        idempotencyKey: key(),
        scheduledFor: new Date(Date.now() + 3 * 3_600_000).toISOString(),
        etag: (await getDetail(d.id)).etag,
      }),
    );
    // Not yet.
    expect(await runJob()).toMatchObject({ started: 0 });
    expect((await getDetail(d.id)).status).toBe('SCHEDULED');
    await inFirm('a', (tx) =>
      tx.communication.update({
        where: { id: d.id },
        data: { scheduledFor: new Date(Date.now() - 1_000) },
      }),
    );
    gmail.sent.length = 0;
    expect(await runJob()).toMatchObject({ started: 1, sent: 1 });
    expect(gmail.sent.map((m) => m.to)).toEqual([mailAddress('p2')]);
    const done = await getDetail(d.id);
    expect(done).toMatchObject({ status: 'SENT', finalCount: 1 });
    expect(done.audience?.finalCount).toBe(1);
    // The audience is worked out again at the time: everyone opted out since, so it is cancelled.
    const e = await draft({ name: mark('Timed empty') });
    await edit(e.id, { subject: 'Timed', body: '<p>Timed</p>' });
    ok(await audienceOf(e.id, { clientIds: [people2.p2] }));
    ok(
      await call('post', `/${e.id}/schedule`, ownerA, {
        idempotencyKey: key(),
        scheduledFor: new Date(Date.now() + 3 * 3_600_000).toISOString(),
        etag: (await getDetail(e.id)).etag,
      }),
    );
    ok(
      await call('put', '/consent', ownerA, {
        clientId: people2.p2,
        channel: 'EMAIL',
        status: 'OPTED_OUT',
      }),
    );
    await inFirm('a', (tx) =>
      tx.communication.update({
        where: { id: e.id },
        data: { scheduledFor: new Date(Date.now() - 1_000) },
      }),
    );
    expect(await runJob()).toMatchObject({ started: 0 });
    const gone = await getDetail(e.id);
    expect(gone.status).toBe('CANCELLED');
    const rows = await auditRows(e.id);
    expect(rows.find((r) => r.action === 'communication.schedule_failed')?.metadata).toMatchObject({
      codes: ['NO_RECIPIENTS'],
    });
    await inFirm('a', (tx) =>
      tx.communicationConsent.deleteMany({ where: { clientId: people2.p2 } }),
    );
  });

  it('exports masked results for those who may, and nobody else', async () => {
    const c = await sentCampaign({ who: [people2.p2, people2.p4] });
    expectError(await call('post', `/${c.id}/export`, ownerA, {}), 409, 'STILL_SENDING');
    await runJob();
    const out = CommunicationExport.parse(ok(await call('post', `/${c.id}/export`, ownerA, {})));
    expect(out.rowCount).toBe(2);
    expect(out.fileName).toMatch(/-results-\d{4}-\d{2}-\d{2}\.csv$/);
    const key = [...files.objects.keys()].find((k) => out.url.includes(k))!;
    expect(key).toMatch(new RegExp(`^tenant/${firms.a}/reports/communication-`));
    const csv = files.objects.get(key)!.toString('utf8');
    expect(csv).toContain('"Recipient","Address","Status"');
    expect(csv).toContain('p***@camp.test');
    expect(csv).not.toContain(mailAddress('p2'));
    // Staff have no Export capability in the grid; a reader may not create anything.
    expectError(await call('post', `/${c.id}/export`, staffA, {}), 403, 'EXPORT_NOT_ALLOWED');
    expect((await call('post', `/${c.id}/export`, readerA, {})).status).toBe(403);
    const exportRows = await auditRows(c.id);
    expect(exportRows.map((r) => r.action)).toContain('communication.exported');
  });

  it('previews as made-up data or as one client, and loads a template as a snapshot', async () => {
    const d = await draft();
    await edit(d.id, {
      subject: 'Hi [Client First Name] about [Appointment Date]',
      body: '<p>[Client Full Name] at [Business Name]</p>',
    });
    const sample = RenderedTemplate.parse(ok(await call('post', `/${d.id}/preview`, ownerA, {})));
    expect(sample).toMatchObject({ sample: true, unresolved: [] });
    expect(sample.subject).toBe('Hi Jamie about Tuesday, March 3, 2026');
    const real = RenderedTemplate.parse(
      ok(await call('post', `/${d.id}/preview`, ownerA, { clientId: people2.p2 })),
    );
    expect(real).toMatchObject({ sample: false, unresolved: ['Appointment Date'] });
    expect(real.body).toBe('<p>Pat Two (fake) at Firm r55c-a-' + run + '</p>');
    expect((await call('post', `/${d.id}/preview`, ownerA, { clientId: clients.cB })).status).toBe(
      404,
    );
    // Nothing was recorded by previewing.
    expect(await recipientsOf(d.id)).toHaveLength(0);
    const t = await inFirm('a', (tx) =>
      tx.messageTemplate.create({
        data: {
          businessId: firms.a,
          kind: 'EMAIL',
          name: mark('Snap'),
          subject: 'Snap subject',
          body: '<p>Snap body</p>',
          status: 'ACTIVE',
          ownerUserId: ownerA.id,
          version: 2,
        },
      }),
    );
    const used = detailOf(
      await call('post', `/${d.id}/use-template`, ownerA, {
        templateId: t.id,
        etag: (await getDetail(d.id)).etag,
      }),
    );
    expect(used).toMatchObject({ subject: 'Snap subject', template: { id: t.id, version: 2 } });
    await inFirm('a', (tx) =>
      tx.messageTemplate.update({ where: { id: t.id }, data: { body: '<p>Master changed</p>' } }),
    );
    expect((await getDetail(d.id)).body).toBe('<p>Snap body</p>');
    expectError(
      await call('post', `/${d.id}/use-template`, ownerA, {
        templateId: randomUUID(),
        etag: used.etag,
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('expires a published announcement', async () => {
    const d = await draft({ channel: 'ANNOUNCEMENT', name: mark('Old news') });
    await edit(d.id, { subject: 'Old news', body: '<p>Done</p>' });
    ok(await audienceOf(d.id, { clientIds: [people2.p1] }));
    ok(
      await call('post', `/${d.id}/send`, ownerA, {
        idempotencyKey: key(),
        etag: (await getDetail(d.id)).etag,
      }),
    );
    expect(detailOf(await call('post', `/${d.id}/expire`, ownerA)).archived).toBe(true);
    const email = await draft();
    expectError(await call('post', `/${email.id}/expire`, ownerA), 409, 'NOT_EDITABLE');
    expectError(await call('get', `/${d.id}/results`, ownerB, undefined, 'b'), 404, 'NOT_FOUND');
  });
});

describe('a provider with no adapter', () => {
  it('is not ready, and says so', async () => {
    await inFirm('a', (tx) =>
      tx.integrationConnection.create({
        data: { businessId: firms.a, provider: 'textmagic', status: 'CONNECTED' },
      }),
    );
    const ov = CommunicationsOverview.parse(ok(await call('get', '/overview', ownerA)));
    expect(ov.channels.find((c) => c.channel === 'SMS')).toMatchObject({
      ready: false,
      route: 'INTEGRATIONS',
      reason: 'Sending through Textmagic is not available yet',
    });
    expectError(await call('post', '', ownerA, { channel: 'SMS' }), 409, 'CHANNEL_UNAVAILABLE');
    const senders = CommunicationSenderList.parse(ok(await call('get', '/senders', ownerA)));
    expect(senders.items.find((s) => s.channel === 'SMS')).toMatchObject({
      verified: false,
      providerHealthy: true,
    });
  });
});

// ---------- Test send, save as template, files ----------

describe('test send, templates and files', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const start = (id: string, bytes: Buffer, over: object = {}, who: Who = ownerA) =>
    call('post', `/${id}/attachments/uploads`, who, {
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: sha(bytes),
      ...over,
    });

  it('sends a test only to the caller, marked as a test, and records nothing', async () => {
    const d = await draft({ name: mark('Test') });
    await edit(d.id, {
      subject: 'About [Client First Name]',
      body: '<p>Dear [Client Full Name]</p>',
    });
    gmail.sent.length = 0;
    ok(await call('post', `/${d.id}/test-send`, ownerA, {}));
    expect(gmail.sent).toHaveLength(1);
    expect(gmail.sent[0]).toMatchObject({ to: ownerA.email, subject: '[Test] About Fake' });
    expect(gmail.sent[0]?.body).toContain('Dear Fake R55c ownerA');
    expect(gmail.sent[0]?.reference).toMatch(/^test-/);
    // Not a recipient, not in the results, not in the activity.
    expect(await recipientsOf(d.id)).toHaveLength(0);
    expectError(
      await call('post', `/${d.id}/test-send`, ownerA, { toEmail: 'someone@else.test' }),
      400,
      'TEST_SEND_REFUSED',
    );
    ok(await call('post', `/${d.id}/test-send`, ownerA, { toEmail: ownerA.email.toUpperCase() }));
    expect(gmail.sent).toHaveLength(2);
    const rows = await auditRows(d.id);
    expect(rows.map((r) => r.action)).toContain('communication.test_sent');
    expect(JSON.stringify(rows)).not.toContain(ownerA.email);
    // A provider refusal is a gateway error, not a crash.
    gmail.fail.set(ownerA.email, new DeliveryError('mailbox_full', false));
    expectError(await call('post', `/${d.id}/test-send`, ownerA, {}), 502, 'PROVIDER_ERROR');
    gmail.fail.clear();
    const ann = await draft({ channel: 'ANNOUNCEMENT' });
    expect((await call('post', `/${ann.id}/test-send`, ownerA, {})).status).toBe(400);
    expectError(await call('post', `/${d.id}/test-send`, staffA, {}), 404, 'NOT_FOUND');
  });

  it('turns a draft into a NEW template and leaves the rest alone', async () => {
    const d = await draft();
    await edit(d.id, { subject: 'Reusable', body: '<p>Reusable body</p>', previewText: 'pre' });
    const t = MessageTemplateDetail.parse(
      ok(
        await call('post', `/${d.id}/save-as-template`, ownerA, { name: mark('From draft') }),
        201,
      ),
    );
    expect(t).toMatchObject({ kind: 'EMAIL', status: 'DRAFT', subject: 'Reusable', version: 1 });
    expect(t.body).toBe('<p>Reusable body</p>');
    expect((await getDetail(d.id)).template).toBeNull();
    expect((await call('post', `/${d.id}/save-as-template`, ownerA, { name: '' })).status).toBe(
      400,
    );
    expect(
      (
        await call('post', `/${d.id}/save-as-template`, ownerA, {
          name: 'x',
          categoryId: randomUUID(),
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    const rows = await auditRows(d.id);
    expect(rows.map((r) => r.action)).toContain('communication.saved_as_template');
  });

  it('uploads a file in three steps, keeps the etag valid, and removes it', async () => {
    const d = await draft();
    const ticket = UploadTicket.parse(ok(await start(d.id, pdf)));
    storage.put(ticket, pdf);
    const before = (await getDetail(d.id)).etag;
    const att = CommunicationAttachment.parse(
      ok(
        await call('post', '/attachments/uploads/confirm', ownerA, {
          uploadToken: ticket.uploadToken,
        }),
      ),
    );
    expect(att).toMatchObject({ fileName: 'guide.pdf', sizeBytes: pdf.length });
    const after = await getDetail(d.id);
    expect(after.attachments.map((a) => a.id)).toEqual([att.id]);
    // The autosave that follows an upload still works.
    expect(after.etag).toBe(before);
    ok(await call('patch', `/${d.id}`, ownerA, { etag: before, name: mark('With file') }));
    // The same ticket cannot be confirmed twice.
    expectError(
      await call('post', '/attachments/uploads/confirm', ownerA, {
        uploadToken: ticket.uploadToken,
      }),
      410,
      'UPLOAD_EXPIRED',
    );
    ok(await call('delete', `/${d.id}/attachments/${att.id}`, ownerA));
    expect((await getDetail(d.id)).attachments).toHaveLength(0);
    expectError(await call('delete', `/${d.id}/attachments/${att.id}`, ownerA), 404, 'NOT_FOUND');
    const rows = await auditRows(d.id);
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'communication_attachment.added',
        'communication_attachment.removed',
      ]),
    );
    expect(JSON.stringify(rows)).not.toContain('guide.pdf');
  });

  it('checks the stored bytes and the channel', async () => {
    const d = await draft();
    const wrong = UploadTicket.parse(ok(await start(d.id, pdf)));
    storage.put(wrong, Buffer.from('not the same bytes at all!!!!!!!!!'));
    expectError(
      await call('post', '/attachments/uploads/confirm', ownerA, {
        uploadToken: wrong.uploadToken,
      }),
      409,
      'UPLOAD_MISMATCH',
    );
    const notPdf = Buffer.from('hello, I am plain text');
    const fake = UploadTicket.parse(ok(await start(d.id, notPdf)));
    storage.put(fake, notPdf);
    expect(
      (
        await call('post', '/attachments/uploads/confirm', ownerA, {
          uploadToken: fake.uploadToken,
        })
      ).status,
    ).toBe(409);
    expect((await start(d.id, pdf, { fileName: 'guide.png' })).status).toBe(400);
    // Another person's token is not valid for you; a staff member cannot touch the owner's draft.
    const mine = UploadTicket.parse(ok(await start(d.id, pdf)));
    storage.put(mine, pdf);
    expectError(
      await call('post', '/attachments/uploads/confirm', staffA, { uploadToken: mine.uploadToken }),
      410,
      'UPLOAD_EXPIRED',
    );
    expectError(await start(d.id, pdf, {}, staffA), 404, 'NOT_FOUND');
  });
});
