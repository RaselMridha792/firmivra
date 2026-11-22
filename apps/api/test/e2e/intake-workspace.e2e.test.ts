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
  beginOnlinePageUrl,
  effectiveRetentionYears,
  IntakeDashboardSummary,
  IntakeFormDetail,
  IntakeFormLibrarySummary,
  IntakeFormList,
  IntakeSettings,
  IntakeSettingsChangeList,
  INTAKE_FORMS,
  INTAKE_MAX_FILE_SIZE_MB,
  publicButtonCode,
  publicIntakeEmbedCode,
  publicPortalEntryUrl,
  PublicLink,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { RetentionGuard, type RetentionRef } from '../../src/retention/retention-guard.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NotifyDeliveryError } from '../../src/notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55i-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  /** An admin whose email the stand-in sender refuses ("-refuse-" in the address). */
  refusedAdminA: person('admin-refuse'),
  staffA: person('staff-a'),
  otherStaffA: person('other-staff-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
/** The portal site from config, as the public links use it. */
let portal = '';
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
const { ownerA, adminA, refusedAdminA, staffA, otherStaffA, ownerB } = people;
/** What the stand-in for NotifyService was asked to send. */
const outbox: NotifyMessage[] = [];
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
    ['a', refusedAdminA.id, 'ADMIN'],
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
    ids.theirsClient = theirs.client;
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
  portal = env.PORTAL_BASE_URL;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        if (message.to.includes('-refuse-')) {
          return Promise.reject(new NotifyDeliveryError(message.template, 'email', 'synthetic'));
        }
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
    // The dashboard's Intake stage (C5): everything not finished, neither completed nor expired.
    expect((await list('tab=open&pageSize=100')).items.map((i) => i.id).sort()).toEqual(
      [ids.sent, ids.leadForm, ids.progress, ids.submitted].sort(),
    );
    expect((await list('search=Theo')).total).toBe(2);
    // One client's forms (the Client Portal module's Intake Forms tab).
    expect((await list(`clientId=${ids.theirsClient}`)).total).toBe(2);
    expect((await list(`clientId=${randomUUID()}`)).total).toBe(0);
    expect((await list('search=Lead')).items.map((i) => i.id)).toEqual([ids.leadForm]);
    expect((await list(`assignedUserId=${otherStaffA.id}`)).items.map((i) => i.id)).toEqual([
      ids.progress,
    ]);
    expect((await list(`formId=${ids.template}`)).total).toBe(6);
    expect((await list(`formId=${randomUUID()}`)).total).toBe(0);
    expect((await list(`serviceId=${ids.service}`)).total).toBe(6);
    // Client Portal module items 1 and 7: archived forms are listed on their own tab, and the
    // form type and service filters apply there too.
    expect((await list('tab=archived')).items.map((i) => i.id)).toEqual([ids.archived]);
    expect((await list(`tab=archived&formId=${ids.template}&serviceId=${ids.service}`)).total).toBe(
      1,
    );
    expect((await list(`tab=archived&serviceId=${randomUUID()}`)).total).toBe(0);
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

  // Octavia's review of Oct 20 (I1): every service of the six kinds has its built-in form, the
  // numbers count the same rows as the list, and an archived form stays archived.
  it('gives each service of the six kinds its built-in form once, and keeps an archived one archived', async () => {
    const service = (kind: 'PAYROLL' | 'OTHER', name: string) =>
      inFirm('a', (tx) =>
        tx.service.create({
          data: { businessId: firms.a, kind, name: `${name} ${run}`, status: 'ACTIVE' },
          select: { id: true },
        }),
      );
    const payroll = await service('PAYROLL', 'Payroll');
    const notary = await service('OTHER', 'Notary');
    const builtIn = INTAKE_FORMS.PAYROLL;
    if (!builtIn) throw new Error('the built-in payroll form is missing');

    // Three readers at once fill it once.
    const lists = await Promise.all(
      [ownerA, adminA, staffA].map(async (who) =>
        IntakeFormList.parse(ok(await call('get', '/intake-forms', who))),
      ),
    );
    for (const list of lists) {
      const mine = list.items.filter((f) => f.service?.id === payroll.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        name: builtIn.title,
        category: 'PAYROLL',
        status: 'PUBLISHED',
        isTemplate: true,
        custom: false,
        usageCount: 0,
        owner: null,
      });
      expect(list.items.some((f) => f.service?.id === notary.id)).toBe(false);
    }
    const versions = () =>
      inFirm('a', (tx) =>
        tx.intakeForm.count({ where: { businessId: firms.a, serviceId: payroll.id } }),
      );
    expect(await versions()).toBe(1);

    // The numbers count the same rows as the list, templates or not.
    const list = IntakeFormList.parse(ok(await call('get', '/intake-forms', ownerA)));
    const sum = IntakeFormLibrarySummary.parse(
      ok(await call('get', '/intake-forms/summary', ownerA)),
    );
    expect(sum.total).toBe(list.items.length);
    expect(sum.byCategory.reduce((n, c) => n + c.count, 0)).toBe(list.items.length);
    expect(sum.custom).toBe(list.items.filter((f) => f.custom).length);

    // Archived, it is not made again.
    const id = list.items.find((f) => f.service?.id === payroll.id)?.id;
    if (!id) throw new Error('the payroll form is missing');
    ok(await call('post', `/intake-forms/${id}/archive`, ownerA, {}));
    const after = IntakeFormList.parse(ok(await call('get', '/intake-forms', ownerA)));
    expect(after.items.some((f) => f.service?.id === payroll.id)).toBe(false);
    expect(await versions()).toBe(1);
  });

  it('keeps a duplicate in the library beside its service form', async () => {
    const copy = IntakeFormDetail.parse(
      ok(
        await call('post', `/intake-forms/${ids.template}/duplicate`, ownerA, {
          asTemplate: true,
        }),
        201,
      ),
    );
    expect(copy).toMatchObject({ status: 'DRAFT', isTemplate: false, category: 'PERSONAL_TAX' });
    const list = IntakeFormList.parse(ok(await call('get', '/intake-forms', ownerA)));
    expect(list.items.map((f) => f.id)).toEqual(expect.arrayContaining([ids.template, copy.id]));
    const sum = IntakeFormLibrarySummary.parse(
      ok(await call('get', '/intake-forms/summary', ownerA)),
    );
    expect(sum.total).toBe(list.items.length);
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
          notifications: { firstReminderAfterMinutes: 2880, finalReminderAfterMinutes: 7200 },
          security: { acceptedFileTypes: ['PDF', 'DOCX'], maxFileSizeMb: 5 },
          clientExperience: { thankYouMessage: 'Thanks!' },
        }),
      ),
    );
    expect(saved.general.defaultExpirationDays).toBe(30);
    expect(saved.general.defaultOwner?.userId).toBe(adminA.id);
    expect(saved.notifications).toMatchObject({
      firstReminderAfterMinutes: 2880,
      finalReminderAfterMinutes: 7200,
    });
    expect(saved.security.acceptedFileTypes.sort()).toEqual(['DOCX', 'PDF']);
    expect(saved.security.maxFileSizeMb).toBe(5);
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
    // 10c: a final reminder before the first is taken now (it counts back from the expiry); one
    // under 5 minutes is not.
    expect((await next({ notifications: { finalReminderAfterMinutes: 4 } })).status).toBe(400);
    expect((await next({ general: { defaultOwnerUserId: randomUUID() } })).status).toBe(400);
    expect((await next({})).status).toBe(200);
  });

  it('No reminders saves as off, and reads as none; the final reminder counts from the expiry (I8, I9, 10c)', async () => {
    const at = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
    const put = (version: string, notifications: object) =>
      call('put', '/intake-settings', ownerA, { version, notifications });
    const off = IntakeSettings.parse(
      ok(
        await put(at.version, { firstReminderAfterMinutes: null, finalReminderAfterMinutes: null }),
      ),
    );
    expect(off.notifications).toMatchObject({
      firstReminderAfterMinutes: null,
      finalReminderAfterMinutes: null,
    });
    const row = () =>
      inFirm('a', (tx) =>
        tx.intakeSettings.findUniqueOrThrow({
          where: { businessId: firms.a },
          select: {
            remindersEnabled: true,
            firstReminderMinutes: true,
            finalReminderMinutes: true,
            firstReminderDays: true,
            finalReminderDays: true,
          },
        }),
      );
    // Off for new sends; the times stay for when reminders are turned on again.
    expect(await row()).toEqual({
      remindersEnabled: false,
      firstReminderMinutes: 2880,
      finalReminderMinutes: 7200,
      firstReminderDays: 2,
      finalReminderDays: 5,
    });
    // Octavia's I8: minutes and hours too. The old day columns follow, rounded up to whole days,
    // the final still after the first (their own rules hold until a migration drops them).
    const on = IntakeSettings.parse(
      ok(await put(off.version, { firstReminderAfterMinutes: 30, finalReminderAfterMinutes: 120 })),
    );
    expect(on.notifications).toMatchObject({
      firstReminderAfterMinutes: 30,
      finalReminderAfterMinutes: 120,
    });
    expect(await row()).toEqual({
      remindersEnabled: true,
      firstReminderMinutes: 30,
      finalReminderMinutes: 120,
      firstReminderDays: 1,
      finalReminderDays: 2,
    });
    const longest = IntakeSettings.parse(
      ok(
        await put(on.version, {
          firstReminderAfterMinutes: 43200,
          finalReminderAfterMinutes: 86400,
        }),
      ),
    );
    expect(await row()).toMatchObject({ firstReminderDays: 30, finalReminderDays: 60 });
    const back = IntakeSettings.parse(
      ok(
        await put(longest.version, { firstReminderAfterMinutes: 5, finalReminderAfterMinutes: 10 }),
      ),
    );
    expect(back.notifications).toMatchObject({
      firstReminderAfterMinutes: 5,
      finalReminderAfterMinutes: 10,
    });
    // Review Two 10c: the final reminder counts back from the expiry, so 5 minutes is taken in both
    // lists, and a final reminder at or before the first's time is too.
    const fives = IntakeSettings.parse(
      ok(await put(back.version, { firstReminderAfterMinutes: 5, finalReminderAfterMinutes: 5 })),
    );
    expect(fives.notifications).toMatchObject({
      firstReminderAfterMinutes: 5,
      finalReminderAfterMinutes: 5,
    });
    const month = IntakeSettings.parse(
      ok(
        await put(fives.version, {
          firstReminderAfterMinutes: 43200,
          finalReminderAfterMinutes: 1440,
        }),
      ),
    );
    expect(month.notifications).toMatchObject({
      firstReminderAfterMinutes: 43200,
      finalReminderAfterMinutes: 1440,
    });
    // The old day columns keep their own rule (the final day after the first).
    expect(await row()).toMatchObject({ firstReminderDays: 30, finalReminderDays: 31 });
    // No final reminder while they are on, and times out of range, are refused at their fields.
    for (const [body, path] of [
      [{ finalReminderAfterMinutes: null }, 'notifications.finalReminderAfterMinutes'],
      [{ firstReminderAfterMinutes: 4 }, 'notifications.firstReminderAfterMinutes'],
      [{ finalReminderAfterMinutes: 86401 }, 'notifications.finalReminderAfterMinutes'],
      [{ expirationAlertMinutes: 29 }, 'notifications.expirationAlertMinutes'],
      [{ expirationAlertMinutes: 10081 }, 'notifications.expirationAlertMinutes'],
    ] as const) {
      const res = await put(month.version, body);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).toContain(path);
    }
    // Octavia's I9: 30 minutes and her hours (42, not 48), and No alert. The old hour column
    // follows, rounded up, and keeps its value under No alert.
    const alertRow = () =>
      inFirm('a', (tx) =>
        tx.intakeSettings.findUniqueOrThrow({
          where: { businessId: firms.a },
          select: { expiryAlertMinutes: true, expiryAlertHours: true },
        }),
      );
    for (const [minutes, hours] of [
      [30, 1],
      [2520, 42],
      [null, 42],
    ] as const) {
      const now = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
      expect(
        IntakeSettings.parse(ok(await put(now.version, { expirationAlertMinutes: minutes })))
          .notifications.expirationAlertMinutes,
      ).toBe(minutes);
      expect(await alertRow()).toEqual({ expiryAlertMinutes: minutes, expiryAlertHours: hours });
    }
  });

  it("starts the list with the firm's contact email; the firm may remove it (Rasel, Oct 25)", async () => {
    await inFirm('b', async (tx) => {
      await tx.intakeSettings.deleteMany({ where: { businessId: firms.b } });
      await tx.businessSettings.upsert({
        where: { businessId: firms.b },
        create: { businessId: firms.b, contactEmail: 'office@firmb.test' },
        update: { contactEmail: 'office@firmb.test' },
      });
    });
    const first = IntakeSettings.parse(
      ok(await call('get', '/intake-settings', ownerB, undefined, 'b')),
    );
    expect(first.notifications.additionalEmails).toEqual(['office@firmb.test']);
    const removed = IntakeSettings.parse(
      ok(
        await call(
          'put',
          '/intake-settings',
          ownerB,
          { version: first.version, notifications: { additionalEmails: [] } },
          'b',
        ),
      ),
    );
    expect(removed.notifications.additionalEmails).toEqual([]);
    // A later read keeps the firm's choice; Reset Defaults puts the contact email back.
    expect(
      IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerB, undefined, 'b')))
        .notifications.additionalEmails,
    ).toEqual([]);
    const reset = IntakeSettings.parse(
      ok(await call('post', '/intake-settings/reset', ownerB, { confirm: true }, 'b')),
    );
    expect(reset.notifications.additionalEmails).toEqual(['office@firmb.test']);
  });

  it('keeps the additional emails to notify: lower case, each once, at most 10 (I7)', async () => {
    const at = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
    expect(at.notifications.additionalEmails).toEqual([]);
    const put = (version: string, additionalEmails: string[]) =>
      call('put', '/intake-settings', ownerA, { version, notifications: { additionalEmails } });
    const saved = IntakeSettings.parse(
      ok(await put(at.version, [' Office@Example.test ', 'partner@example.test'])),
    );
    expect(saved.notifications.additionalEmails).toEqual([
      'office@example.test',
      'partner@example.test',
    ]);
    const many = Array.from({ length: 11 }, (_, i) => `person${i}@example.test`);
    for (const list of [['office@example.test', 'OFFICE@example.test'], many, ['not-an-email']]) {
      const res = await put(saved.version, list);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).toContain('notifications.additionalEmails');
    }
    const ten = IntakeSettings.parse(ok(await put(saved.version, many.slice(0, 10))));
    expect(ten.notifications.additionalEmails).toHaveLength(10);
    // The audit row names the section, never an address.
    const rows = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a, action: 'intake_settings.updated' },
        select: { metadata: true },
      }),
    );
    expect(JSON.stringify(rows)).not.toContain('@example.test');
  });

  it('saves a data retention period in years, and deletes nothing for it (I12)', async () => {
    const counts = () =>
      inFirm('a', async (tx) => ({
        intakes: await tx.intake.count({ where: { businessId: firms.a } }),
        submissions: await tx.intakeSubmission.count({ where: { businessId: firms.a } }),
        documents: await tx.document.count({ where: { businessId: firms.a } }),
      }));
    const before = await counts();
    const at = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
    expect(at.security.dataRetentionYears).toBeNull();
    const put = (version: string, dataRetentionYears: unknown) =>
      call('put', '/intake-settings', ownerA, { version, security: { dataRetentionYears } });
    const seven = IntakeSettings.parse(ok(await put(at.version, 7)));
    expect(seven.security.dataRetentionYears).toBe(7);
    // 14b: a change is 1 to 30 years, as each category.
    for (const years of [0, 31, 100, 1.5, '7']) {
      const res = await put(seven.version, years);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).toContain('security.dataRetentionYears');
    }
    const thirty = IntakeSettings.parse(ok(await put(seven.version, 30)));
    expect(thirty.security.dataRetentionYears).toBe(30);
    // A value saved under I12 (1 to 100 then) reads as it is and is never rewritten on read; a
    // write is 1 to 30, so it can't be sent back or applied to the categories, only changed.
    await inFirm('a', (tx) =>
      tx.intakeSettings.update({
        where: { businessId: firms.a },
        data: { dataRetentionYears: 50 },
      }),
    );
    const old = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
    expect(old.security.dataRetentionYears).toBe(50);
    expect(
      IntakeSettings.parse(ok(await call('get', '/intake-settings', adminA))).security
        .dataRetentionYears,
    ).toBe(50);
    for (const security of [{ dataRetentionYears: 50 }, { applyRetentionToAll: true }]) {
      const res = await call('put', '/intake-settings', ownerA, { version: old.version, security });
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).toContain('security.dataRetentionYears');
    }
    // Saving anything else, in Security or elsewhere, leaves it as it is (no 400).
    const other = IntakeSettings.parse(
      ok(
        await call('put', '/intake-settings', ownerA, {
          version: old.version,
          security: { consentRequired: false, retention: { systemEmails: 4 } },
          branding: { useFirmBranding: false },
        }),
      ),
    );
    expect(other.security).toMatchObject({ dataRetentionYears: 50, consentRequired: false });
    const back = IntakeSettings.parse(
      ok(
        await call('put', '/intake-settings', ownerA, {
          version: other.version,
          security: { consentRequired: true, retention: { systemEmails: null } },
          branding: { useFirmBranding: true },
        }),
      ),
    );
    expect(back.security.dataRetentionYears).toBe(50);
    const cleared = IntakeSettings.parse(ok(await put(back.version, null)));
    expect(cleared.security.dataRetentionYears).toBeNull();
    expect(await counts()).toEqual(before);
    IntakeSettings.parse(ok(await put(cleared.version, 7)));
  });

  it('14b: keeps six category minimums, each on its own or applied to all, and deletes nothing for them', async () => {
    const counts = () =>
      inFirm('a', async (tx) => ({
        intakes: await tx.intake.count({ where: { businessId: firms.a } }),
        submissions: await tx.intakeSubmission.count({ where: { businessId: firms.a } }),
        documents: await tx.document.count({ where: { businessId: firms.a } }),
      }));
    const before = await counts();
    const put = (version: string, security: object) =>
      call('put', '/intake-settings', ownerA, { version, security });
    const at = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
    // Apply to all: every category takes the years.
    const all = IntakeSettings.parse(
      ok(await put(at.version, { dataRetentionYears: 7, applyRetentionToAll: true })),
    );
    expect(all.security.dataRetentionYears).toBe(7);
    expect(Object.values(all.security.retention)).toEqual([7, 7, 7, 7, 7, 7]);
    // Each can still change on its own; cleared, Apply to all holds for it.
    const own = IntakeSettings.parse(
      ok(
        await put(all.version, {
          retention: { taxReturnDocuments: 10, portalMessages: null, clientDocuments: 3 },
        }),
      ),
    );
    expect(own.security.retention).toEqual({
      clientDocuments: 3,
      firmDocuments: 7,
      intakeSubmissions: 7,
      portalMessages: null,
      systemEmails: 7,
      taxReturnDocuments: 10,
    });
    expect(effectiveRetentionYears(own.security, 'portalMessages')).toBe(7);
    expect(effectiveRetentionYears(own.security, 'taxReturnDocuments')).toBe(10);
    // Saved as columns, and they survive a reload.
    const reread = IntakeSettings.parse(ok(await call('get', '/intake-settings', adminA)));
    expect(reread.security.retention).toEqual(own.security.retention);
    // Out of range, not whole, an unknown category, and Apply to all with no years: refused.
    for (const [security, path] of [
      [{ retention: { systemEmails: 31 } }, 'security.retention.systemEmails'],
      [{ retention: { systemEmails: 0 } }, 'security.retention.systemEmails'],
      [{ retention: { systemEmails: 2.5 } }, 'security.retention.systemEmails'],
      [{ retention: { invoices: 5 } }, 'security.retention'],
      [{ dataRetentionYears: null, applyRetentionToAll: true }, 'security.dataRetentionYears'],
    ] as const) {
      const res = await put(own.version, security);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(res.body)).toContain(path);
    }
    // Staff can't change them.
    expectError(
      await call('put', '/intake-settings', staffA, {
        version: own.version,
        security: { retention: { systemEmails: 2 } },
      }),
      403,
      'FORBIDDEN',
    );
    // A minimum removes nothing, and the change is audited by section only (no values).
    expect(await counts()).toEqual(before);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, action: 'intake_settings.updated' },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      }),
    );
    expect(audit.metadata).toMatchObject({ sections: ['security'] });
    expect(JSON.stringify(audit.metadata)).not.toContain('retention');
    // Firm B's settings are its own.
    const b = IntakeSettings.parse(
      ok(await call('get', '/intake-settings', ownerB, undefined, 'b')),
    );
    expect(b.security.retention.taxReturnDocuments).toBeNull();
  });

  it('14b: the guard keeps a record until its job was completed plus the minimum, and for good while it is not', async () => {
    const DAY = 86_400_000;
    const counts = () =>
      inFirm('a', async (tx) => ({
        intakes: await tx.intake.count({ where: { businessId: firms.a } }),
        documents: await tx.document.count({ where: { businessId: firms.a } }),
        engagements: await tx.engagement.count({ where: { businessId: firms.a } }),
      }));
    const before = await counts();
    // Apply to all 7 years; tax return documents 10 on their own.
    await inFirm('a', (tx) =>
      tx.intakeSettings.update({
        where: { businessId: firms.a },
        data: {
          dataRetentionYears: 7,
          retentionYearsClientDocuments: null,
          retentionYearsFirmDocuments: null,
          retentionYearsIntakeSubmissions: null,
          retentionYearsPortalMessages: null,
          retentionYearsSystemEmails: null,
          retentionYearsTaxReturnDocuments: 10,
        },
      }),
    );
    const longAgo = new Date('2012-03-01T15:00:00Z');
    const lately = new Date(Date.now() - DAY);
    const jobs = await inFirm('a', async (tx) => {
      const c = await tx.client.create({
        data: {
          businessId: firms.a,
          displayName: 'Ret Ention (fake)',
          email: `ret-${run}@client.test`,
        },
        select: { id: true },
      });
      const job = (status: 'ACTIVE' | 'COMPLETED', completedAt: Date | null) =>
        tx.engagement
          .create({
            data: {
              businessId: firms.a,
              clientId: c.id,
              serviceId: ids.service!,
              title: `Retention ${status}`,
              status,
              completedAt,
            },
            select: { id: true },
          })
          .then((e) => e.id);
      const task = (status: 'OPEN' | 'DONE', completedAt: Date | null) =>
        tx.task
          .create({
            data: {
              businessId: firms.a,
              clientId: c.id,
              title: `Retention task ${status}`,
              status,
              completedAt,
              createdByUserId: ownerA.id,
            },
            select: { id: true },
          })
          .then((t) => t.id);
      return {
        old: await job('COMPLETED', longAgo),
        recent: await job('COMPLETED', lately),
        open: await job('ACTIVE', null),
        oldTask: await task('DONE', longAgo),
        openTask: await task('OPEN', null),
      };
    });
    const theirs = await inFirm('b', async (tx) => {
      const service = await tx.service.create({
        data: { businessId: firms.b, kind: 'ANNUAL_TAX', name: `Ret B ${run}`, status: 'ACTIVE' },
        select: { id: true },
      });
      const c = await tx.client.create({
        data: {
          businessId: firms.b,
          displayName: 'Bee Ret (fake)',
          email: `retb-${run}@client.test`,
        },
        select: { id: true },
      });
      return (
        await tx.engagement.create({
          data: {
            businessId: firms.b,
            clientId: c.id,
            serviceId: service.id,
            title: 'B',
            status: 'COMPLETED',
            completedAt: longAgo,
          },
          select: { id: true },
        })
      ).id;
    });
    type Category = Parameters<typeof RetentionGuard.hold>[2];
    const hold = (category: Category, ref: RetentionRef) =>
      inFirm('a', (tx) => RetentionGuard.hold(tx, firms.a, category, ref));
    const removable = (category: Category, ref: RetentionRef) =>
      inFirm('a', (tx) => RetentionGuard.assertRemovable(tx, firms.a, category, ref));
    const kept = (message: string) =>
      expect.objectContaining({ response: { code: 'RETENTION_MINIMUM', message } });

    // Completed long ago: its minimum is over (2019; 2022 for tax return documents).
    expect(await hold('clientDocuments', { engagementId: jobs.old })).toEqual({
      kind: 'UNTIL',
      until: '2019-03-01',
    });
    expect(await hold('taxReturnDocuments', { engagementId: jobs.old })).toEqual({
      kind: 'UNTIL',
      until: '2022-03-01',
    });
    for (const category of [
      'clientDocuments',
      'firmDocuments',
      'intakeSubmissions',
      'portalMessages',
      'systemEmails',
      'taxReturnDocuments',
    ] as const)
      await expect(removable(category, { engagementId: jobs.old })).resolves.toBeUndefined();
    await expect(removable('portalMessages', { taskId: jobs.oldTask })).resolves.toBeUndefined();

    // Completed yesterday: kept until that day plus 7 years, said in words.
    const until = new Date(lately);
    until.setUTCFullYear(until.getUTCFullYear() + 7);
    const words = until.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    await expect(removable('firmDocuments', { engagementId: jobs.recent })).rejects.toEqual(
      kept(`Kept until ${words} under your retention policy`),
    );
    // Not completed, no job or task and no date of its own, a completed task of an open job,
    // another firm's job: kept.
    const open = kept('Kept: its job isn’t completed yet');
    await expect(removable('intakeSubmissions', { engagementId: jobs.open })).rejects.toEqual(open);
    await expect(removable('systemEmails', {})).rejects.toEqual(open);
    await expect(removable('portalMessages', { taskId: jobs.openTask })).rejects.toEqual(open);
    await expect(
      removable('portalMessages', { engagementId: jobs.open, taskId: jobs.oldTask }),
    ).rejects.toEqual(open);
    await expect(removable('clientDocuments', { engagementId: theirs })).rejects.toEqual(open);

    // 14b-ii (the lead's decision of Nov 17): with no job or task, the minimum counts from the
    // record's own date; with a job or task, its completion still decides.
    expect(await hold('systemEmails', { recordDate: longAgo })).toEqual({
      kind: 'UNTIL',
      until: '2019-03-01',
    });
    await expect(removable('systemEmails', { recordDate: longAgo })).resolves.toBeUndefined();
    await expect(removable('portalMessages', { recordDate: lately })).rejects.toEqual(
      kept(`Kept until ${words} under your retention policy`),
    );
    await expect(
      removable('intakeSubmissions', { engagementId: jobs.open, recordDate: longAgo }),
    ).rejects.toEqual(open);

    // No minimum set: nothing holds a record.
    await inFirm('a', (tx) =>
      tx.intakeSettings.update({
        where: { businessId: firms.a },
        data: { dataRetentionYears: null, retentionYearsTaxReturnDocuments: null },
      }),
    );
    expect(await hold('clientDocuments', { engagementId: jobs.open })).toEqual({ kind: 'NONE' });
    await expect(removable('clientDocuments', {})).resolves.toBeUndefined();

    // The guard only answers: nothing was removed (the jobs and tasks made here aside).
    expect(await counts()).toEqual({ ...before, engagements: before.engagements + 3 });
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
    expect(back.notifications).toMatchObject({
      firstReminderAfterMinutes: 4320,
      finalReminderAfterMinutes: 10080,
      expirationAlertMinutes: 1440,
      additionalEmails: [],
    });
    expect(back.security.dataRetentionYears).toBeNull();
    expect(Object.values(back.security.retention)).toEqual([null, null, null, null, null, null]);
    expect(back.clientExperience.thankYouMessage).toBeNull();
    expect(
      IntakeSettingsChangeList.parse(ok(await call('get', '/intake-settings/changes', ownerA)))
        .items[0]?.label,
    ).toBe('Settings reset to the defaults');
  });

  it('max file size per file: a change is 2, 5, 10, 50 or 100 MB (I10)', async () => {
    const start = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
    expect(start.security.maxFileSizeMb).toBe(10);
    const refused = await call('put', '/intake-settings', ownerA, {
      version: start.version,
      security: { maxFileSizeMb: 25 },
    });
    expectError(refused, 400, 'VALIDATION_FAILED');
    expect((refused.body as { error: { details: unknown } }).error.details).toEqual([
      { path: 'security.maxFileSizeMb', message: 'Choose 2, 5, 10, 50 or 100 MB' },
    ]);
    const fifty = IntakeSettings.parse(
      ok(
        await call('put', '/intake-settings', ownerA, {
          version: start.version,
          security: { maxFileSizeMb: 50 },
        }),
      ),
    );
    expect(fifty.security.maxFileSizeMb).toBe(50);
    expect(
      IntakeSettings.parse(ok(await call('get', '/intake-settings', adminA))).security
        .maxFileSizeMb,
    ).toBe(50);
  });

  it('a firm that saved 25 MB before keeps it, shown and saved as it is, until it changes it', async () => {
    // The API took any size from 1 to 100 MB until I10: such a row, written as it allowed.
    await inFirm('a', (tx) =>
      tx.intakeSettings.update({ where: { businessId: firms.a }, data: { maxFileSizeMb: 25 } }),
    );
    const before = IntakeSettings.parse(ok(await call('get', '/intake-settings', ownerA)));
    expect(before.security.maxFileSizeMb).toBe(25);
    // Other fields save, with the size sent back unchanged or left out.
    const kept = IntakeSettings.parse(
      ok(
        await call('put', '/intake-settings', ownerA, {
          version: before.version,
          general: { requireSignature: false },
          security: { maxFileSizeMb: 25, consentRequired: false },
        }),
      ),
    );
    // Intake Review 2 23-h (lead, Nov 17): Require e-signature is always on; a false sent stays on.
    expect(kept.general.requireSignature).toBe(true);
    expect(kept.security).toMatchObject({ maxFileSizeMb: 25, consentRequired: false });
    const still = IntakeSettings.parse(
      ok(
        await call('put', '/intake-settings', adminA, {
          version: kept.version,
          security: { consentRequired: true },
        }),
      ),
    );
    expect(still.security).toMatchObject({ maxFileSizeMb: 25, consentRequired: true });
    // A change still has to be one of the choices; once it is, 25 MB is not taken back.
    const other = await call('put', '/intake-settings', ownerA, {
      version: still.version,
      security: { maxFileSizeMb: 30 },
    });
    expectError(other, 400, 'VALIDATION_FAILED');
    const hundred = IntakeSettings.parse(
      ok(
        await call('put', '/intake-settings', ownerA, {
          version: still.version,
          security: { maxFileSizeMb: 100 },
        }),
      ),
    );
    expect(hundred.security.maxFileSizeMb).toBe(100);
    expectError(
      await call('put', '/intake-settings', ownerA, {
        version: hundred.version,
        security: { maxFileSizeMb: 25 },
      }),
      400,
      'VALIDATION_FAILED',
    );
    const row = await inFirm('a', (tx) =>
      tx.intakeSettings.findUniqueOrThrow({ where: { businessId: firms.a } }),
    );
    expect(row.maxFileSizeMb).toBe(100);
  });

  it('is changed by Owner and Admin only', async () => {
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
  });

  // Octavia's review of Oct 20 (I6): a real test, to the member who asked, that changes nothing.
  it('sends a test reminder to the member who asked, and nothing else changes', async () => {
    const before = IntakeSettings.parse(ok(await call('get', '/intake-settings', adminA)));
    const changesBefore = IntakeSettingsChangeList.parse(
      ok(await call('get', '/intake-settings/changes', adminA)),
    ).items;
    outbox.length = 0;
    expect(ok(await call('post', '/intake-settings/test-reminder', adminA, {}))).toEqual({
      ok: true,
    });
    expect(outbox).toHaveLength(1);
    const [mail] = outbox;
    expect(mail).toMatchObject({
      template: 'lead.message-email',
      to: adminA.email,
      businessId: firms.a,
    });
    const data = mail?.data as { subject: string; body: string };
    expect(data.subject).toMatch(/^\[Test\] /);
    expect(data.body).toContain('No client was contacted');
    // No client's name or address, ever.
    expect(JSON.stringify(mail)).not.toMatch(/client\.test|Mina|Theo|Lou/);
    // Nothing else changed: the settings' version and their recent changes.
    const after = IntakeSettings.parse(ok(await call('get', '/intake-settings', adminA)));
    expect(after.version).toBe(before.version);
    expect(
      IntakeSettingsChangeList.parse(ok(await call('get', '/intake-settings/changes', adminA)))
        .items,
    ).toEqual(changesBefore);
    const sent = await inFirm('a', (tx) =>
      tx.auditLog.count({ where: { businessId: firms.a, action: 'intake_reminder.test_sent' } }),
    );
    expect(sent).toBe(1);

    // Staff may not; a sender that refuses says so.
    expectError(await call('post', '/intake-settings/test-reminder', staffA, {}), 403, 'FORBIDDEN');
    expectError(
      await call('post', '/intake-settings/test-reminder', refusedAdminA, {}),
      503,
      'TEST_REMINDER_FAILED',
    );
  });
});

