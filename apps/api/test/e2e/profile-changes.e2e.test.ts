// End-to-end: Company Profile's Request Change (R60; Rasel's default of Oct 24). An Owner or Admin
// asks Firmivra to change the legal name, the EIN or the licensing details: a Portal support
// ticket in the Super Admin queue, with the current and proposed values and the reason. Nothing
// on the profile changes; the EIN is locked once the firm is Active; one firm never sees or
// reaches another's requests; the audit entry names the fields, never the values.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  FirmSettings,
  ProfileChange,
  ProfileChangeList,
  SupportTicketDetail,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60pc-${key}-${run}@r60pc.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
  ownerPending: person('owner-pending'),
};
const firms = {} as Record<'a' | 'b' | 'pending', { id: string }>;
const LEGAL_NAME = 'Fake R60 Legal Name LLC';

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.67.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

type Method = 'get' | 'patch' | 'post';
async function call(
  method: Method,
  path: string,
  who: { email: string },
  businessId: string | undefined,
  body?: object,
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', viewer());
  if (businessId) req = req.set('x-business-id', businessId);
  return body === undefined ? req : req.send(body);
}
const BASE = '/business/settings/profile/change-requests';
const ask = (who: { email: string }, businessId: string, body: object) =>
  call('post', BASE, who, businessId, body);
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

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

