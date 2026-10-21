// End-to-end: R55, the Intake Forms workspace (contract in packages/types/src/intake/workspace.ts):
// the forms sent (summary, tabs, filters), the form library (list, summary, detail) and the firm's
// settings. Staff reach only their own clients' forms; firm B sees none of firm A's.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AssignedFormPage,
  IntakeDashboardSummary,
  IntakeFormDetail,
  IntakeFormLibrarySummary,
  IntakeFormList,
  IntakeSettings,
  IntakeSettingsChangeList,
  INTAKE_FORMS,
  INTAKE_MAX_FILE_SIZE_MB,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55i-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  otherStaffA: person('other-staff-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.63.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
    [method](`/api/v1/business${path}`)
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
const { ownerA, adminA, staffA, otherStaffA, ownerB } = people;
const ids = {} as Record<string, string>;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55i ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55i-${key}-${run}`;
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
    ['a', adminA.id, 'ADMIN'],
    ['a', staffA.id, 'STAFF'],
    ['a', otherStaffA.id, 'STAFF'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Individual Tax ${run}`, status: 'ACTIVE' },
      select: { id: true },
    });
    ids.service = service.id;
    const def = INTAKE_FORMS.ANNUAL_TAX;
    if (!def) throw new Error('the built-in annual tax form is missing');
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: service.id,
        version: 1,
        title: 'Annual Tax Intake',
        definition: def as object,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        createdByUserId: ownerA.id,
      },
      select: { id: true, templateId: true },
    });
    ids.form = form.id;
    ids.template = form.templateId as string;
    const client = async (key: string, name: string, assigned?: string) => {
      const c = await tx.client.create({
        data: {
          businessId,
          displayName: name,
          email: `${key}-${run}@client.test`,
          assignedUserId: assigned,
        },
        select: { id: true },
      });
      const e = await tx.engagement.create({
        data: { businessId, clientId: c.id, serviceId: service.id, title: `${name} tax` },
        select: { id: true },
      });
      return { client: c.id, engagement: e.id };
    };
    const mine = await client('mine', 'Mina Mine (fake)', staffA.id);
    const theirs = await client('theirs', 'Theo Theirs (fake)', otherStaffA.id);
    const loose = await client('loose', 'Lou Loose (fake)');
    const intake = async (key: string, over: object) =>
      (ids[key] = (
        await tx.intake.create({
          data: { businessId, formId: form.id, ...over },
          select: { id: true },
        })
      ).id);
    const sent = new Date(Date.now() - 3 * 86_400_000);
    await intake('sent', { engagementId: mine.engagement, status: 'SENT', sentAt: sent });
    await intake('progress', {
      engagementId: theirs.engagement,
      status: 'IN_PROGRESS',
      sentAt: sent,
      assignedUserId: otherStaffA.id,
    });
    await intake('submitted', {
      engagementId: loose.engagement,
      status: 'SUBMITTED',
      sentAt: sent,
    });
    await intake('completed', { engagementId: mine.engagement, status: 'COMPLETED', sentAt: sent });
    await intake('expired', { engagementId: theirs.engagement, status: 'EXPIRED', sentAt: sent });
    await intake('draft', { engagementId: loose.engagement, status: 'DRAFT' });
    await intake('archived', { engagementId: loose.engagement, status: 'ARCHIVED', sentAt: sent });
    const lead = await tx.lead.create({
      data: {
        businessId,
        serviceId: service.id,
        firstName: 'Lee',
        lastName: 'Lead (fake)',
        email: `lead-${run}@lead.test`,
        assignedUserId: staffA.id,
      },
      select: { id: true },
    });
    await intake('leadForm', { leadId: lead.id, status: 'SENT', sentAt: sent });
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

