// End-to-end: R55, L8 (Octavia's Leads review of Oct 20): a lead's follow-up steps. Several steps
// while creating the lead; add, edit, remove and complete later; the lead's Next Action is its next
// unfinished step (the list, the Overdue card and Automations read it); a next action set before
// steps existed is shown and adopted, never lost; a closed lead takes none; firm B reaches none.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { LeadProfile } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55l-${key}-${run}@r55.test` });
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
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
let n = 0;
const newLead = async (extra: object = {}) => {
  n += 1;
  return profile(
    await call('post', '', people.ownerA, {
      firstName: 'Pat',
      lastName: `Steps${n}x${run}`,
      email: `pat-s${n}-${run}@example.test`,
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
      await tx.business.create({ data: { slug: `r55l-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r55l-b-${run}`, name: 'B', status: 'ACTIVE' } })
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

describe('lead follow-up steps (L8)', () => {
  it('takes several steps at creation; the next action is the earliest unfinished one', async () => {
    const lead = await newLead({
      followUps: [
        { type: 'EMAIL', dueAt: inDays(5), notes: 'Send the checklist' },
        { type: 'CALL', dueAt: inDays(2), notes: null },
      ],
    });
    expect(lead.followUps.map((f) => f.type)).toEqual(['CALL', 'EMAIL']);
    expect(lead.nextAction).toMatchObject({ type: 'CALL' });

    // Add an earlier one: it becomes the next action.
    const added = profile(
      await call('post', `/${lead.id}/follow-ups`, people.ownerA, {
        type: 'SMS',
        dueAt: inDays(1),
        notes: 'Reminder text',
      }),
      201,
    );
    expect(added.followUps).toHaveLength(3);
    expect(added.nextAction).toMatchObject({ type: 'SMS', notes: 'Reminder text' });

    // Edit it to later: the call is next again.
    const sms = added.followUps.find((f) => f.type === 'SMS');
    const moved = profile(
      await call('patch', `/${lead.id}/follow-ups/${sms?.id}`, people.ownerA, {
        dueAt: inDays(9),
      }),
    );
    expect(moved.nextAction).toMatchObject({ type: 'CALL' });

    // Complete the call with an outcome: done, logged, and the email is next.
    const call1 = moved.followUps.find((f) => f.type === 'CALL');
    const done = profile(
      await call('post', `/${lead.id}/follow-ups/${call1?.id}/complete`, people.ownerA, {
        outcome: 'Left a voicemail',
      }),
    );
    expect(done.followUps.find((f) => f.id === call1?.id)).toMatchObject({
      outcome: 'Left a voicemail',
    });
    expect(done.followUps.at(-1)?.id).toBe(call1?.id);
    expect(done.nextAction).toMatchObject({ type: 'EMAIL' });
    expect(done.recentActivity.some((a) => a.kind === 'FOLLOW_UP_COMPLETED')).toBe(true);
    // A finished step is neither edited nor removed.
    expectError(
      await call('patch', `/${lead.id}/follow-ups/${call1?.id}`, people.ownerA, { notes: 'x' }),
      409,
      'FOLLOW_UP_DONE',
    );
    expectError(
      await call('delete', `/${lead.id}/follow-ups/${call1?.id}`, people.ownerA),
      409,
      'FOLLOW_UP_DONE',
    );

    // Remove the email: the SMS is next.
    const email = done.followUps.find((f) => f.type === 'EMAIL');
    const removed = profile(
      await call('delete', `/${lead.id}/follow-ups/${email?.id}`, people.ownerA),
    );
    expect(removed.followUps.map((f) => f.type)).toEqual(['SMS', 'CALL']);
    expect(removed.nextAction).toMatchObject({ type: 'SMS' });
  });

  it('keeps Save Follow-Up and Mark Complete working on the next step', async () => {
    const lead = await newLead({ nextAction: { type: 'CALL', dueAt: inDays(3) } });
    expect(lead.followUps).toHaveLength(1);
    const saved = profile(
      await call('put', `/${lead.id}/follow-up`, people.ownerA, {
        type: 'APPOINTMENT',
        dueAt: inDays(4),
      }),
    );
    expect(saved.followUps).toHaveLength(1);
    expect(saved.nextAction).toMatchObject({ type: 'APPOINTMENT' });
    const completed = profile(
      await call('post', `/${lead.id}/follow-up/complete`, people.ownerA, {
        outcome: 'Booked',
        next: { type: 'EMAIL', dueAt: inDays(6) },
      }),
    );
    expect(completed.followUps.map((f) => [f.type, !!f.doneAt])).toEqual([
      ['EMAIL', false],
      ['APPOINTMENT', true],
    ]);
    expect(completed.nextAction).toMatchObject({ type: 'EMAIL' });
  });

  it('shows a next action set before steps existed, and adopts it on the next change', async () => {
    const lead = await newLead();
    await runInScope(
      createPrismaClient(testDatabaseUrls('test_api').owner),
      { kind: 'business', businessId: ids.firmA },
      (tx) =>
        tx.lead.update({
          where: { id: lead.id },
          data: {
            nextActionType: 'CALL',
            nextActionAt: new Date(inDays(2)),
            nextActionNote: 'Old',
          },
        }),
    );
    const seen = profile(await call('get', `/${lead.id}/profile`, people.ownerA));
    expect(seen.followUps).toEqual([
      expect.objectContaining({ type: 'CALL', notes: 'Old', doneAt: null }),
    ]);
    const added = profile(
      await call('post', `/${lead.id}/follow-ups`, people.ownerA, {
        type: 'EMAIL',
        dueAt: inDays(5),
      }),
      201,
    );
    expect(added.followUps.map((f) => f.type)).toEqual(['CALL', 'EMAIL']);
    expect(added.nextAction).toMatchObject({ type: 'CALL', notes: 'Old' });
  });

  it('refuses steps on a closed lead, and firm B reaches none of firm A’s', async () => {
    const lead = await newLead();
    expectError(
      await call('post', '', people.ownerA, {
        firstName: 'Closed',
        lastName: `Lead${run}`,
        email: `closed-${run}@example.test`,
        source: 'REFERRAL',
        serviceIds: [ids.tax],
        stage: 'LOST',
        followUps: [{ type: 'CALL', dueAt: inDays(1) }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(
        'post',
        `/${lead.id}/follow-ups`,
        people.ownerB,
        { type: 'CALL', dueAt: inDays(1) },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
  });
});
