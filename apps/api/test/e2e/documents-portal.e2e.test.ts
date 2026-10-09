// End-to-end: R5 part 2, built in three stacked PRs. This one: the firm's document requests
// (list, create with the email to the client's logins, accept, mark missing, cancel), Staff only
// for their clients, firm B never reaching firm A's, and the audit (ids only). The portal routes
// with the household rules (the next PR) and the scan results (the one after) add their tests
// here. Storage is in memory here (CI has no s3mock).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { z } from 'zod';
import { FirmDocumentRequest, FirmDocumentRequestList } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { sha256 } from '../office-files.js';

/** Storage in memory: `objects.set(key, bytes)` is the browser's PUT. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  head(key: string, { checksum = false } = {}) {
    const b = this.objects.get(key);
    const found = b && {
      sizeBytes: b.length,
      sha256: checksum ? sha256(b) : null,
      contentEncoding: null,
    };
    return Promise.resolve(found ?? null);
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
}
const storage = new MemoryStorage();
/** SCAN_MODE: local marks a confirmed file CLEAN; guardduty leaves it PENDING for a result. */
const config: DocumentsConfig = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'local',
};
const outbox: NotifyMessage[] = [];

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string, pool: 'STAFF' | 'CLIENT' = 'CLIENT') => ({
  id: randomUUID(),
  email: `r5p-${key}-${run}@r5.test`,
  name: `Fake R5 ${key}`,
  pool,
});
const people = {
  ownerA: person('owner-a', 'STAFF'),
  staffA: person('staff-a', 'STAFF'),
  staffA2: person('staff-a2', 'STAFF'),
  ownerB: person('owner-b', 'STAFF'),
  primary: person('primary'),
  spouse: person('spouse'),
  authorized: person('authorized'),
  other: person('other'),
  stop: person('stop'),
  clientB: person('client-b'),
};
type Person = (typeof people)[keyof typeof people];
type Firm = 'a' | 'b';
const firms = {} as Record<Firm, { id: string; slug: string }>;
/** c1 is staffA's with three logins; c2 has `other`; c3 (`stop`) has only a PENDING service. */
const ids = {} as Record<
  'c1' | 'c2' | 'c3' | 'cB' | 'e1' | 'e1b' | 'e1p' | 'e2' | 'e3p' | 'eB' | 'cat' | 'old',
  string
