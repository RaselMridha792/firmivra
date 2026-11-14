// End-to-end: R55, Leads Review Two (Octavia, Nov 8) R2 19, reusable follow-up sequences. Owner
// and Admin keep templates (unique live names; archived, never deleted); anyone who reaches a lead
// applies one with the steps previewed and edited first; they become the lead's follow-up steps
// with their owner and REMINDER or OUTREACH (nothing is sent); one open run per template; a stop,
// Not Qualified or Lost ends the run and keeps the steps. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { LeadProfile, LeadSequenceTemplate, previewSequence } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55sq-${key}-${run}@r55.test` });
const people = { ownerA: person('owner-a'), staffA: person('staff-a'), ownerB: person('owner-b') };
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
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
let n = 0;
async function newLead(extra: object = {}) {
  n += 1;
  return LeadProfile.parse(
    ok(
      await call('post', '/leads', people.ownerA, {
        firstName: 'Sam',
        lastName: `Seq${n}x${run}`,
        email: `sam-${n}-${run}@example.test`,
        source: 'REFERRAL',
        serviceIds: [ids.tax],
        assignedUserId: people.staffA.id,
        ...extra,
      }),
      201,
    ),
  );
}
const template = (name: string) => ({
  name,
  description: 'Synthetic sequence',
  steps: [
    { offsetDays: 0, atTime: '10:00', actionType: 'CALL', mode: 'REMINDER', owner: 'LEAD_OWNER' },
    {
      offsetDays: 2,
      actionType: 'EMAIL',
      mode: 'OUTREACH',
      owner: 'APPLIER',
      note: 'Welcome email',
    },
  ],
});

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    ids.firmA = (
      await tx.business.create({ data: { slug: `r55sq-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r55sq-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    for (const [p, role] of [
      [people.ownerA, 'OWNER'],
      [people.staffA, 'STAFF'],
    ] as const) {
      await tx.membership.create({
        data: { businessId: ids.firmA, userId: p.id, role, status: 'ACTIVE' },
      });
    }
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

describe('Leads R2 19: follow-up sequences', () => {
  let welcome: LeadSequenceTemplate;

  it('Owner keeps templates: a live name once, steps replaced on edit, archived not deleted; Staff read only', async () => {
    welcome = LeadSequenceTemplate.parse(
      ok(await call('post', '/lead-sequences', people.ownerA, template(`Welcome ${run}`)), 201),
    );
    expect(welcome.steps.map((s) => [s.offsetDays, s.atTime, s.mode])).toEqual([
      [0, '10:00', 'REMINDER'],
      [2, null, 'OUTREACH'],
    ]);
    expectError(
      await call(
        'post',
        '/lead-sequences',
        people.ownerA,
        template(`welcome ${run}`.toUpperCase()),
      ),
      409,
      'NAME_TAKEN',
    );
    expectError(
      await call('post', '/lead-sequences', people.staffA, template(`Staff ${run}`)),
      403,
      'FORBIDDEN',
    );
    const list = ok(await call('get', '/lead-sequences', people.staffA)) as {
      items: { id: string }[];
    };
    expect(list.items.map((t) => t.id)).toContain(welcome.id);
    const old = LeadSequenceTemplate.parse(
      ok(await call('post', '/lead-sequences', people.ownerA, template(`Old ${run}`)), 201),
    );
    const edited = LeadSequenceTemplate.parse(
      ok(
        await call('put', `/lead-sequences/${old.id}`, people.ownerA, {
          ...template(`Old ${run}`),
          steps: [template('x').steps[0]],
        }),
      ),
    );
    expect(edited.steps).toHaveLength(1);
    ok(await call('post', `/lead-sequences/${old.id}/archive`, people.ownerA));
    const after = ok(await call('get', '/lead-sequences', people.ownerA)) as {
      items: { id: string }[];
    };
    expect(after.items.map((t) => t.id)).not.toContain(old.id);
    // Firm B sees none of them.
    const b = ok(await call('get', '/lead-sequences', people.ownerB, undefined, ids.firmB)) as {
      items: unknown[];
    };
    expect(b.items).toEqual([]);
  });

  it('applies a sequence with the edited steps, once; stopping keeps the steps', async () => {
    const lead = await newLead();
    const steps = previewSequence(welcome, {
      startOn: '2030-04-01',
      leadOwnerId: people.staffA.id,
      applierId: people.ownerA.id,
    });
    steps[1]!.note = 'Edited before applying';
    const applied = LeadProfile.parse(
      ok(
        await call('post', `/leads/${lead.id}/sequences`, people.staffA, {
          templateId: welcome.id,
          steps,
        }),
      ),
    );
    const fromRun = applied.followUps.filter((f) => f.sequence === welcome.name);
    expect(fromRun.map((f) => [f.type, f.mode, f.assignedTo?.userId, f.notes])).toEqual([
      ['CALL', 'REMINDER', people.staffA.id, null],
      ['EMAIL', 'OUTREACH', people.ownerA.id, 'Edited before applying'],
    ]);
    expect(applied.nextAction?.type).toBe('CALL');
    expect(applied.sequences?.[0]).toMatchObject({ templateId: welcome.id, stoppedAt: null });
    expectError(
      await call('post', `/leads/${lead.id}/sequences`, people.ownerA, {
        templateId: welcome.id,
        steps,
      }),
      409,
      'SEQUENCE_ALREADY_APPLIED',
    );
    expectError(
      await call(
        'post',
        `/leads/${lead.id}/sequences`,
        people.ownerB,
        { templateId: welcome.id, steps },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    const runId = applied.sequences![0]!.id;
    const stopped = LeadProfile.parse(
      ok(await call('post', `/leads/${lead.id}/sequences/${runId}/stop`, people.ownerA)),
    );
    expect(stopped.sequences?.[0]).toMatchObject({ stopReason: 'Stopped' });
    expect(stopped.followUps.filter((f) => f.sequence === welcome.name)).toHaveLength(2);
    // Stopped, it can run again.
    ok(
      await call('post', `/leads/${lead.id}/sequences`, people.ownerA, {
        templateId: welcome.id,
        steps,
      }),
    );
  });

  it('Not Qualified stops the running sequences and keeps their steps', async () => {
    const lead = await newLead();
    const steps = previewSequence(welcome, {
      startOn: '2030-05-01',
      leadOwnerId: people.staffA.id,
      applierId: people.ownerA.id,
    });
    ok(
      await call('post', `/leads/${lead.id}/sequences`, people.ownerA, {
        templateId: welcome.id,
        steps,
      }),
    );
    const declined = LeadProfile.parse(
      ok(await call('patch', `/leads/${lead.id}`, people.ownerA, { stage: 'DECLINED' })),
    );
    expect(declined.sequences?.[0]).toMatchObject({ stopReason: 'Not Qualified' });
    expect(declined.followUps.filter((f) => f.sequence === welcome.name)).toHaveLength(2);
    expectError(
      await call('post', `/leads/${lead.id}/sequences`, people.ownerA, {
        templateId: welcome.id,
        steps,
      }),
      409,
      'LEAD_CLOSED',
    );
  });
});