describe('the forms sent', () => {
  it('counts them for the cards, without drafts and archived ones', async () => {
    const s = IntakeDashboardSummary.parse(ok(await call('get', '/intakes/summary', ownerA)));
    expect(s.total.value).toBe(6);
    expect(s.byStatus).toEqual({
      notStarted: 2,
      inProgress: 1,
      submitted: 1,
      completed: 1,
      expired: 1,
    });
    expect(s.sent.value).toBe(2);
    expect(s.completed.value).toBe(1);
    // Everything was sent before this month began or in it: the previous figure is never above it.
    expect(s.total.previous).toBeLessThanOrEqual(s.total.value);
  });

  it('lists with tabs, search, filters and pages', async () => {
    const list = async (q: string, who: Who = ownerA) =>
      AssignedFormPage.parse(ok(await call('get', `/intakes?${q}`, who)));
    const all = await list('pageSize=100');
    expect(all.total).toBe(6);
    expect(all.items.map((i) => i.id)).not.toContain(ids.draft);
    expect(all.items.map((i) => i.id)).not.toContain(ids.archived);
    const row = all.items.find((i) => i.id === ids.sent)!;
    expect(row).toMatchObject({
      status: 'SENT',
      recipient: { kind: 'CLIENT', name: 'Mina Mine (fake)' },
      form: { id: ids.template, name: 'Annual Tax Intake' },
      service: { name: `Individual Tax ${run}` },
    });
    expect(row.sentAt).toBeTruthy();
    expect(all.items.find((i) => i.id === ids.leadForm)?.recipient).toMatchObject({
      kind: 'LEAD',
      name: 'Lee Lead (fake)',
    });
    expect((await list('tab=sent')).items.map((i) => i.id).sort()).toEqual(
      [ids.sent, ids.leadForm].sort(),
    );
    expect((await list('tab=in_progress')).items.map((i) => i.id)).toEqual([ids.progress]);
    expect((await list('tab=submitted')).items.map((i) => i.id)).toEqual([ids.submitted]);
    expect((await list('tab=completed')).items.map((i) => i.id)).toEqual([ids.completed]);
    expect((await list('tab=expired')).items.map((i) => i.id)).toEqual([ids.expired]);
    expect((await list('search=Theo')).total).toBe(2);
    expect((await list('search=Lead')).items.map((i) => i.id)).toEqual([ids.leadForm]);
    expect((await list(`assignedUserId=${otherStaffA.id}`)).items.map((i) => i.id)).toEqual([
      ids.progress,
    ]);
    expect((await list(`formId=${ids.template}`)).total).toBe(6);
    expect((await list(`formId=${randomUUID()}`)).total).toBe(0);
    expect((await list(`serviceId=${ids.service}`)).total).toBe(6);
    expect((await list('pageSize=2&page=2')).items).toHaveLength(2);
    expect((await call('get', '/intakes?tab=nope', ownerA)).status).toBe(400);
  });

  it('shows Staff only the forms of their clients and leads, or assigned to them', async () => {
    const mine = AssignedFormPage.parse(ok(await call('get', '/intakes?pageSize=100', staffA)));
    expect(mine.items.map((i) => i.id).sort()).toEqual(
      [ids.sent, ids.completed, ids.leadForm].sort(),
    );
    const theirs = AssignedFormPage.parse(
      ok(await call('get', '/intakes?pageSize=100', otherStaffA)),
    );
    expect(theirs.items.map((i) => i.id).sort()).toEqual([ids.progress, ids.expired].sort());
    expect(
      IntakeDashboardSummary.parse(ok(await call('get', '/intakes/summary', staffA))).total.value,
    ).toBe(3);
  });
});

describe('the form library', () => {
  it('lists the forms with their usage, and filters', async () => {
    const list = IntakeFormList.parse(ok(await call('get', '/intake-forms', ownerA)));
    const form = list.items.find((f) => f.id === ids.template)!;
    expect(form).toMatchObject({
      name: 'Annual Tax Intake',
      category: 'PERSONAL_TAX',
      status: 'PUBLISHED',
      usageCount: 7,
      custom: true,
    });
    expect(form.questionCount).toBeGreaterThan(5);
    expect(form.lastUsedAt).toBeTruthy();
    expect(form.owner?.userId).toBe(ownerA.id);
    const some = async (q: string) =>
      IntakeFormList.parse(ok(await call('get', `/intake-forms?${q}`, ownerA))).items.map(
        (i) => i.id,
      );
    expect(await some('category=PERSONAL_TAX')).toContain(ids.template);
    expect(await some('category=PAYROLL')).not.toContain(ids.template);
    expect(await some(`search=${encodeURIComponent('annual tax')}`)).toContain(ids.template);
    expect(await some('status=DRAFT')).not.toContain(ids.template);
    expect(await some('sort=used')).toContain(ids.template);
    expect((await call('get', '/intake-forms?sort=nope', ownerA)).status).toBe(400);
  });

  it('summarizes the library and shows a form as sections and questions', async () => {
    const s = IntakeFormLibrarySummary.parse(
      ok(await call('get', '/intake-forms/summary', ownerA)),
    );
    expect(s.total).toBeGreaterThanOrEqual(1);
    expect(s.custom).toBeGreaterThanOrEqual(1);
    expect(s.byCategory.find((c) => c.category === 'PERSONAL_TAX')?.count).toBeGreaterThanOrEqual(
      1,
    );
    const d = IntakeFormDetail.parse(
      ok(await call('get', `/intake-forms/${ids.template}`, adminA)),
    );
    expect(d).toMatchObject({ id: ids.template, version: 1, status: 'PUBLISHED' });
    expect(d.sections.length).toBeGreaterThan(0);
    expect(d.sections[0]?.questions.length).toBeGreaterThan(0);
    expect(d.settings).toMatchObject({ requireSignature: true, showProgressBar: true });
    expect(d.publishedAt).toBeTruthy();
  });
});

