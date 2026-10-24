// End-to-end: the Super Admin applies a firm's approved Company Profile Request Change (R56,
// Rasel Oct 24; R60's Request Change raises the ticket). A firm's Owner asks for a new legal name
// and EIN; the Super Admin lists the firm's requests with the ticket's values and applies them,
// through R1's definer function: the firm reads the new name and EIN, both audit logs name the
// fields and never the EIN. Only what the ticket asks applies; never to a firm in setup, a closed
// ticket, another firm's ticket or an EIN another firm applied with; only a Super Admin.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AppliedProfileChange,
  FirmProfileChanges,
  FirmSettings,
  ProfileChange,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { EIN_HASH_KEY, einHash, loadEinHashKey } from '../../src/firm-applications/ein-hash.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r56fp-${key}-${run}@r56fp.test` });
const people = {
  ownerA: person('owner-a'),
  ownerB: person('owner-b'),
  ownerPending: person('owner-pending'),
};
const firms = {} as Record<'a' | 'b' | 'pending', { id: string }>;
const LEGAL_NAME = 'Fake R56 Legal Name LLC';
const NEW_NAME = 'Fake R56 Holdings LLC';
const NEW_EIN = '98-7654321';
/** A test key for the EIN's keyed hash (the API's and this file's). */
const KEY = loadEinHashKey({ EIN_HASH_KEY: 'a1'.repeat(16) + 'b2'.repeat(16) });
/** Another firm applied with this one (`firm_applications.ein_hash`). */
const TAKEN_EIN = `11-${run.replace(/\D/g, '').padEnd(7, '7').slice(0, 7)}`;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.68.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