describe('the public link (I3)', () => {
  const fixture = (key: 'template' | 'service') => {
    const id = ids[key];
    if (!id) throw new Error(`the ${key} fixture is missing`);
    return id;
  };
  const linkOf = async (id: string, who: Who = ownerA) =>
    PublicLink.parse(ok(await call('get', `/intake-forms/${id}/public-link`, who)));
  const setService = (
    id: string,
    data: { beginOnline?: boolean; status?: 'ACTIVE' | 'INACTIVE'; archivedAt?: Date | null },
  ) => inFirm('a', (tx) => tx.service.update({ where: { id }, data, select: { id: true } }));
  /** A service with one form; the database makes its default template. */
  const serviceWithForm = (
    kind: 'ANNUAL_TAX' | 'BOOKKEEPING' | 'TAX_PLANNING' | 'OTHER',
    status: 'PUBLISHED' | 'DRAFT',
    beginOnline = false,
  ) =>
    inFirm('a', async (tx) => {
      const service = await tx.service.create({
        data: { businessId: firms.a, kind, name: `${kind} ${run}`, status: 'ACTIVE', beginOnline },
        select: { id: true },
      });
      const form = await tx.intakeForm.create({
        data: {
          businessId: firms.a,
          serviceId: service.id,
          version: 1,
          title: `${kind} Intake`,
          definition: (INTAKE_FORMS[kind === 'OTHER' ? 'ANNUAL_TAX' : kind] ?? {}) as object,
          status,
          publishedAt: status === 'PUBLISHED' ? new Date() : null,
        },
        select: { templateId: true },
      });
      return { service: service.id, template: form.templateId as string };
    });

  it("is the main form's Begin Online page, and its state follows the service", async () => {
    const url = beginOnlinePageUrl(portal, `r55i-a-${run}`, 'ANNUAL_TAX');
    // Not on Begin Online (the service is made with it off).
    const hidden = await linkOf(fixture('template'));
    expect(hidden).toEqual({
      kind: 'INTAKE_FORM',
      itemId: fixture('template'),
      url,
      embedCode: publicIntakeEmbedCode(url, 'Annual Tax Intake'),
      buttonCode: publicButtonCode(url, 'Annual Tax Intake'),
      portalEntryUrl: publicPortalEntryUrl(portal, `r55i-a-${run}`),
      state: 'HIDDEN',
    });
    expect(url).toMatch(/\/begin\/annual-tax$/);
    // Every member who can open the form reads it; nothing is written.
    expect(await linkOf(fixture('template'), staffA)).toEqual(hidden);

    await setService(fixture('service'), { beginOnline: true });
    expect((await linkOf(fixture('template'))).state).toBe('LIVE');
    await setService(fixture('service'), { status: 'INACTIVE' });
    expect((await linkOf(fixture('template'))).state).toBe('INACTIVE');
    await setService(fixture('service'), { status: 'ACTIVE', archivedAt: new Date() });
    expect((await linkOf(fixture('template'))).state).toBe('ARCHIVED');
    await setService(fixture('service'), { beginOnline: false, archivedAt: null });
    expect((await linkOf(fixture('template'))).state).toBe('HIDDEN');

    // A main form with no published version yet.
    const draft = await serviceWithForm('TAX_PLANNING', 'DRAFT', true);
    const planning = await linkOf(draft.template);
    expect(planning).toMatchObject({
      state: 'DRAFT',
      url: expect.stringMatching(/\/begin\/tax-planning$/),
    });
  });

  it('is only for a main form whose page is its own', async () => {
    // Another form of the same service: no page of its own.
    const copy = IntakeFormDetail.parse(
      ok(await call('post', `/intake-forms/${ids.template}/duplicate`, ownerA, {}), 201),
    );
    expectError(
      await call('get', `/intake-forms/${copy.id}/public-link`, ownerA),
      404,
      'NOT_FOUND',
    );
    // A service of no Begin Online kind.
    const other = await serviceWithForm('OTHER', 'PUBLISHED');
    expectError(
      await call('get', `/intake-forms/${other.template}/public-link`, ownerA),
      404,
      'NOT_FOUND',
    );
    // Archived, a form is no longer its service's main form.
    const books = await serviceWithForm('BOOKKEEPING', 'PUBLISHED');
    expect((await linkOf(books.template)).state).toBe('HIDDEN');
    ok(await call('post', `/intake-forms/${books.template}/archive`, ownerA, {}));
    expectError(
      await call('get', `/intake-forms/${books.template}/public-link`, ownerA),
      404,
      'NOT_FOUND',
    );
    // The kind's page belongs to another service of the firm: only that one has the link.
    const second = await serviceWithForm('ANNUAL_TAX', 'PUBLISHED', true);
    expect((await linkOf(second.template)).state).toBe('LIVE');
    expectError(
      await call('get', `/intake-forms/${ids.template}/public-link`, ownerA),
      404,
      'NOT_FOUND',
    );
    await setService(second.service, { archivedAt: new Date() });
    expect((await linkOf(fixture('template'))).state).toBe('HIDDEN');
    expectError(
      await call('get', `/intake-forms/${randomUUID()}/public-link`, ownerA),
      404,
      'NOT_FOUND',
    );
  });
});

describe('another firm', () => {
  it('sees none of it', async () => {
    expectError(
      await call('get', `/intake-forms/${ids.template}/public-link`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
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