>;
const accounts = {} as Record<'primary' | 'spouse' | 'authorized', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.51.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.6`;

async function asOwner<T>(businessId: string | null, work: Parameters<typeof runInScope<T>>[2]) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    const scope = businessId
      ? ({ kind: 'business', businessId } as const)
      : ({ kind: 'platform' } as const);
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

async function tokenFor(who: Person): Promise<string> {
  const cached = tokens.get(who.email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email: who.email });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const { token } = res.body as { token: string };
  tokens.set(who.email, token);
  return token;
}

/** A portal call (`/me...` on the firm's portal) or a firm call (`/business...`). */
async function call(
  method: 'get' | 'post',
  path: string,
  who: Person,
  body?: object,
  firm: Firm = 'a',
) {
  const portal = path.startsWith('/me');
  const req = request(app.getHttpServer())
    [method](portal ? `/api/v1/portal/${firms[firm].slug}${path}` : `/api/v1/business${path}`)
    .set('authorization', `Bearer ${await tokenFor(who)}`)
    .set('x-forwarded-for', viewer());
  if (!portal) req.set('x-business-id', firms[firm].id);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string; message: string } }).error;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)?.code], JSON.stringify(res.body)).toEqual([status, code]);
/** Parses with the contract and refuses anything it does not name (a leaked field fails). */
function exact<S extends z.ZodType>(schema: S, res: Response): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

const newRequest = async (body: Record<string, unknown> = {}, who: Person = people.ownerA) =>
  exact(
    FirmDocumentRequest,
    await call('post', `/clients/${ids.c1}/document-requests`, who, {
      serviceId: ids.e1,
      title: 'W-2 from your employer',
      ...body,
    }),
  );
const decide = (id: string, action: 'accept' | 'reject' | 'cancel', who: Person = people.ownerA) =>
  call(
    'post',
    `/document-requests/${id}/${action}`,
    who,
    action === 'reject' ? { reason: 'Pages are missing' } : {},
  );
const auditOf = (entityId: string) =>
  asOwner(firms.a.id, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
  );

beforeAll(async () => {
  await asOwner(null, async (tx) => {
    for (const { id, pool, email, name } of Object.values(people)) {
      await tx.user.create({ data: { id, cognitoSub: id, pool, email, name } });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r5p-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  const staff = [
    ['a', people.ownerA, 'OWNER'],
    ['a', people.staffA, 'STAFF'],
    ['a', people.staffA2, 'STAFF'],
    ['b', people.ownerB, 'OWNER'],
  ] as const;
  for (const [firm, p, role] of staff) {
    const businessId = firms[firm].id;
    await asOwner(businessId, (tx) =>
      tx.membership.create({ data: { businessId, userId: p.id, role, status: 'ACTIVE' } }),
    );
  }
  const setUp = (firm: Firm) => {
    const businessId = firms[firm].id;
    return asOwner(businessId, async (tx) => {
      const client = (assignedUserId: string | null = null) =>
        tx.client
          .create({ data: { businessId, displayName: 'R5 Client (fake)', assignedUserId } })
          .then((c) => c.id);
      const login = (
        who: Person,
        clientId: string,
        portalRole: 'PRIMARY' | 'SPOUSE' | 'AUTHORIZED' = 'PRIMARY',
      ) =>
        tx.clientAccount
          .create({
            data: {
              businessId,
              userId: who.id,
              email: who.email,
              clientId,
              portalRole,
              status: 'ACTIVE',
            },
          })
          .then((a) => a.id);
      const service = (kind: 'ANNUAL_TAX' | 'BOOKKEEPING') =>
        tx.service.create({ data: { businessId, kind, name: kind } }).then((s) => s.id);
      const engagement = (
        clientId: string,
        serviceId: string,
        status: 'ACTIVE' | 'PENDING' = 'ACTIVE',
      ) =>
        tx.engagement
          .create({
            data: { businessId, clientId, serviceId, title: 'R5 (fake)', taxYear: 2025, status },
          })
          .then((e) => e.id);
      const tax = await service('ANNUAL_TAX');
      if (firm === 'b') {
        ids.cB = await client();
        await login(people.clientB, ids.cB);
        ids.eB = await engagement(ids.cB, tax);
        return;
      }
      [ids.c1, ids.c2, ids.c3] = [await client(people.staffA.id), await client(), await client()];
      accounts.primary = await login(people.primary, ids.c1);
      accounts.spouse = await login(people.spouse, ids.c1, 'SPOUSE');
      accounts.authorized = await login(people.authorized, ids.c1, 'AUTHORIZED');
      await login(people.other, ids.c2);
      await login(people.stop, ids.c3);
      ids.e1 = await engagement(ids.c1, tax);
      ids.e1b = await engagement(ids.c1, await service('BOOKKEEPING'));
      ids.e1p = await engagement(ids.c1, tax, 'PENDING');
      ids.e2 = await engagement(ids.c2, tax);
      ids.e3p = await engagement(ids.c3, tax, 'PENDING');
      const category = (name: string, archivedAt: Date | null) =>
        tx.documentCategory.create({ data: { businessId, name, archivedAt } }).then((c) => c.id);
      ids.cat = await category('Tax Documents', null);
      ids.old = await category('Old', new Date());
    });
  };
  await setUp('a');
  await setUp('b');

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
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('document requests', () => {
  it('creates for an open service and emails the logins; Staff only their clients, firm B nothing', async () => {
    outbox.length = 0;
    const r = await newRequest({
      categoryId: ids.cat,
      dueOn: '2026-12-01',
      instructions: 'One per employer.',
    });
    expect(r).toMatchObject({
      clientId: ids.c1,
      status: 'REQUESTED',
      dueOn: '2026-12-01',
      category: { id: ids.cat },
      requestedBy: { userId: people.ownerA.id, name: people.ownerA.name },
      documents: [],
      resolvedAt: null,
    });
    expect(outbox.map((m) => [m.template, m.to]).sort()).toEqual(
      [people.primary, people.spouse, people.authorized]
        .map((p) => ['document.requested', p.email])
        .sort(),
    );
    const created = (await auditOf(r.id)).find((a) => a.action === 'document_request.created');
    expect(JSON.stringify(created?.metadata)).not.toMatch(/W-2|employer/);
    const create = (
      body: Record<string, unknown>,
      who: Person = people.ownerA,
      clientId = ids.c1,
      firm: Firm = 'a',
    ) =>
      call(
        'post',
        `/clients/${clientId}/document-requests`,
        who,
        { serviceId: ids.e1, title: 'X', ...body },
        firm,
      );
    expectError(await create({ serviceId: ids.e2 }), 404, 'NOT_FOUND');
    expectError(await create({ serviceId: ids.e1p }), 409, 'NO_OPEN_SERVICE');
    expectError(await create({ categoryId: ids.old }), 409, 'CATEGORY_ARCHIVED');
    expectError(await create({}, people.staffA2), 404, 'NOT_FOUND');
    expectError(await create({}, people.ownerB, ids.c1, 'b'), 404, 'NOT_FOUND');
    expect((await create({}, people.primary)).status).toBe(403);
    exact(FirmDocumentRequest, await create({}, people.staffA));

    const list = (who: Person, query = '', firm: Firm = 'a') =>
      call('get', `/clients/${ids.c1}/document-requests${query}`, who, undefined, firm);
    const items = exact(
      FirmDocumentRequestList,
      await list(people.staffA, '?status=REQUESTED'),
    ).items;
    expect(items.map((i) => i.id)).toContain(r.id);
    expect(items.every((i) => i.status === 'REQUESTED')).toBe(true);
    expectError(await list(people.staffA2), 404, 'NOT_FOUND');
    expectError(await list(people.ownerB, '', 'b'), 404, 'NOT_FOUND');
    for (const action of ['accept', 'reject', 'cancel'] as const) {
      expectError(await decide(r.id, action, people.staffA2), 404, 'NOT_FOUND');
      expectError(
        await call(
          'post',
          `/document-requests/${r.id}/${action}`,
          people.ownerB,
          { reason: 'x' },
          'b',
        ),
        404,
        'NOT_FOUND',
      );
    }
  });

  it('refuses accept and mark missing with nothing submitted, cancels, then refuses every change', async () => {
    const r = await newRequest();
    expectError(await decide(r.id, 'accept'), 409, 'NOTHING_SUBMITTED');
    expectError(await decide(r.id, 'reject'), 409, 'NOTHING_SUBMITTED');
    const cancelled = exact(FirmDocumentRequest, await decide(r.id, 'cancel', people.staffA));
    expect(cancelled).toMatchObject({ id: r.id, status: 'CANCELLED', statusNote: null });
    expect(cancelled.resolvedAt).not.toBeNull();
    for (const action of ['accept', 'reject', 'cancel'] as const) {
      expectError(await decide(r.id, action), 409, 'REQUEST_CLOSED');
    }
    const entries = await auditOf(r.id);
    expect(entries.map((a) => a.action)).toEqual([
      'document_request.created',
      'document_request.cancelled',
    ]);
    expect(entries[1]?.metadata).toEqual({ clientId: ids.c1, from: 'REQUESTED' });
  });
});