async function call(
  method: 'get' | 'patch' | 'post',
  path: string,
  who: { email: string } | null,
  businessId?: string,
  body?: object,
): Promise<Response> {
  let req = request(app.getHttpServer())[method](`/api/v1${path}`).set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  if (businessId) req = req.set('x-business-id', businessId);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const changes = (firmId: string) => `/admin/firms/${firmId}/profile-changes`;
const apply = (firmId: string, ticketId: string, body: object) =>
  call('post', `${changes(firmId)}/${ticketId}/apply`, fx.users.admin, undefined, body);

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

/** A Request Change raised on Company Profile by the firm's Owner (R60's route). */
async function ask(who: { email: string }, businessId: string, kind: string, changes: object) {
  const res = await call('post', '/business/settings/profile/change-requests', who, businessId, {
    requestId: randomUUID(),
    kind,
    changes,
    reason: 'Fake: the state approved the change.',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return ProfileChange.parse(res.body);
}

const tickets = {} as Record<'company' | 'licensing' | 'other' | 'pending', string>;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    for (const key of ['a', 'b', 'pending'] as const) {
      const slug = `r56fp-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'PENDING_SETUP', legalName: LEGAL_NAME },
        select: { id: true },
      });
    }
  });
  for (const [businessId, userId] of [
    [firms.a.id, people.ownerA.id],
    [firms.b.id, people.ownerB.id],
    [firms.pending.id, people.ownerPending.id],
  ] as const)
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } }),
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
  })
    .overrideProvider(EIN_HASH_KEY)
    .useValue(KEY)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;

  // Firms A and B enter their EIN in setup, then become Active; the third stays in setup.
  for (const [firm, who] of [
    [firms.a, people.ownerA],
    [firms.b, people.ownerB],
  ] as const) {
    const setup = await call('patch', '/business/settings', who, firm.id, { ein: '12-3456789' });
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  }
  await asOwner({ kind: 'platform' }, (tx) =>
    tx.business.updateMany({
      where: { id: { in: [firms.a.id, firms.b.id] } },
      data: { status: 'ACTIVE' },
    }),
  );

  tickets.company = (
    await ask(people.ownerA, firms.a.id, 'COMPANY', { legalName: NEW_NAME, ein: NEW_EIN })
  ).id;
  tickets.licensing = (
    await ask(people.ownerA, firms.a.id, 'LICENSING', { licenseNumber: 'CPA-000000' })
  ).id;
  tickets.other = (await ask(people.ownerB, firms.b.id, 'COMPANY', { legalName: 'Fake B LLC' })).id;
  tickets.pending = (
    await ask(people.ownerPending, firms.pending.id, 'COMPANY', { legalName: 'Fake Pending LLC' })
  ).id;

  // An application (no firm yet) that gave TAKEN_EIN.
  const key = KEY;
  if (!key.ok) throw new Error(key.problem);
  await asOwner({ kind: 'platform' }, (tx) =>
    tx.firmApplication.create({
      data: {
        legalName: `Fake R56 Applicant ${run}`,
        contactName: 'Fake Applicant',
        contactEmail: `r56fp-applicant-${run}@r56fp.test`,
        einLast4: TAKEN_EIN.slice(-4),
        einHash: new Uint8Array(einHash(key.key, TAKEN_EIN)),
        data: {},
      },
    }),
  );
});

afterAll(async () => {
  await app.close();
});

const settingsOf = async (who: { email: string }, firmId: string) =>
  FirmSettings.parse((await call('get', '/business/settings', who, firmId)).body);
const auditRows = (firmId: string, ticketId: string) =>
  asOwner({ kind: 'platform' }, (tx) =>
    tx.auditLog.findMany({
      where: { entityId: ticketId, action: { contains: 'profile_change_applied' } },
      select: { businessId: true, action: true, actorUserId: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  ).then((rows) => rows.map((r) => ({ ...r, mine: r.businessId === firmId })));

describe('GET /admin/firms/:id/profile-changes', () => {
  it("lists the firm's Request Changes with the ticket's values, newest first", async () => {
    const res = await call('get', changes(firms.a.id), fx.users.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = FirmProfileChanges.parse(res.body);
    expect(list.firm).toMatchObject({ id: firms.a.id, legalName: LEGAL_NAME, status: 'ACTIVE' });
    expect(list.requests.map((r) => r.ticketId)).toEqual([tickets.licensing, tickets.company]);
    expect(list.requests[1]).toMatchObject({
      kind: 'COMPANY',
      fields: ['legalName', 'ein'],
      current: { legalName: LEGAL_NAME, ein: 'Ending in 6789' },
      proposed: { legalName: NEW_NAME, ein: NEW_EIN },
      reason: 'Fake: the state approved the change.',
      applied: null,
    });
    // Another firm's request is not in this firm's list.
    expect(list.requests.some((r) => r.ticketId === tickets.other)).toBe(false);
  });
});

describe('POST /admin/firms/:id/profile-changes/:ticketId/apply', () => {
  it('applies the legal name and the EIN: the firm reads them; both logs name the fields only', async () => {
    const res = await apply(firms.a.id, tickets.company, { legalName: NEW_NAME, ein: NEW_EIN });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(AppliedProfileChange.parse(res.body)).toMatchObject({
      ticketId: tickets.company,
      fields: ['legalName', 'ein'],
      legalName: NEW_NAME,
      einLast4: '4321',
    });
    expect(JSON.stringify(res.body)).not.toContain('987654321');

    const firm = await asOwner({ kind: 'platform' }, (tx) =>
      tx.business.findUniqueOrThrow({ where: { id: firms.a.id }, select: { legalName: true } }),
    );
    expect(firm.legalName).toBe(NEW_NAME);
    expect(await settingsOf(people.ownerA, firms.a.id)).toMatchObject({ einLast4: '4321' });
    // Firm B is untouched.
    expect(await settingsOf(people.ownerB, firms.b.id)).toMatchObject({ einLast4: '6789' });

    const rows = await auditRows(firms.a.id, tickets.company);
    expect(rows.map((r) => [r.action, r.mine])).toEqual(
      expect.arrayContaining([
        ['settings.profile_change_applied', true],
        ['business.profile_change_applied', false],
      ]),
    );
    for (const r of rows) {
      expect(r.actorUserId).toBe(fx.users.admin.id);
      expect(JSON.stringify(r.metadata)).not.toMatch(/987654321|98-7654321/);
    }

    const list = FirmProfileChanges.parse(
      (await call('get', changes(firms.a.id), fx.users.admin)).body,
    );
    expect(list.firm.legalName).toBe(NEW_NAME);
    expect(list.requests.find((r) => r.ticketId === tickets.company)?.applied).toMatchObject({
      fields: ['legalName', 'ein'],
    });
  });

  it('applies only what the ticket asks: licensing waits for its table', async () => {
    const stray = await apply(firms.a.id, tickets.licensing, { legalName: 'Fake Stray LLC' });
    expect([stray.status, codeOf(stray)]).toEqual([400, 'NOT_REQUESTED']);
    const licence = await apply(firms.a.id, tickets.licensing, { licenseNumber: 'CPA-1' });
    expect([licence.status, codeOf(licence)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it("never applies to another firm's ticket, a firm in setup or a closed ticket", async () => {
    const other = await apply(firms.a.id, tickets.other, { legalName: 'Fake Cross LLC' });
    expect([other.status, codeOf(other)]).toEqual([404, 'NOT_FOUND']);
    const none = await apply(firms.a.id, randomUUID(), { legalName: 'Fake None LLC' });
    expect([none.status, codeOf(none)]).toEqual([404, 'NOT_FOUND']);
    const setup = await apply(firms.pending.id, tickets.pending, { legalName: 'Fake Setup LLC' });
    expect([setup.status, codeOf(setup)]).toEqual([409, 'FIRM_NOT_ACTIVE']);

    await asOwner({ kind: 'platform' }, (tx) =>
      tx.supportTicket.update({
        where: { id: tickets.other },
        data: { status: 'CLOSED', closedAt: new Date() },
      }),
    );
    const closed = await apply(firms.b.id, tickets.other, { legalName: 'Fake Closed LLC' });
    expect([closed.status, codeOf(closed)]).toEqual([409, 'TICKET_CLOSED']);
    const b = await asOwner({ kind: 'platform' }, (tx) =>
      tx.business.findUniqueOrThrow({ where: { id: firms.b.id }, select: { legalName: true } }),
    );
    expect(b.legalName).toBe(LEGAL_NAME);
  });

  it('refuses an EIN another firm applied with, and changes nothing', async () => {
    const res = await apply(firms.a.id, tickets.company, { ein: TAKEN_EIN });
    expect([res.status, codeOf(res)]).toEqual([409, 'DUPLICATE_EIN']);
    expect(await settingsOf(people.ownerA, firms.a.id)).toMatchObject({ einLast4: '4321' });
  });

  it('is for a Super Admin only: firm sessions and signed out get 401', async () => {
    const owner = await call(
      'post',
      `${changes(firms.a.id)}/${tickets.company}/apply`,
      people.ownerA,
      firms.a.id,
      {
        legalName: 'Fake Owner LLC',
      },
    );
    expect(owner.status).toBe(401);
    const list = await call('get', changes(firms.a.id), people.ownerA, firms.a.id);
    expect(list.status).toBe(401);
    const anonymous = await call('get', changes(firms.a.id), null);
    expect(anonymous.status).toBe(401);
  });
});