const ticketOf = (id: string) =>
  asOwner({ kind: 'platform' }, (tx) =>
    tx.supportTicket.findUniqueOrThrow({
      where: { id },
      include: { category: true, priority: true },
    }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    const make = async (key: keyof typeof firms, status: 'ACTIVE' | 'PENDING_SETUP') => {
      const slug = `r60pc-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status, ...(key === 'a' ? { legalName: LEGAL_NAME } : {}) },
        select: { id: true },
      });
    };
    await make('a', 'PENDING_SETUP');
    await make('b', 'ACTIVE');
    await make('pending', 'PENDING_SETUP');
  });
  for (const [businessId, userId, role] of [
    [firms.a.id, people.ownerA.id, 'OWNER'],
    [firms.a.id, people.adminA.id, 'ADMIN'],
    [firms.a.id, people.staffA.id, 'STAFF'],
    [firms.b.id, people.ownerB.id, 'OWNER'],
    [firms.pending.id, people.ownerPending.id, 'OWNER'],
  ] as const)
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;

  // Firm A enters its EIN in the setup wizard, then becomes Active.
  const setup = await call('patch', '/business/settings', people.ownerA, firms.a.id, {
    ein: '12-3456789',
  });
  expect(setup.status).toBe(200);
  await asOwner({ kind: 'platform' }, (tx) =>
    tx.business.update({ where: { id: firms.a.id }, data: { status: 'ACTIVE' } }),
  );
});

afterAll(async () => {
  await app.close();
});

const company = {
  kind: 'COMPANY',
  changes: { legalName: 'Fake R60 New Legal Name LLC', ein: '98-7654321' },
  reason: 'We registered a new legal name with the state.',
};

describe('POST and GET /business/settings/profile/change-requests', () => {
  let first: ProfileChange;

  it('an Owner asks: a Portal ticket in the Super Admin queue, and the profile is unchanged', async () => {
    const requestId = randomUUID();
    const res = await ask(people.ownerA, firms.a.id, { ...company, requestId });
    expect(res.status).toBe(201);
    first = ProfileChange.parse(res.body);
    expect(first).toMatchObject({
      number: expect.stringMatching(/^#\d+$/),
      kind: 'COMPANY',
      fields: ['legalName', 'ein'],
      status: 'OPEN',
      submittedBy: 'Fake ownerA',
      closedAt: null,
      latestReply: null,
    });

    const ticket = await ticketOf(first.id);
    expect(ticket).toMatchObject({
      businessId: firms.a.id,
      source: 'PORTAL',
      status: 'OPEN',
      contactUserId: people.ownerA.id,
      createdByUserId: people.ownerA.id,
      assignedUserId: null,
      idempotencyKey: requestId,
      subject: 'Company Information change request: Legal Company Name, EIN (Tax ID)',
    });
    expect(`#${ticket.number}`).toBe(first.number);
    expect([ticket.category.name, ticket.priority.code]).toEqual(['Compliance', 'MEDIUM']);
    for (const line of [
      'Fake ownerA (Owner) asks Firmivra',
      `Current: ${LEGAL_NAME}`,
      'Proposed: Fake R60 New Legal Name LLC',
      'Current: Ending in 6789',
      'Proposed: 98-7654321',
      company.reason,
    ])
      expect(ticket.description).toContain(line);

    // The Super Admin team reads it in the queue.
    const detail = await call(
      'get',
      `/admin/support/tickets/${first.id}`,
      fx.users.admin,
      undefined,
    );
    expect(detail.status).toBe(200);
    expect(SupportTicketDetail.parse(detail.body)).toMatchObject({
      source: 'PORTAL',
      status: 'OPEN',
      description: ticket.description,
    });

    // Nothing on the profile changed.
    const settings = FirmSettings.parse(
      (await call('get', '/business/settings', people.ownerA, firms.a.id)).body,
    );
    expect([settings.business.legalName, settings.einLast4]).toEqual([LEGAL_NAME, '6789']);

    // The audit entry names the fields, never the values.
    const audits = await asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a.id, action: 'settings.profile_change_requested' },
      }),
    );
    expect(audits.map((a) => [a.entityId, a.metadata])).toEqual([
      [first.id, { kind: 'COMPANY', fields: ['legalName', 'ein'], number: ticket.number }],
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/987654321|98-7654321|New Legal Name/);
  });

  it('the same requestId answers the first request; an Admin asks too; newest first', async () => {
    const ticket = await ticketOf(first.id);
    const again = await ask(people.ownerA, firms.a.id, {
      ...company,
      requestId: ticket.idempotencyKey,
    });
    expect([again.status, ProfileChange.parse(again.body).id]).toEqual([201, first.id]);
    const count = await asOwner({ kind: 'platform' }, (tx) =>
      tx.supportTicket.count({ where: { idempotencyKey: ticket.idempotencyKey } }),
    );
    expect(count).toBe(1);

    const licensing = await ask(people.adminA, firms.a.id, {
      requestId: randomUUID(),
      kind: 'LICENSING',
      changes: { licenseNumber: 'CPA-000000', expirationDate: '2027-12-31' },
      reason: 'Our license was renewed.',
    });
    expect(licensing.status).toBe(201);
    const second = ProfileChange.parse(licensing.body);
    expect(second).toMatchObject({
      kind: 'LICENSING',
      fields: ['licenseNumber', 'expirationDate'],
      submittedBy: 'Fake adminA',
    });
    const row = await ticketOf(second.id);
    expect(row.subject).toBe(
      'Professional Licensing change request: License Number, Expiration Date',
    );
    expect(row.description).toContain('License Number\nCurrent: Not on file\nProposed: CPA-000000');

    const list = ProfileChangeList.parse((await call('get', BASE, people.adminA, firms.a.id)).body);
    expect(list.items.map((i) => i.id)).toEqual([second.id, first.id]);
  });

  it("shows Firmivra's status and latest sent reply, never a reply kept back", async () => {
    const reply = (body: string, sendToClient: boolean) =>
      call('post', `/admin/support/tickets/${first.id}/replies`, fx.users.admin, undefined, {
        mode: 'REPLY',
        body,
        sendToClient,
      });
    expect((await reply('We need the state filing to apply this.', true)).status).toBe(200);
    expect((await reply('Internal draft, not sent.', false)).status).toBe(200);
    const detail = SupportTicketDetail.parse(
      (await call('get', `/admin/support/tickets/${first.id}`, fx.users.admin, undefined)).body,
    );
    const resolved = await call(
      'patch',
      `/admin/support/tickets/${first.id}`,
      fx.users.admin,
      undefined,
      {
        version: detail.version,
        status: 'RESOLVED',
      },
    );
    expect(resolved.status).toBe(200);

    const list = ProfileChangeList.parse((await call('get', BASE, people.ownerA, firms.a.id)).body);
    const mine = list.items.find((i) => i.id === first.id)!;
    expect(mine).toMatchObject({
      status: 'RESOLVED',
      closedAt: expect.any(String),
      latestReply: { body: 'We need the state filing to apply this.', at: expect.any(String) },
    });
  });

  it('refuses a request with nothing to change, the other card, the current name, or bad text', async () => {
    const base = { requestId: randomUUID(), kind: 'COMPANY', reason: 'A reason.' };
    for (const body of [
      { ...base, changes: {} },
      { ...base, changes: { licenseNumber: 'CPA-1' } },
      { ...base, kind: 'LICENSING', changes: { ein: '123456789' } },
      { ...base, changes: { ein: '12345678' } },
      { ...base, changes: { legalName: 'Fake' }, reason: '' },
      { ...base, changes: { legalName: 'Fake' }, reason: 'soft\u00ADhyphen' },
      { ...base, changes: { legalName: 'Fake', website: 'https://x.test' } },
      { ...base, changes: { expirationDate: '2027-02-30' }, kind: 'LICENSING' },
      { ...base, requestId: 'not-a-uuid', changes: { legalName: 'Fake' } },
    ]) {
      const res = await ask(people.ownerA, firms.a.id, body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    const same = await ask(people.ownerA, firms.a.id, {
      ...base,
      changes: { legalName: LEGAL_NAME },
    });
    expect([same.status, codeOf(same)]).toEqual([400, 'VALIDATION_FAILED']);
    expect((same.body as { error: { details: unknown } }).error.details).toEqual([
      { path: 'changes.legalName', message: 'This is already the legal name' },
    ]);
  });

  it("refuses Staff; another firm sees none of A's requests and cannot reuse A's key", async () => {
    for (const res of [
      await call('get', BASE, people.staffA, firms.a.id),
      await ask(people.staffA, firms.a.id, { ...company, requestId: randomUUID() }),
    ])
      expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);

    const outsider = await call('get', BASE, people.ownerB, firms.a.id);
    expect([outsider.status, codeOf(outsider)]).toEqual([404, 'NOT_FOUND']);
    const theirs = ProfileChangeList.parse(
      (await call('get', BASE, people.ownerB, firms.b.id)).body,
    );
    expect(theirs.items).toEqual([]);

    const ticket = await ticketOf(first.id);
    const reused = await ask(people.ownerB, firms.b.id, {
      ...company,
      requestId: ticket.idempotencyKey,
    });
    expect([reused.status, codeOf(reused)]).toEqual([409, 'CONFLICT']);
    expect(JSON.stringify(reused.body)).not.toContain(first.id);
  });
});

describe('PATCH /business/settings: the EIN', () => {
  it('is locked once the firm is Active, and open in the setup wizard while Pending Setup', async () => {
    const locked = await call('patch', '/business/settings', people.ownerA, firms.a.id, {
      ein: '111111111',
    });
    expect([locked.status, codeOf(locked)]).toEqual([403, 'EIN_LOCKED']);
    const cleared = await call('patch', '/business/settings', people.adminA, firms.a.id, {
      ein: null,
    });
    expect([cleared.status, codeOf(cleared)]).toEqual([403, 'EIN_LOCKED']);
    const other = await call('patch', '/business/settings', people.ownerA, firms.a.id, {
      teamSize: 4,
    });
    expect(FirmSettings.parse(other.body)).toMatchObject({ teamSize: 4, einLast4: '6789' });

    const setup = await call('patch', '/business/settings', people.ownerPending, firms.pending.id, {
      ein: '12-3456789',
    });
    expect(setup.status).toBe(200);
    expect(FirmSettings.parse(setup.body).einLast4).toBe('6789');
  });
});
