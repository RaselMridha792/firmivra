// End-to-end: Convert to Client from the Leads bulk bar (L12; Rasel, Oct 24). Each selected lead
// goes through the same conversion with what its record holds, or is skipped with the reason;
// Staff convert only their own leads, as themselves; firm B converts none of firm A's. Synthetic
// data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { BulkConvertLeadsResult, LeadProfile } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const Profile = z.strictObject(LeadProfile.shape);
const Result = z.strictObject(BulkConvertLeadsResult.shape);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55bc-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', tax: '', existingEmail: `existing-${run}@example.test` };

let app: INestApplication;
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

async function call(
  path: string,
  who: { email: string },
  body: object,
  businessId = ids.firmA,
): Promise<Response> {
  return request(app.getHttpServer())
    .post(`/api/v1/business/leads${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const inFirm = <T>(fn: (tx: Parameters<Parameters<typeof runInScope>[2]>[0]) => Promise<T>) => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  return runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn).finally(() =>
    owner.$disconnect(),
  );
};

let n = 0;
const newLead = async (extra: object = {}) => {
  n += 1;
  return Profile.parse(
    ok(
      await call('', people.ownerA, {
        firstName: 'Pat',
        lastName: `Bulk${n}x${run}`,
        email: `pat-b${n}-${run}@example.test`,
        phone: `+1555020${String(n).padStart(4, '0')}`,
        source: 'REFERRAL',
        serviceIds: [ids.tax],
        allowDuplicate: true,
        ...extra,
      }),
      201,
    ),
  );
};
const convert = (body: object, who = people.ownerA, businessId = ids.firmA) =>
  call(
    '/bulk-convert',
    who,
    { idempotencyKey: randomUUID(), sendPortalInvite: false, ...body },
    businessId,
  );

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `r55bc-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r55bc-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.tax = (
      await tx.service.create({ data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` } })
    ).id;
    await tx.client.create({
      data: { ...A, displayName: 'Existing (fake)', email: ids.existingEmail },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
  });
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
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

describe('Convert to Client from the bulk bar', () => {
  it('converts each lead from its record, skips the ones it cannot with the reason, and replays', async () => {
    const business = await newLead({
      businessName: `Acme ${run}`,
      assignedUserId: people.staffA.id,
    });
    const person = await newLead();
    const noPhone = await newLead({ phone: null });
    const taken = await newLead({ email: ids.existingEmail });
    const unknown = randomUUID();
    const key = randomUUID();
    const body = {
      idempotencyKey: key,
      ids: [business.id, person.id, noPhone.id, taken.id, unknown],
    };
    const first = Result.parse(ok(await convert(body)));
    expect(first.converted.map((c) => c.leadId)).toEqual([business.id, person.id]);
    expect(first.skipped).toEqual([
      {
        leadId: noPhone.id,
        name: `Pat ${noPhone.lastName}`,
        reason: 'No phone number: convert it on its own',
      },
      {
        leadId: taken.id,
        name: `Pat ${taken.lastName}`,
        reason: 'A client already has this email: convert it on its own to choose that client',
      },
      { leadId: unknown, name: '', reason: 'Not found, archived, or not one of yours' },
    ]);
    const made = await inFirm((tx) =>
      tx.client.findMany({
        where: { id: { in: first.converted.map((c) => c.clientId) } },
        select: { id: true, accountType: true, assignedUserId: true, email: true },
      }),
    );
    const byId = new Map(made.map((c) => [c.id, c]));
    expect(byId.get(first.converted[0]!.clientId)).toMatchObject({
      accountType: 'BUSINESS',
      assignedUserId: people.staffA.id,
    });
    expect(byId.get(first.converted[1]!.clientId)).toMatchObject({
      accountType: 'INDIVIDUAL',
      email: person.email,
    });
    const leads = await inFirm((tx) =>
      tx.lead.findMany({
        where: { id: { in: [business.id, person.id, noPhone.id] } },
        select: { id: true, status: true, clientId: true },
      }),
    );
    expect(new Map(leads.map((l) => [l.id, l.status]))).toEqual(
      new Map([
        [business.id, 'CONVERTED'],
        [person.id, 'CONVERTED'],
        [noPhone.id, 'SUBMITTED'],
      ]),
    );
    // A retry with the same key gives the same clients; nothing is made twice.
    const again = Result.parse(ok(await convert(body)));
    expect(again.converted).toEqual(first.converted);
    // A new key: the converted ones are already clients.
    const later = Result.parse(ok(await convert({ ids: [person.id] })));
    expect(later.skipped).toEqual([
      { leadId: person.id, name: `Pat ${person.lastName}`, reason: 'Already a client' },
    ]);
  });

  it('sends the portal invitations when asked', async () => {
    const lead = await newLead();
    const before = outbox.length;
    const res = Result.parse(ok(await convert({ ids: [lead.id], sendPortalInvite: true })));
    expect(res.converted).toHaveLength(1);
    expect(outbox.slice(before).some((m) => m.to === lead.email)).toBe(true);
  });

  it('checks a chosen staff member first, and Staff convert only their own leads, as themselves', async () => {
    const lead = await newLead();
    const other = await convert({ ids: [lead.id], primaryStaffUserId: people.ownerB.id });
    expect([other.status, codeOf(other)]).toEqual([404, 'NOT_FOUND']);

    const theirs = await newLead({ assignedUserId: people.staffA.id });
    const res = Result.parse(
      ok(
        await convert(
          { ids: [theirs.id, lead.id], primaryStaffUserId: people.ownerA.id },
          people.staffA,
        ),
      ),
    );
    expect(res.converted.map((c) => c.leadId)).toEqual([theirs.id]);
    expect(res.skipped.map((s) => s.leadId)).toEqual([lead.id]);
    const client = await inFirm((tx) =>
      tx.client.findUniqueOrThrow({
        where: { id: res.converted[0]!.clientId },
        select: { assignedUserId: true },
      }),
    );
    expect(client.assignedUserId).toBe(people.staffA.id);
  });

  it("firm B converts none of firm A's leads", async () => {
    const lead = await newLead();
    const res = Result.parse(ok(await convert({ ids: [lead.id] }, people.ownerB, ids.firmB)));
    expect(res).toEqual({
      converted: [],
      skipped: [{ leadId: lead.id, name: '', reason: 'Not found, archived, or not one of yours' }],
    });
    const after = await inFirm((tx) =>
      tx.lead.findUniqueOrThrow({ where: { id: lead.id }, select: { status: true } }),
    );
    expect(after.status).toBe('SUBMITTED');
  });
});
