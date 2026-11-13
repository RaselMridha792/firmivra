// End-to-end: R55, Octavia's Leads Review Two (Nov 8), PR L1. R2 7: a lead's save answers with what
// it saved and is audited in the same transaction (one bulk change too), so an error always means
// nothing changed. R2 8: the Contact Information card's fields round-trip (date of birth is refused
// until leads keep one). R2 11: the required fields say what is missing, in her words. R2 5: a
// follow-up keeps the exact time it was given. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { LeadProfile } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55r2-${key}-${run}@r55.test` });
const people = { ownerA: person('owner-a'), ownerB: person('owner-b') };
const ids = { firmA: '', firmB: '', tax: '' };
let app: INestApplication;
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
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/leads${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const profile = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return LeadProfile.parse(res.body);
};
let n = 0;
const newLead = async (extra: object = {}) => {
  n += 1;
  return profile(
    await call('post', '', people.ownerA, {
      firstName: 'Pat',
      lastName: `Rtwo${n}x${run}`,
      email: `pat-r${n}-${run}@example.test`,
      source: 'REFERRAL',
      serviceIds: [ids.tax],
      ...extra,
    }),
    201,
  );
};

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    ids.firmA = (
      await tx.business.create({ data: { slug: `r55r2-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r55r2-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmA, userId: people.ownerA.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.tax = (
      await tx.service.create({
        data: { businessId: ids.firmA, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
  await owner.$disconnect();
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

describe('Leads Review Two, L1', () => {
  it('R2 7: a status change answers with the new status, as the lead reads, audited with it', async () => {
    const lead = await newLead({ stage: 'IN_REVIEW' });
    const saved = profile(
      await call('patch', `/${lead.id}`, people.ownerA, { stage: 'IN_FOLLOW_UP' }),
    );
    expect(saved.stage).toBe('IN_FOLLOW_UP');
    expect(profile(await call('get', `/${lead.id}/profile`, people.ownerA)).stage).toBe(
      'IN_FOLLOW_UP',
    );
    const audit = await asOwnerA((tx) =>
      tx.auditLog.findMany({ where: { action: 'lead.updated', entityId: lead.id } }),
    );
    expect(audit.map((a) => a.metadata)).toEqual([{ fields: ['stage'] }]);
    // The bulk bar's change too: its audit rows commit with it.
    const res = await call('post', '/bulk', people.ownerA, {
      action: 'STAGE',
      ids: [lead.id],
      stage: 'CONTACTED',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(
      await asOwnerA((tx) =>
        tx.auditLog.count({ where: { action: 'lead.bulk_stage', entityId: lead.id } }),
      ),
    ).toBe(1);
  });

  it('R2 8: address, preferred contact and best time are saved from the card; a date of birth is not yet', async () => {
    const lead = await newLead();
    const saved = profile(
      await call('patch', `/${lead.id}`, people.ownerA, {
        address: '12 Fake Street, Faketown, TX 75001',
        preferredContact: ['SMS', 'EMAIL'],
        bestTimeToContact: 'Weekday mornings',
      }),
    );
    expect(saved).toMatchObject({
      address: '12 Fake Street, Faketown, TX 75001',
      bestTimeToContact: 'Weekday mornings',
    });
    expect([...saved.preferredContact].sort()).toEqual(['EMAIL', 'SMS']);
    expectError(
      await call('patch', `/${lead.id}`, people.ownerA, { dateOfBirth: '1990-04-02' }),
      400,
      'FIELD_UNAVAILABLE',
    );
    // Cleared again: an empty address is none.
    expect(
      profile(await call('patch', `/${lead.id}`, people.ownerA, { address: '' })).address,
    ).toBe(null);
  });

  it('R2 11: blank and malformed required fields say what is missing, in her words', async () => {
    const blank = await call('post', '', people.ownerA, {
      firstName: '',
      lastName: ' ',
      email: '',
      source: 'REFERRAL',
      serviceIds: [ids.tax],
    });
    expectError(blank, 400, 'VALIDATION_FAILED');
    const details = (blank.body as { error: { details: { path: string; message: string }[] } })
      .error.details;
    expect(details).toEqual(
      expect.arrayContaining([
        { path: 'firstName', message: 'First name is required' },
        { path: 'lastName', message: 'Last name is required' },
        { path: 'email', message: 'Email is required' },
      ]),
    );
    const malformed = await call('post', '', people.ownerA, {
      firstName: 'Pat',
      lastName: 'Fake',
      email: 'not-an-email',
      source: 'REFERRAL',
      serviceIds: [ids.tax],
    });
    expect(
      (malformed.body as { error: { details: { path: string; message: string }[] } }).error.details,
    ).toEqual([{ path: 'email', message: 'Enter a valid email address' }]);
  });

  it('R2 5: a follow-up keeps the exact time it was saved with, through repeated saves', async () => {
    const lead = await newLead();
    const at = new Date(Date.now() + 3 * 86_400_000);
    at.setUTCHours(14, 15, 0, 0);
    const first = profile(
      await call('put', `/${lead.id}/follow-up`, people.ownerA, {
        type: 'CALL',
        dueAt: at.toISOString(),
        notes: null,
      }),
    );
    expect(first.nextAction?.dueAt).toBe(at.toISOString());
    // The same values again (the editor's unchanged save): nothing moves.
    const again = profile(
      await call('put', `/${lead.id}/follow-up`, people.ownerA, {
        type: 'CALL',
        dueAt: first.nextAction?.dueAt,
        notes: null,
      }),
    );
    expect(again.nextAction?.dueAt).toBe(at.toISOString());
    expect(again.followUps).toHaveLength(1);
  });

  it("firm B never reaches firm A's lead", async () => {
    const lead = await newLead();
    expectError(
      await call('patch', `/${lead.id}`, people.ownerB, { stage: 'CONTACTED' }, ids.firmB),
      404,
      'NOT_FOUND',
    );
  });
});

/** Firm A's rows, read as the owner (the audit's own check). */
async function asOwnerA<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn);
  } finally {
    await owner.$disconnect();
  }
}