describe('the settings', () => {
  it('creates the defaults on first read, saves with a version, and refuses a stale save', async () => {
    const first = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
    expect(first.general).toMatchObject({ defaultExpirationDays: 14, allowSaveAndResume: true });
    expect(first.security).toMatchObject({ encryptedUploads: true, maxFileSizeMb: 10 });
    expect(first.security.acceptedFileTypes.sort()).toEqual(['JPG', 'PDF', 'PNG']);
    const saved = IntakeSettings.parse(
      ok(
        await call('put', '/intake-settings', ownerA, {
          version: first.version,
          general: { defaultExpirationDays: 30, defaultOwnerUserId: adminA.id },
          notifications: { firstReminderAfterDays: 2, finalReminderAfterDays: 5 },
          security: { acceptedFileTypes: ['PDF', 'DOCX'], maxFileSizeMb: 8 },
          clientExperience: { thankYouMessage: 'Thanks!' },
        }),
      ),
    );
    expect(saved.general.defaultExpirationDays).toBe(30);
    expect(saved.general.defaultOwner?.userId).toBe(adminA.id);
    expect(saved.notifications).toMatchObject({
      firstReminderAfterDays: 2,
      finalReminderAfterDays: 5,
    });
    expect(saved.security.acceptedFileTypes.sort()).toEqual(['DOCX', 'PDF']);
    expect(saved.clientExperience.thankYouMessage).toBe('Thanks!');
    expectError(
      await call('put', '/intake-settings', ownerA, {
        version: first.version,
        general: { requireSignature: false },
      }),
      409,
      'SAVE_CONFLICT',
    );
    const next = (over: object) =>
      call('put', '/intake-settings', ownerA, { version: saved.version, ...over });
    expect((await next({ security: { acceptedFileTypes: ['HEIC'] } })).status).toBe(400);
    // At most the documents' 100 MB.
    expect(INTAKE_MAX_FILE_SIZE_MB).toBe(100);
    const tooBig = { security: { maxFileSizeMb: INTAKE_MAX_FILE_SIZE_MB + 1 } };
    expect((await next(tooBig)).status).toBe(400);
    expect((await next({ clientExperience: { redirectAfterCompletion: true } })).status).toBe(400);
    expect(
      (await next({ notifications: { firstReminderAfterDays: 9, finalReminderAfterDays: 4 } }))
        .status,
    ).toBe(400);
    expect((await next({ general: { defaultOwnerUserId: randomUUID() } })).status).toBe(400);
    expect((await next({})).status).toBe(200);
  });

  it('lists the recent changes without their values, and resets to the defaults', async () => {
    const changes = IntakeSettingsChangeList.parse(
      ok(await call('get', '/intake-settings/changes', adminA)),
    );
    expect(changes.items[0]?.label).toMatch(/^Changed /);
    expect(changes.items[0]?.by).toBe('Fake R55i ownerA');
    expect(JSON.stringify(changes)).not.toContain('Thanks');
    expect((await call('post', '/intake-settings/reset', ownerA, {})).status).toBe(400);
    const back = IntakeSettings.parse(
      ok(await call('post', '/intake-settings/reset', ownerA, { confirm: true })),
    );
    expect(back.general.defaultExpirationDays).toBe(14);
    expect(back.clientExperience.thankYouMessage).toBeNull();
    expect(
      IntakeSettingsChangeList.parse(ok(await call('get', '/intake-settings/changes', ownerA)))
        .items[0]?.label,
    ).toBe('Settings reset to the defaults');
  });

  it('is changed by Owner and Admin only, and a test reminder is not available yet', async () => {
    const s = IntakeSettings.parse(ok(await call('get', '/intake-settings', staffA)));
    expectError(
      await call('put', '/intake-settings', staffA, {
        version: s.version,
        general: { requireSignature: false },
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/intake-settings/reset', staffA, { confirm: true }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/intake-settings/test-reminder', adminA, {}),
      503,
      'TEST_REMINDER_UNAVAILABLE',
    );
    expectError(await call('post', '/intake-settings/test-reminder', staffA, {}), 403, 'FORBIDDEN');
  });
});

describe('another firm', () => {
  it('sees none of it', async () => {
    expect(
      AssignedFormPage.parse(ok(await call('get', '/intakes', ownerB, undefined, 'b'))).total,
    ).toBe(0);
    expect(
      IntakeDashboardSummary.parse(
        ok(await call('get', '/intakes/summary', ownerB, undefined, 'b')),
      ).total.value,
    ).toBe(0);
    expectError(
      await call('get', `/intake-forms/${ids.template}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expect(
      IntakeFormList.parse(
        ok(await call('get', '/intake-forms', ownerB, undefined, 'b')),
      ).items.map((f) => f.id),
    ).not.toContain(ids.template);
    const own = IntakeSettings.parse(
      ok(await call('get', '/intake-settings', ownerB, undefined, 'b')),
    );
    expect(own.general.defaultOwner).toBeNull();
    expectError(await call('get', '/intakes', undefined), 401, 'UNAUTHENTICATED');
    expectError(await call('get', `/intake-forms/${randomUUID()}`, ownerA), 404, 'NOT_FOUND');
  });
});
