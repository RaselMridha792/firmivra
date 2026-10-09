// End-to-end: R11 step 5, portal intake forms, and the firm's review, Needs Correction and unlock
// (contract in packages/types/src/intake/intakes.ts). The client (from the session) starts an
// intake for an ACTIVE engagement and autosaves it step by step; SSNs are sealed at rest and come
// back as last 4. A submitted version is locked; Owner and Admin start the next version.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { IntakeChoiceList, IntakeList, IntakeView } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r11i-${key}-${run}@r11.test` });
const people = {
  owner: person('owner'),
  staff: person('staff'),
  one: person('one'),
  two: person('two'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r11i-a-${run}`,
  slugB: `r11i-b-${run}`,
  clientOne: '',
  clientTwo: '',
  tax: '',
  other: '',
  pending: '',
  twoTax: '',
  intake: '',
  sent: '',
};

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

async function portal(
  method: 'get' | 'post' | 'put',
  path: string,
  who: { email: string },
  body?: object,
  slug = ids.slugA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${slug}/me/intakes${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

async function firm(
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const view = (res: Response) => IntakeView.parse(ok(res).body);

async function inFirm<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn);
  } finally {
    await owner.$disconnect();
  }
}

/** What a submit does to the database (submit itself waits on R14's signing service). */
const markSubmitted = (intakeId: string) =>
  inFirm(async (tx) => {
    const draft = await tx.intakeSubmission.findFirstOrThrow({
      where: { intakeId },
      orderBy: { version: 'desc' },
    });
    await tx.intakeSubmission.update({
      where: { id: draft.id },
      data: { submittedAt: new Date(), signerName: 'One Sample', signedAt: new Date() },
    });
    await tx.intake.update({
      where: { id: intakeId },
      data: { status: 'SUBMITTED', correctionNote: null },
    });
  });

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = ['one', 'two', 'clientB'].includes(key) ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: ids.slugB, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.owner.id, 'OWNER'],
      [people.staff.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.clientOne = (
      await tx.client.create({
        data: { ...A, displayName: 'One', assignedUserId: people.staff.id },
      })
    ).id;
    ids.clientTwo = (await tx.client.create({ data: { ...A, displayName: 'Two' } })).id;
    for (const [p, clientId] of [
      [people.one, ids.clientOne],
      [people.two, ids.clientTwo],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          ...A,
          userId: p.id,
          clientId,
          email: p.email,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      });
    }
    const tax = await tx.service.create({ data: { ...A, kind: 'ANNUAL_TAX', name: `Tax ${run}` } });
    const other = await tx.service.create({ data: { ...A, kind: 'OTHER', name: `Other ${run}` } });
    const engagement = (clientId: string, serviceId: string, title: string, status = 'ACTIVE') =>
      tx.engagement
        .create({
          data: { ...A, clientId, serviceId, title, taxYear: 2025, status: status as 'ACTIVE' },
        })
        .then((e) => e.id);
    ids.tax = await engagement(ids.clientOne, tax.id, '2025 return');
    ids.other = await engagement(ids.clientOne, other.id, 'Other work');
    ids.pending = await engagement(ids.clientOne, tax.id, 'Not yet', 'PENDING');
    ids.twoTax = await engagement(ids.clientTwo, tax.id, 'Two return');
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const client = await tx.client.create({ data: { ...B, displayName: 'B client' } });
    await tx.clientAccount.create({
      data: {
        ...B,
        userId: people.clientB.id,
        clientId: client.id,
        email: people.clientB.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
      },
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('portal: start and autosave', () => {
  it("lists the client's ACTIVE engagements that have a form", async () => {
    const choices = IntakeChoiceList.parse(ok(await portal('get', '/choices', people.one)).body);
    expect(choices.items.map((c) => c.engagement.id)).toEqual([ids.tax]);
    expect(choices.items[0]!.intake).toBeNull();
  });

  it('starts once per engagement, on the published built-in form', async () => {
    const started = view(await portal('post', '', people.one, { engagementId: ids.tax }));
    expect(started).toMatchObject({
      status: 'IN_PROGRESS',
      version: 1,
      formVersion: 1,
      locked: false,
      savedSteps: [],
      engagement: { id: ids.tax, taxYear: 2025 },
    });
    expect(started.definition.key).toBe('ANNUAL_TAX');
    ids.intake = started.id;
    const again = view(await portal('post', '', people.one, { engagementId: ids.tax }));
    expect(again.id).toBe(ids.intake);
    expect(codeOf(await portal('post', '', people.one, { engagementId: ids.other }))).toBe(
      'NO_INTAKE_FORM',
    );
    expect(codeOf(await portal('post', '', people.one, { engagementId: ids.pending }))).toBe(
      'ENGAGEMENT_NOT_ACTIVE',
    );
    expect((await portal('post', '', people.one, { engagementId: ids.twoTax })).status).toBe(404);
  });

  it('saves a step, seals the SSN at rest and returns its last 4 only', async () => {
    const saved = view(
      await portal('put', `/${ids.intake}/steps/personal`, people.one, {
        answers: { firstName: 'One', lastName: 'Sample', ssn: '123-45-6789' },
      }),
    );
    expect(saved.answers).toMatchObject({ firstName: 'One', ssn: { last4: '6789' } });
    expect(saved.savedSteps).toEqual(['personal']);
    const stored = await inFirm((tx) =>
      tx.intakeSubmission.findFirstOrThrow({ where: { intakeId: ids.intake } }),
    );
    expect(JSON.stringify(stored.answers)).not.toContain('123-45-6789');
    expect(JSON.stringify(stored.answers)).not.toContain('123456789');

    // An unchanged number comes back as its last 4 and keeps the stored one.
    const kept = view(
      await portal('put', `/${ids.intake}/steps/personal`, people.one, {
        answers: { firstName: 'Uno', lastName: 'Sample', ssn: { last4: '6789' } },
      }),
    );
    expect(kept.answers).toMatchObject({ firstName: 'Uno', ssn: { last4: '6789' } });
    const wrong = await portal('put', `/${ids.intake}/steps/personal`, people.one, {
      answers: { ssn: { last4: '0000' } },
    });
    expect(codeOf(wrong)).toBe('VALIDATION_FAILED');
    const unknown = await portal('put', `/${ids.intake}/steps/personal`, people.one, {
      answers: { notAField: 'x' },
    });
    expect(codeOf(unknown)).toBe('VALIDATION_FAILED');
    expect(
      codeOf(await portal('put', `/${ids.intake}/steps/nope`, people.one, { answers: {} })),
    ).toBe('VALIDATION_FAILED');
  });

  it("another client, and the same person at another firm, can't reach it", async () => {
    expect((await portal('get', `/${ids.intake}`, people.two)).status).toBe(404);
    const save = await portal('put', `/${ids.intake}/steps/personal`, people.two, {
      answers: { firstName: 'X' },
    });
    expect(save.status).toBe(404);
    const b = await portal('get', `/${ids.intake}`, people.clientB, undefined, ids.slugB);
    expect(b.status).toBe(404);
    const list = IntakeList.parse(ok(await portal('get', '', people.two)).body);
    expect(list.items).toEqual([]);
  });
});

describe('firm: send, review, correct and unlock', () => {
  it("lists a client's intakes for the members who reach the client", async () => {
    const owner = IntakeList.parse(
      ok(await firm('get', `/clients/${ids.clientOne}/intakes`, people.owner)).body,
    );
    expect(owner.items.map((i) => i.id)).toEqual([ids.intake]);
    ok(await firm('get', `/clients/${ids.clientOne}/intakes`, people.staff));
    expect((await firm('get', `/clients/${ids.clientTwo}/intakes`, people.staff)).status).toBe(404);
    const b = await firm('get', `/intakes/${ids.intake}`, people.ownerB, undefined, ids.firmB);
    expect(b.status).toBe(404);
    const detail = view(await firm('get', `/intakes/${ids.intake}`, people.staff));
    expect(detail.answers['ssn']).toEqual({ last4: '6789' });
  });

  it('sends an intake once per open engagement', async () => {
    const sent = IntakeView.parse(
      ok(
        await firm('post', `/engagements/${ids.twoTax}/intakes`, people.owner, {
          dueOn: '2026-12-01',
        }),
        201,
      ).body,
    );
    expect(sent).toMatchObject({ status: 'SENT', dueOn: '2026-12-01', version: 1 });
    ids.sent = sent.id;
    expect(codeOf(await firm('post', `/engagements/${ids.twoTax}/intakes`, people.owner, {}))).toBe(
      'INTAKE_OPEN',
    );
    expect(
      (await firm('post', `/engagements/${ids.twoTax}/intakes`, people.staff, {})).status,
    ).toBe(404);
    // The client's first save moves it from SENT to IN_PROGRESS.
    const saved = view(
      await portal('put', `/${ids.sent}/steps/personal`, people.two, {
        answers: { firstName: 'Two' },
      }),
    );
    expect(saved.status).toBe('IN_PROGRESS');
  });

  it('a submitted version is locked; Owner and Admin ask for corrections as a new version', async () => {
    expect(
      codeOf(
        await firm('post', `/intakes/${ids.intake}/request-correction`, people.owner, {
          note: 'x',
        }),
      ),
    ).toBe('INVALID_STATUS');
    await markSubmitted(ids.intake);
    const locked = await portal('put', `/${ids.intake}/steps/personal`, people.one, {
      answers: { firstName: 'Late' },
    });
    expect(codeOf(locked)).toBe('INTAKE_LOCKED');
    const asStaff = await firm('post', `/intakes/${ids.intake}/request-correction`, people.staff, {
      note: 'Fix the address',
    });
    expect(asStaff.status).toBe(403);
    const corrected = view(
      await firm('post', `/intakes/${ids.intake}/request-correction`, people.owner, {
        note: 'Please fix the address.\nThanks',
      }),
    );
    expect(corrected).toMatchObject({
      status: 'NEEDS_CORRECTION',
      version: 2,
      locked: false,
      correctionNote: 'Please fix the address.\nThanks',
      answers: { firstName: 'Uno', ssn: { last4: '6789' } },
      savedSteps: ['personal'],
    });
    expect(corrected.submittedAt).not.toBeNull();
    const mine = view(
      await portal('put', `/${ids.intake}/steps/personal`, people.one, {
        answers: { firstName: 'Fixed', ssn: { last4: '6789' } },
      }),
    );
    expect(mine).toMatchObject({ status: 'NEEDS_CORRECTION', version: 2 });
    const audit = await inFirm((tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: ids.intake } }),
    );
    expect(audit.map((a) => a.action)).toContain('intake.correction_requested');
    expect(JSON.stringify(audit)).not.toContain('fix the address');
  });

  it('reviews, completes, and unlocks a completed intake as the next version', async () => {
    await markSubmitted(ids.intake);
    expect(view(await firm('post', `/intakes/${ids.intake}/review`, people.staff, {})).status).toBe(
      'UNDER_REVIEW',
    );
    expect(codeOf(await firm('post', `/intakes/${ids.intake}/review`, people.staff, {}))).toBe(
      'INVALID_STATUS',
    );
    expect(
      view(await firm('post', `/intakes/${ids.intake}/complete`, people.staff, {})).status,
    ).toBe('COMPLETED');
    expect((await firm('post', `/intakes/${ids.intake}/unlock`, people.staff, {})).status).toBe(
      403,
    );
    const unlocked = view(await firm('post', `/intakes/${ids.intake}/unlock`, people.owner, {}));
    expect(unlocked).toMatchObject({
      status: 'IN_PROGRESS',
      version: 3,
      correctionNote: null,
      locked: false,
    });
  });
});
