// End-to-end: the Compliance API (contract in packages/types/src/compliance): deadlines and their
// actions, the Overview figures, the Calendar Library, recurring definitions, applicability rules
// and suggestions, logs and settings. Everyone with the COMPLIANCE view reads and prepares (Staff
// only the deadlines of clients assigned to them); Owner and Admin manage the library, the
// definitions, the rules and the settings, and move government dates. Firm B can never read or
// change firm A's data, and every change writes an audit row. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { z } from 'zod';
import {
  BulkDeadlinesResult,
  ClientCompliance,
  ComplianceApplicabilityRule,
  ComplianceApplicabilityRulePage,
  ComplianceAtRiskList,
  ComplianceByClientPage,
  ComplianceCalendar,
  ComplianceCalendarDiff,
  ComplianceCalendarEntry,
  ComplianceCalendarMonth,
  ComplianceCalendarPage,
  ComplianceDeadline,
  ComplianceDeadlinePage,
  ComplianceLogPage,
  ComplianceOk,
  ComplianceRecurrence,
  ComplianceRecurrencePage,
  ComplianceRecurrencePreview,
  ComplianceRuleEvaluation,
  ComplianceSettings,
  ComplianceSuggestionPage,
  ComplianceSummary,
  GenerateSuggestionsResult,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `cmp-${key}-${run}@cmp.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  /** Staff: reaches only the clients assigned to them (client 1). */
  staffA: person('staff-a'),
  /** Staff with no client assigned. */
  staff2A: person('staff2-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Who = { email: string };
const ids = { firmA: '', firmB: '', firmC: '', firmD: '' };
/** Records of firm A and the other firms. */
const s = {
  c1: '',
  c2: '',
  c3: '',
  eng1: '',
  doc1: '',
  doc2: '',
  tpl: '',
  tplB: '',
  task1: '',
  task2: '',
  b1: '',
};

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
/** A new viewer IP per call, so no test meets the per-IP rate limit. */
const viewer = () => {
  viewers += 1;
  return `198.53.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
};

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
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  who: Who | undefined,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);

/** Parses with the contract and refuses anything the response has beyond it. */
function exact<S extends z.ZodType>(schema: S, res: Response, status = 200): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

async function asOwner<T>(
  businessId: string,
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, work);
  } finally {
    await owner.$disconnect();
  }
}

const auditActions = (entityId: string, businessId = ids.firmA) =>
  asOwner(businessId, async (tx) =>
    (await tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } })).map(
      (r) => r.action,
    ),
  );

const DAY = 86_400_000;
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** The calendar day `n` days from today. */
const plus = (n: number) => iso(new Date(today().getTime() + n * DAY));
const at = (n: number) => new Date(`${plus(n)}T00:00:00.000Z`);

let n = 0;
const name = (what: string) => `Fake ${what} ${run} ${(n += 1)}`;

const mkDeadline = async (body: object = {}, who: Who = people.ownerA, firm = ids.firmA) =>
  exact(
    ComplianceDeadline,
    await call(
      'post',
      '/compliance/deadlines',
      who,
      { clientId: s.c1, name: name('deadline'), type: 'TAX_FILING', dueOn: plus(40), ...body },
      firm,
    ),
    201,
  );
const get = async (id: string, who: Who = people.ownerA, firm = ids.firmA) =>
  exact(ComplianceDeadline, await call('get', `/compliance/deadlines/${id}`, who, undefined, firm));
const act = async (id: string, action: string, body?: object, who: Who = people.ownerA) =>
  call('post', `/compliance/deadlines/${id}/${action}`, who, body);

const mkCalendar = async (body: object = {}, who: Who = people.ownerA, firm = ids.firmA) =>
  exact(
    ComplianceCalendar,
    await call(
      'post',
      '/compliance/calendars',
      who,
      {
        family: 'IRS_GENERAL',
        authority: `Fake IRS ${run}`,
        jurisdiction: 'FEDERAL',
        effectiveYear: 2031,
        name: name('calendar'),
        sourceUrl: 'https://www.irs.gov/publications/p509',
        entries: [
          { ruleKind: 'FIXED_DATE', name: 'Form 1040', type: 'TAX_FILING', dueOn: '2031-04-15' },
        ],
        ...body,
      },
      firm,
    ),
    201,
  );

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake compliance ${key}`,
        },
      });
    }
    for (const key of ['firmA', 'firmB', 'firmC', 'firmD'] as const) {
      const slug = `cmp-${key.toLowerCase()}-${run}`;
      ids[key] = (
        await tx.business.create({
          data: { slug, name: slug, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  const members = [
    [ids.firmA, people.ownerA.id, 'OWNER'],
    [ids.firmA, people.adminA.id, 'ADMIN'],
    [ids.firmA, people.staffA.id, 'STAFF'],
    [ids.firmA, people.staff2A.id, 'STAFF'],
    [ids.firmB, people.ownerB.id, 'OWNER'],
    [ids.firmC, people.ownerA.id, 'OWNER'],
    [ids.firmD, people.ownerA.id, 'OWNER'],
  ] as const;
  for (const [businessId, userId, role] of members) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await tx.clientAccount.create({
      data: {
        businessId: ids.firmA,
        userId: people.clientA.id,
        email: people.clientA.email,
        status: 'ACTIVE',
      },
    });
    const mk = (displayName: string, assignedUserId?: string) =>
      tx.client.create({
        data: { businessId: ids.firmA, displayName, accountType: 'BUSINESS', assignedUserId },
      });
    s.c1 = (await mk(`Fake Client One ${run}`, people.staffA.id)).id;
    s.c2 = (await mk(`Fake Client Two ${run}`)).id;
    s.c3 = (await mk(`Fake Client Three ${run}`)).id;
    await tx.clientProfile.create({
      data: { businessId: ids.firmA, clientId: s.c1, entityType: 'S_CORPORATION', state: 'GA' },
    });
    await tx.clientProfile.create({
      data: { businessId: ids.firmA, clientId: s.c2, entityType: 'LLC', state: 'FL' },
    });
    const service = await tx.service.create({
      data: { businessId: ids.firmA, kind: 'BOOKKEEPING', name: `Fake service ${run}` },
    });
    s.eng1 = (
      await tx.engagement.create({
        data: { businessId: ids.firmA, clientId: s.c1, serviceId: service.id, title: 'Fake' },
      })
    ).id;
    const doc = async (clientId: string) => {
      const key = randomUUID();
      const engagement =
        clientId === s.c1
          ? s.eng1
          : (
              await tx.engagement.create({
                data: { businessId: ids.firmA, clientId, serviceId: service.id, title: 'Fake' },
              })
            ).id;
      return (
        await tx.document.create({
          data: {
            businessId: ids.firmA,
            clientId,
            engagementId: engagement,
            direction: 'FIRM_TO_CLIENT',
            fileName: 'fake.pdf',
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: createHash('sha256').update(key).digest('hex'),
            s3Key: `tenant/${ids.firmA}/cmp/${key}/fake.pdf`,
          },
        })
      ).id;
    };
    s.doc1 = await doc(s.c1);
    s.doc2 = await doc(s.c2);
    s.tpl = (
      await tx.taskTemplate.create({ data: { businessId: ids.firmA, name: name('template') } })
    ).id;
    s.task1 = (
      await tx.task.create({
        data: { businessId: ids.firmA, clientId: s.c1, title: 'Fake task 1' },
      })
    ).id;
    s.task2 = (
      await tx.task.create({
        data: { businessId: ids.firmA, clientId: s.c2, title: 'Fake task 2' },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    s.b1 = (
      await tx.client.create({
        data: {
          businessId: ids.firmB,
          displayName: `Fake B Client ${run}`,
          accountType: 'BUSINESS',
        },
      })
    ).id;
    s.tplB = (
      await tx.taskTemplate.create({ data: { businessId: ids.firmB, name: name('template B') } })
    ).id;
  });
  await owner.$disconnect();

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
});

afterAll(async () => {
  await app.close();
});

describe('who may do what', () => {
  it('staff read and prepare; Owner and Admin manage; clients 403; strangers 404; signed out 401', async () => {
    for (const path of [
      '/compliance/deadlines',
      '/compliance/deadlines/summary',
      '/compliance/deadlines/at-risk',
      '/compliance/deadlines/by-client',
      '/compliance/deadlines/calendar',
      '/compliance/calendars',
      '/compliance/recurrences',
      '/compliance/applicability-rules',
      '/compliance/suggestions',
      '/compliance/logs',
      '/compliance/settings',
    ]) {
      expect((await call('get', path, people.staffA)).status, path).toBe(200);
      expect((await call('get', path, people.clientA)).status, path).toBe(403);
      expect((await call('get', path, undefined)).status, path).toBe(401);
      expectError(await call('get', path, people.ownerB), 404, 'NOT_FOUND');
    }
    expect((await call('get', `/clients/${s.c1}/compliance`, people.clientA)).status).toBe(403);
    // Only Owner and Admin change the library, definitions, rules and settings.
    const manager: [string, string, object][] = [
      ['post', '/compliance/calendars', {}],
      ['post', '/compliance/recurrences', {}],
      ['post', '/compliance/applicability-rules', {}],
      ['patch', '/compliance/settings', { dueSoonDays: 10 }],
      ['post', '/compliance/calendars/import-preview', {}],
    ];
    for (const [method, path, body] of manager) {
      expectError(await call(method as 'post', path, people.staffA, body), 403, 'FORBIDDEN');
    }
    expect((await call('get', '/compliance/calendars', people.adminA)).status).toBe(200);
  });
});

describe('settings', () => {
  it('starts with the defaults and keeps what Owner or Admin change, audited', async () => {
    const fresh = exact(
      ComplianceSettings,
      await call('get', '/compliance/settings', people.ownerB, undefined, ids.firmB),
    );
    expect(fresh).toEqual({
      dueSoonDays: 14,
      atRiskDays: 7,
      staleCalendarDays: 90,
      defaultReminders: [],
      sendPastDueNotice: false,
      escalateToManager: false,
      escalateAfterDays: 3,
      taskTemplates: [],
    });
    const saved = exact(
      ComplianceSettings,
      await call(
        'patch',
        '/compliance/settings',
        people.ownerB,
        {
          atRiskDays: 10,
          defaultReminders: [{ daysBefore: 7 }, { daysBefore: 1, channels: ['EMAIL'] }],
          escalateToManager: true,
        },
        ids.firmB,
      ),
    );
    expect(saved).toMatchObject({
      dueSoonDays: 14,
      atRiskDays: 10,
      escalateToManager: true,
      defaultReminders: [
        { daysBefore: 7, inApp: true, channels: [] },
        { daysBefore: 1, inApp: true, channels: ['EMAIL'] },
      ],
    });
    // Firm A is untouched.
    expect(
      exact(ComplianceSettings, await call('get', '/compliance/settings', people.ownerA))
        .atRiskDays,
    ).toBe(7);
    expect(
      (
        await asOwner(ids.firmB, (tx) =>
          tx.auditLog.findMany({ where: { action: 'compliance.settings.updated' } }),
        )
      ).length,
    ).toBe(1);
  });

  it("refuses values the database would refuse, and another firm's task templates", async () => {
    const patch = (body: object) => call('patch', '/compliance/settings', people.ownerA, body);
    for (const body of [
      {},
      { dueSoonDays: 0 },
      { dueSoonDays: 91 },
      { staleCalendarDays: 6 },
      { escalateAfterDays: 61 },
      { dueSoonDays: 1, extra: true },
      { defaultReminders: [{ daysBefore: 1 }, { daysBefore: 1 }] },
      {
        taskTemplates: [
          { type: 'TAX_FILING', taskTemplateId: s.tpl },
          { type: 'TAX_FILING', taskTemplateId: s.tpl },
        ],
      },
    ]) {
      expectError(await patch(body), 400, 'VALIDATION_FAILED');
    }
    expectError(
      await patch({ taskTemplates: [{ type: 'TAX_FILING', taskTemplateId: s.tplB }] }),
      409,
      'TEMPLATE_NOT_FOUND',
    );
    expectError(
      await patch({ taskTemplates: [{ type: 'TAX_FILING', taskTemplateId: randomUUID() }] }),
      409,
      'TEMPLATE_NOT_FOUND',
    );
  });

  it('keeps a default task template per deadline type, which a deadline that makes a task uses', async () => {
    const saved = exact(
      ComplianceSettings,
      await call('patch', '/compliance/settings', people.adminA, {
        dueSoonDays: 14,
        defaultReminders: [{ daysBefore: 7 }, { daysBefore: 1, channels: ['EMAIL'] }],
        taskTemplates: [{ type: 'BOOKKEEPING', taskTemplateId: s.tpl }],
      }),
    );
    expect(saved.taskTemplates).toEqual([{ type: 'BOOKKEEPING', taskTemplateId: s.tpl }]);
    const d = await mkDeadline({ type: 'BOOKKEEPING', createTask: true });
    expect(d.tasks).toHaveLength(1);
    expect(d.createTask).toBe(true);
    const task = await asOwner(ids.firmA, (tx) =>
      tx.task.findFirstOrThrow({ where: { id: d.tasks[0]!.id } }),
    );
    expect(task).toMatchObject({ templateId: s.tpl, deadlineId: d.id, clientId: s.c1 });
    await call('patch', '/compliance/settings', people.ownerA, { taskTemplates: [] });
  });
});

describe('creating and reading deadlines', () => {
  it("creates a deadline with the firm's default reminders, audited", async () => {
    const d = await mkDeadline({
      description: 'Fake description',
      internalNotes: 'Fake internal',
      clientNotes: 'Fake for the client',
      agency: 'IRS',
      relatedForm: '1065',
      state: 'GA',
      taxYear: 2030,
      filingPeriod: 'Annual',
      dueTime: '09:30',
      priority: 'HIGH',
      clientVisible: true,
    });
    expect(d).toMatchObject({
      client: { id: s.c1 },
      status: 'UPCOMING',
      displayStatus: 'UPCOMING',
      source: 'FIRM',
      priority: 'HIGH',
      dueTime: '09:30',
      statutoryDueOn: null,
      dueOverridden: false,
      assignedTo: null,
      recurring: false,
      archived: false,
      calendarStale: false,
      daysUntilDue: 40,
      clientVisible: true,
      createdBy: { userId: people.ownerA.id },
      reminders: [
        { daysBefore: 7, inApp: true, channels: [] },
        { daysBefore: 1, inApp: true, channels: ['EMAIL'] },
      ],
    });
    expect(await auditActions(d.id)).toEqual(['compliance.deadline.created']);
    // Own reminders replace the defaults.
    const own = await mkDeadline({
      reminders: [{ daysBefore: 3, inApp: false, channels: ['SMS'] }],
    });
    expect(own.reminders).toEqual([{ daysBefore: 3, inApp: false, channels: ['SMS'] }]);
  });

  it('refuses a bad request', async () => {
    const post = (body: object) =>
      call('post', '/compliance/deadlines', people.ownerA, {
        clientId: s.c1,
        name: 'Fake',
        type: 'TAX_FILING',
        dueOn: plus(5),
        ...body,
      });
    for (const body of [
      { name: '' },
      { name: 'x'.repeat(201) },
      { type: 'NOPE' },
      { dueOn: '2026-13-01' },
      { dueTime: '25:00' },
      { state: 'Georgia' },
      { status: 'COMPLETED' },
      { taxYear: 1999 },
      { createTask: false, taskTemplateId: s.tpl },
      { unknown: 1 },
      { dueOverrideReason: 'No move, no reason' },
    ]) {
      expectError(await post(body), 400, 'VALIDATION_FAILED');
    }
  });

  it('is for the clients the caller reaches, in this firm', async () => {
    const body = { name: name('deadline'), type: 'TAX_FILING', dueOn: plus(9) };
    // Staff reach only their assigned client.
    expectError(
      await call('post', '/compliance/deadlines', people.staffA, { clientId: s.c2, ...body }),
      404,
      'NOT_FOUND',
    );
    expect(
      (await call('post', '/compliance/deadlines', people.staffA, { clientId: s.c1, ...body }))
        .status,
    ).toBe(201);
    // Another firm's client, and a client that does not exist.
    for (const clientId of [s.b1, randomUUID()]) {
      expectError(
        await call('post', '/compliance/deadlines', people.ownerA, { clientId, ...body }),
        404,
        'NOT_FOUND',
      );
    }
    // An archived client takes no new deadline.
    await asOwner(ids.firmA, (tx) =>
      tx.client.update({ where: { id: s.c3 }, data: { archivedAt: new Date() } }),
    );
    expectError(
      await call('post', '/compliance/deadlines', people.ownerA, { clientId: s.c3, ...body }),
      404,
      'NOT_FOUND',
    );
    await asOwner(ids.firmA, (tx) =>
      tx.client.update({ where: { id: s.c3 }, data: { archivedAt: null } }),
    );
  });

  it('checks the assignee and the engagement', async () => {
    const d = await mkDeadline({ assignedUserId: people.adminA.id, engagementId: s.eng1 });
    expect(d.assignedTo).toEqual({ userId: people.adminA.id, name: 'Fake compliance adminA' });
    expect(d.engagementId).toBe(s.eng1);
    expectError(
      await call('post', '/compliance/deadlines', people.ownerA, {
        clientId: s.c1,
        name: 'Fake',
        type: 'TAX_FILING',
        dueOn: plus(5),
        assignedUserId: people.clientA.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    // A Staff member only for a client assigned to them.
    expectError(
      await call('post', '/compliance/deadlines', people.ownerA, {
        clientId: s.c1,
        name: 'Fake',
        type: 'TAX_FILING',
        dueOn: plus(5),
        assignedUserId: people.staff2A.id,
      }),
      409,
      'CLIENT_NOT_ASSIGNED',
    );
    expect((await mkDeadline({ assignedUserId: people.staffA.id })).assignedTo?.userId).toBe(
      people.staffA.id,
    );
    // The engagement must be the client's.
    const other = await asOwner(ids.firmA, async (tx) => {
      const service = await tx.service.findFirstOrThrow({ where: { businessId: ids.firmA } });
      return (
        await tx.engagement.create({
          data: { businessId: ids.firmA, clientId: s.c2, serviceId: service.id, title: 'Other' },
        })
      ).id;
    });
    expectError(
      await call('post', '/compliance/deadlines', people.ownerA, {
        clientId: s.c1,
        name: 'Fake',
        type: 'TAX_FILING',
        dueOn: plus(5),
        engagementId: other,
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
  });

  it('makes one task from a template, once, due on the deadline', async () => {
    const d = await mkDeadline({
      createTask: true,
      taskTemplateId: s.tpl,
      assignedUserId: people.adminA.id,
    });
    expect(d.tasks).toHaveLength(1);
    expect(d.tasks[0]).toMatchObject({ status: 'OPEN', dueOn: d.dueOn });
    expect(d.tasks[0]?.title).toContain(d.name);
    expect(d.taskTemplateId).toBe(s.tpl);
    // Asking again finds the first (one task per deadline and template).
    const again = exact(
      ComplianceDeadline,
      await call('post', `/compliance/deadlines/${d.id}/tasks`, people.ownerA, {
        templateId: s.tpl,
      }),
    );
    expect(again.tasks.map((t) => t.id)).toEqual(d.tasks.map((t) => t.id));
    // A template of another firm.
    expectError(
      await call('post', '/compliance/deadlines', people.ownerA, {
        clientId: s.c1,
        name: 'Fake',
        type: 'TAX_FILING',
        dueOn: plus(5),
        createTask: true,
        taskTemplateId: s.tplB,
      }),
      409,
      'TEMPLATE_NOT_FOUND',
    );
    // A plain task with its own title.
    const plain = exact(
      ComplianceDeadline,
      await call('post', `/compliance/deadlines/${d.id}/tasks`, people.ownerA, {
        title: 'Gather K-1s',
      }),
    );
    expect(plain.tasks.map((t) => t.title)).toContain('Gather K-1s');
    expect(await auditActions(d.id)).toContain('compliance.deadline.task-created');
  });

  it('reads one deadline in full, and hides it from other firms and from staff who do not reach it', async () => {
    const d = await mkDeadline({ agency: 'IRS' });
    expect(await get(d.id)).toEqual(d);
    expect((await get(d.id, people.staffA)).id).toBe(d.id);
    expectError(
      await call('get', `/compliance/deadlines/${d.id}`, people.staff2A),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/compliance/deadlines/${d.id}`, people.ownerB, undefined, ids.firmB),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/compliance/deadlines/${randomUUID()}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', '/compliance/deadlines/not-a-uuid', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expect(await auditActions(d.id)).toContain('compliance.deadline.viewed');
  });
});

describe('moving a government date', () => {
  const gov = (over: object = {}) => ({
    clientId: s.c1,
    name: name('government'),
    type: 'TAX_FILING',
    source: 'GOVERNMENT',
    statutoryDueOn: '2031-04-15',
    dueOn: '2031-04-20',
    ...over,
  });

  it('needs the Owner or an Admin, and a reason', async () => {
    expectError(
      await call('post', '/compliance/deadlines', people.staffA, gov()),
      403,
      'OVERRIDE_NOT_ALLOWED',
    );
    expectError(
      await call('post', '/compliance/deadlines', people.ownerA, gov()),
      409,
      'OVERRIDE_REASON_REQUIRED',
    );
    const d = exact(
      ComplianceDeadline,
      await call(
        'post',
        '/compliance/deadlines',
        people.adminA,
        gov({ dueOverrideReason: 'Client asked' }),
      ),
      201,
    );
    expect(d).toMatchObject({
      statutoryDueOn: '2031-04-15',
      dueOn: '2031-04-20',
      dueOverridden: true,
      dueOverrideReason: 'Client asked',
    });
    const logs = exact(
      ComplianceLogPage,
      await call('get', '/compliance/logs?kind=OVERRIDE', people.staffA),
    );
    expect(logs.items.some((l) => l.deadlineId === d.id && l.outcome === 'SUCCESS')).toBe(true);
    expect(JSON.stringify(logs.items)).not.toContain('Client asked');
  });

  it('keeps the library date when the date moves again, and clears the override when it moves back', async () => {
    const d = exact(
      ComplianceDeadline,
      await call(
        'post',
        '/compliance/deadlines',
        people.ownerA,
        gov({ dueOverrideReason: 'First' }),
      ),
      201,
    );
    const patch = (who: Who, body: object) =>
      call('patch', `/compliance/deadlines/${d.id}`, who, body);
    expectError(await patch(people.staffA, { dueOn: '2031-05-01' }), 403, 'OVERRIDE_NOT_ALLOWED');
    expectError(
      await patch(people.ownerA, { dueOn: '2031-05-01' }),
      409,
      'OVERRIDE_REASON_REQUIRED',
    );
    expectError(
      await patch(people.ownerA, { name: 'Renamed', dueOverrideReason: 'No move' }),
      400,
      'VALIDATION_FAILED',
    );
    const moved = exact(
      ComplianceDeadline,
      await patch(people.ownerA, { dueOn: '2031-05-01', dueOverrideReason: 'Second' }),
    );
    expect(moved).toMatchObject({
      statutoryDueOn: '2031-04-15',
      dueOn: '2031-05-01',
      dueOverrideReason: 'Second',
    });
    const back = exact(ComplianceDeadline, await patch(people.ownerA, { dueOn: '2031-04-15' }));
    expect(back).toMatchObject({
      statutoryDueOn: '2031-04-15',
      dueOn: '2031-04-15',
      dueOverridden: false,
      dueOverrideReason: null,
    });
  });

  it('keeps the original date of a government deadline that had no statutory date yet', async () => {
    const d = await mkDeadline({ source: 'IMPORTED', dueOn: '2031-06-10' });
    expect(d.statutoryDueOn).toBeNull();
    expectError(
      await call('patch', `/compliance/deadlines/${d.id}`, people.ownerA, { dueOn: '2031-06-12' }),
      409,
      'OVERRIDE_REASON_REQUIRED',
    );
    const moved = exact(
      ComplianceDeadline,
      await call('patch', `/compliance/deadlines/${d.id}`, people.ownerA, {
        dueOn: '2031-06-12',
        dueOverrideReason: 'Holiday',
      }),
    );
    expect(moved).toMatchObject({
      statutoryDueOn: '2031-06-10',
      dueOn: '2031-06-12',
      dueOverridden: true,
    });
    // A firm date moves freely, with no reason.
    const own = await mkDeadline({ dueOn: '2031-06-10' });
    expect(
      exact(
        ComplianceDeadline,
        await call('patch', `/compliance/deadlines/${own.id}`, people.staffA, {
          dueOn: '2031-06-11',
        }),
      ).dueOn,
    ).toBe('2031-06-11');
  });
});

describe('editing a deadline', () => {
  it('changes fields, clears notes with null, and audits the fields changed', async () => {
    const d = await mkDeadline({ description: 'Old', internalNotes: 'Old notes', agency: 'IRS' });
    const patched = exact(
      ComplianceDeadline,
      await call('patch', `/compliance/deadlines/${d.id}`, people.staffA, {
        name: 'Renamed deadline',
        priority: 'LOW',
        description: null,
        internalNotes: '',
        dueTime: '16:45',
        paymentDueOn: plus(50),
        status: 'IN_PROGRESS',
        clientVisible: true,
        taxYear: 2029,
      }),
    );
    expect(patched).toMatchObject({
      name: 'Renamed deadline',
      priority: 'LOW',
      description: null,
      internalNotes: null,
      agency: 'IRS',
      dueTime: '16:45',
      paymentDueOn: plus(50),
      status: 'IN_PROGRESS',
      clientVisible: true,
      taxYear: 2029,
    });
    const cleared = exact(
      ComplianceDeadline,
      await call('patch', `/compliance/deadlines/${d.id}`, people.ownerA, {
        dueTime: null,
        paymentDueOn: null,
      }),
    );
    expect(cleared).toMatchObject({ dueTime: null, paymentDueOn: null });
    expect(await auditActions(d.id)).toContain('compliance.deadline.updated');
    const row = await asOwner(ids.firmA, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: d.id, action: 'compliance.deadline.updated' },
      }),
    );
    expect(JSON.stringify(row.metadata)).not.toContain('Old notes');
  });

  it('refuses an empty change, the client, a closed status change and an archived deadline', async () => {
    const d = await mkDeadline();
    const patch = (body: object) =>
      call('patch', `/compliance/deadlines/${d.id}`, people.ownerA, body);
    expectError(await patch({}), 400, 'VALIDATION_FAILED');
    expectError(await patch({ clientId: s.c2 }), 400, 'VALIDATION_FAILED');
    expectError(await patch({ status: 'COMPLETED' }), 400, 'VALIDATION_FAILED');
    await act(d.id, 'complete');
    expectError(await patch({ status: 'IN_PROGRESS' }), 409, 'DEADLINE_STATE');
    expect((await patch({ name: 'Notes can still change' })).status).toBe(200);
    await act(d.id, 'archive');
    expectError(await patch({ name: 'Archived' }), 409, 'DEADLINE_STATE');
  });

  it('does not let the due date pass the extended filing date', async () => {
    const d = await mkDeadline({ dueOn: plus(10) });
    await act(d.id, 'extension', { filedOn: plus(1), extendedDueOn: plus(20) });
    expectError(
      await call('patch', `/compliance/deadlines/${d.id}`, people.ownerA, { dueOn: plus(30) }),
      409,
      'DEADLINE_STATE',
    );
  });
});

describe('status actions', () => {
  it('starts, waits on the client, completes with evidence, reopens and marks not applicable', async () => {
    const d = await mkDeadline();
    const run = async (action: string, body?: object, who: Who = people.staffA) =>
      exact(ComplianceDeadline, await act(d.id, action, body, who));
    expect(await run('in-progress')).toMatchObject({
      status: 'IN_PROGRESS',
      displayStatus: 'IN_PROGRESS',
    });
    expect(await run('waiting-on-client')).toMatchObject({ status: 'WAITING_ON_CLIENT' });
    const done = await run('complete', { filedOn: plus(-1), confirmationNumber: 'FAKE-123' });
    expect(done).toMatchObject({
      status: 'COMPLETED',
      displayStatus: 'COMPLETED',
      filedOn: plus(-1),
      confirmationNumber: 'FAKE-123',
      completedBy: { userId: people.staffA.id },
    });
    expect(done.completedAt).not.toBeNull();
    expectError(await act(d.id, 'complete'), 409, 'DEADLINE_STATE');
    expectError(await act(d.id, 'in-progress'), 409, 'DEADLINE_STATE');
    const reopened = await run('reopen', undefined, people.ownerA);
    expect(reopened).toMatchObject({ status: 'UPCOMING', completedAt: null, completedBy: null });
    expectError(await act(d.id, 'reopen'), 409, 'DEADLINE_STATE');
    expectError(await act(d.id, 'not-applicable', {}), 400, 'VALIDATION_FAILED');
    const na = await run('not-applicable', { reason: 'Client dissolved' });
    expect(na).toMatchObject({ status: 'NOT_APPLICABLE', notApplicableReason: 'Client dissolved' });
    // The reason stays with the row, and the deadline can be reopened.
    expect((await run('reopen')).notApplicableReason).toBe('Client dissolved');
    expect(await auditActions(d.id)).toEqual([
      'compliance.deadline.created',
      'compliance.deadline.started',
      'compliance.deadline.waiting-on-client',
      'compliance.deadline.completed',
      'compliance.deadline.reopened',
      'compliance.deadline.not-applicable',
      'compliance.deadline.reopened',
    ]);
  });

  it('shows Overdue and Due Soon from the date, and completing never completes its tasks', async () => {
    const past = await mkDeadline({ dueOn: plus(-3) });
    expect(past).toMatchObject({ status: 'UPCOMING', displayStatus: 'OVERDUE', daysUntilDue: -3 });
    const soon = await mkDeadline({ dueOn: plus(3), createTask: true });
    expect(soon.displayStatus).toBe('DUE_SOON');
    await act(soon.id, 'complete');
    expect((await get(soon.id)).tasks[0]?.status).toBe('OPEN');
    // Completed or not applicable is never overdue.
    await act(past.id, 'complete');
    expect((await get(past.id)).displayStatus).toBe('COMPLETED');
  });

  it('files an extension without moving the payment date, and judges by the extended date', async () => {
    const d = await mkDeadline({ dueOn: plus(-5), paymentDueOn: plus(-5) });
    expect(d.displayStatus).toBe('OVERDUE');
    expectError(
      await act(d.id, 'extension', { filedOn: plus(-6), extendedDueOn: plus(-6) }),
      400,
      'VALIDATION_FAILED',
    );
    const ext = exact(
      ComplianceDeadline,
      await act(d.id, 'extension', { filedOn: plus(-6), extendedDueOn: plus(60) }),
    );
    expect(ext).toMatchObject({
      extensionFiledOn: plus(-6),
      extendedDueOn: plus(60),
      dueOn: plus(-5),
      paymentDueOn: plus(-5),
      displayStatus: 'UPCOMING',
      daysUntilDue: 60,
    });
    expect(await auditActions(d.id)).toContain('compliance.deadline.extension-filed');
    // A completed deadline takes no extension.
    await act(d.id, 'complete');
    expectError(
      await act(d.id, 'extension', { filedOn: plus(-1), extendedDueOn: plus(90) }),
      409,
      'DEADLINE_STATE',
    );
  });

  it('reassigns and unassigns, to active members only', async () => {
    const d = await mkDeadline();
    const re = (assignedUserId: string | null, who: Who = people.ownerA) =>
      act(d.id, 'reassign', { assignedUserId }, who);
    expect(exact(ComplianceDeadline, await re(people.adminA.id)).assignedTo?.userId).toBe(
      people.adminA.id,
    );
    expect(exact(ComplianceDeadline, await re(null)).assignedTo).toBeNull();
    expectError(await re(people.clientA.id), 409, 'NOT_A_MEMBER');
    expectError(await re(randomUUID()), 409, 'NOT_A_MEMBER');
    expectError(await re(people.staff2A.id), 409, 'CLIENT_NOT_ASSIGNED');
    expect(
      exact(ComplianceDeadline, await re(people.staffA.id, people.staffA)).assignedTo?.userId,
    ).toBe(people.staffA.id);
    expectError(await act(d.id, 'reassign', {}), 400, 'VALIDATION_FAILED');
    expect(await auditActions(d.id)).toContain('compliance.deadline.reassigned');
  });

  it('archives a deadline: it leaves the lists and takes no more changes', async () => {
    const d = await mkDeadline({ name: `Archive me ${run}` });
    const archived = exact(ComplianceDeadline, await act(d.id, 'archive'));
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).not.toBeNull();
    const q = `search=${encodeURIComponent(`Archive me ${run}`)}`;
    expect(
      exact(ComplianceDeadlinePage, await call('get', `/compliance/deadlines?${q}`, people.ownerA))
        .total,
    ).toBe(0);
    expect(
      exact(
        ComplianceDeadlinePage,
        await call('get', `/compliance/deadlines?tab=ARCHIVED&${q}`, people.ownerA),
      ).items.map((x) => x.id),
    ).toEqual([d.id]);
    for (const action of ['archive', 'in-progress', 'complete', 'reopen']) {
      expectError(await act(d.id, action), 409, 'DEADLINE_STATE');
    }
    expectError(await act(d.id, 'reassign', { assignedUserId: null }), 409, 'DEADLINE_STATE');
    expect((await act(randomUUID(), 'archive')).status).toBe(404);
  });

  it('is for the deadlines the caller reaches, in this firm', async () => {
    const d = await mkDeadline();
    expectError(await act(d.id, 'complete', undefined, people.staff2A), 404, 'NOT_FOUND');
    expectError(
      await call(
        'post',
        `/compliance/deadlines/${d.id}/complete`,
        people.ownerB,
        undefined,
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    expect((await get(d.id)).status).toBe('UPCOMING');
  });
});

describe('reminders, tasks, documents and related deadlines', () => {
  it('replaces the reminders', async () => {
    const d = await mkDeadline();
    const put = (reminders: object[], who: Who = people.staffA) =>
      call('put', `/compliance/deadlines/${d.id}/reminders`, who, { reminders });
    const saved = exact(
      ComplianceDeadline,
      await put([{ daysBefore: 14 }, { daysBefore: 0, inApp: false, channels: ['EMAIL', 'SMS'] }]),
    );
    expect(saved.reminders).toEqual([
      { daysBefore: 14, inApp: true, channels: [] },
      { daysBefore: 0, inApp: false, channels: ['EMAIL', 'SMS'] },
    ]);
    expect(exact(ComplianceDeadline, await put([])).reminders).toEqual([]);
    expectError(await put([{ daysBefore: 3 }, { daysBefore: 3 }]), 400, 'VALIDATION_FAILED');
    expectError(await put([{ daysBefore: 366 }]), 400, 'VALIDATION_FAILED');
    expectError(
      await put(Array.from({ length: 11 }, (_, i) => ({ daysBefore: i }))),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await put([], people.staff2A), 404, 'NOT_FOUND');
    expect(await auditActions(d.id)).toContain('compliance.deadline.reminders-saved');
  });

  it("links and unlinks the client's own tasks", async () => {
    const d = await mkDeadline();
    const link = (taskId: string, id = d.id) =>
      call('post', `/compliance/deadlines/${id}/tasks/link`, people.ownerA, { taskId });
    const linked = exact(ComplianceDeadline, await link(s.task1));
    expect(linked.tasks.map((t) => t.id)).toEqual([s.task1]);
    expect(exact(ComplianceDeadline, await link(s.task1)).tasks).toHaveLength(1);
    // Another client's task, another firm's task, a task of another deadline.
    expectError(await link(s.task2), 409, 'NOT_THIS_CLIENTS');
    expectError(await link(randomUUID()), 409, 'NOT_THIS_CLIENTS');
    const other = await mkDeadline();
    expectError(await link(s.task1, other.id), 409, 'DUPLICATE');
    const unlinked = exact(
      ComplianceDeadline,
      await call('delete', `/compliance/deadlines/${d.id}/tasks/${s.task1}`, people.ownerA),
    );
    expect(unlinked.tasks).toEqual([]);
    expectError(
      await call('delete', `/compliance/deadlines/${d.id}/tasks/${s.task1}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    // The task itself stays.
    expect(await asOwner(ids.firmA, (tx) => tx.task.count({ where: { id: s.task1 } }))).toBe(1);
    expect(await auditActions(d.id)).toEqual(
      expect.arrayContaining([
        'compliance.deadline.task-linked',
        'compliance.deadline.task-unlinked',
      ]),
    );
  });

  it("attaches and detaches the client's own documents", async () => {
    const d = await mkDeadline();
    const add = (documentId: string) =>
      call('post', `/compliance/deadlines/${d.id}/documents`, people.staffA, { documentId });
    const withDoc = exact(ComplianceDeadline, await add(s.doc1));
    expect(withDoc.documents).toEqual([
      { documentId: s.doc1, fileName: 'fake.pdf', addedAt: expect.any(String) },
    ]);
    expect(exact(ComplianceDeadline, await add(s.doc1)).documents).toHaveLength(1);
    expectError(await add(s.doc2), 409, 'NOT_THIS_CLIENTS');
    expectError(await add(randomUUID()), 409, 'NOT_THIS_CLIENTS');
    expect(
      exact(
        ComplianceDeadline,
        await call('delete', `/compliance/deadlines/${d.id}/documents/${s.doc1}`, people.staffA),
      ).documents,
    ).toEqual([]);
    expectError(
      await call('delete', `/compliance/deadlines/${d.id}/documents/${s.doc1}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    // The file itself stays.
    expect(await asOwner(ids.firmA, (tx) => tx.document.count({ where: { id: s.doc1 } }))).toBe(1);
  });

  it("relates deadlines of the same client, both ways, and never another client's", async () => {
    const a = await mkDeadline();
    const b = await mkDeadline();
    const other = await mkDeadline({ clientId: s.c2 });
    const link = (relatedDeadlineId: string, id = a.id) =>
      call('post', `/compliance/deadlines/${id}/links`, people.ownerA, { relatedDeadlineId });
    expect(exact(ComplianceDeadline, await link(b.id)).relatedDeadlines.map((r) => r.id)).toEqual([
      b.id,
    ]);
    expect(exact(ComplianceDeadline, await link(b.id)).relatedDeadlines).toHaveLength(1);
    // The other side sees it, and linking back adds nothing.
    expect((await get(b.id)).relatedDeadlines.map((r) => r.id)).toEqual([a.id]);
    expect(exact(ComplianceDeadline, await link(a.id, b.id)).relatedDeadlines).toHaveLength(1);
    expectError(await link(other.id), 409, 'NOT_THIS_CLIENTS');
    expectError(await link(a.id), 400, 'VALIDATION_FAILED');
    expectError(await link(randomUUID()), 404, 'NOT_FOUND');
    expectError(await link(b.id, other.id), 409, 'NOT_THIS_CLIENTS');
    // Removed from either side.
    expect(
      exact(
        ComplianceDeadline,
        await call('delete', `/compliance/deadlines/${b.id}/links/${a.id}`, people.ownerA),
      ).relatedDeadlines,
    ).toEqual([]);
    expectError(
      await call('delete', `/compliance/deadlines/${a.id}/links/${b.id}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
  });

  it('saves a deadline as a template that makes no deadlines, for Owner and Admin', async () => {
    const d = await mkDeadline({
      type: 'PAYROLL',
      agency: 'IRS',
      relatedForm: '941',
      dueOn: '2031-04-30',
    });
    const tpl = exact(
      ComplianceRecurrence,
      await call('post', `/compliance/deadlines/${d.id}/save-as-template`, people.ownerA, {
        name: `Template ${run}`,
      }),
      201,
    );
    expect(tpl).toMatchObject({
      isTemplate: true,
      type: 'PAYROLL',
      agency: 'IRS',
      relatedForm: '941',
      frequency: 'ANNUAL',
      repeatRule: { month: 4, day: 30 },
      startOn: null,
      nextDueOn: null,
      deadlineCount: 0,
    });
    expectError(
      await call('post', `/compliance/deadlines/${d.id}/save-as-template`, people.adminA, {
        name: `Template ${run}`,
      }),
      409,
      'DUPLICATE',
    );
    expectError(
      await call('post', `/compliance/deadlines/${d.id}/save-as-template`, people.staffA, {
        name: 'X',
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/compliance/deadlines/${d.id}/save-as-template`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('bulk actions', () => {
  it('changes many, and skips the ones that cannot change with the reason', async () => {
    const [a, b, c] = [await mkDeadline(), await mkDeadline(), await mkDeadline()];
    await act(c.id, 'complete');
    const bulk = (body: object, who: Who = people.ownerA) =>
      call('post', '/compliance/deadlines/bulk', who, body);
    const re = exact(
      BulkDeadlinesResult,
      await bulk({ ids: [a.id, b.id, a.id], action: 'REASSIGN', assignedUserId: people.adminA.id }),
    );
    expect(re.updated.sort()).toEqual([a.id, b.id].sort());
    expect((await get(a.id)).assignedTo?.userId).toBe(people.adminA.id);
    const st = exact(
      BulkDeadlinesResult,
      await bulk({ ids: [a.id, c.id], action: 'STATUS', status: 'IN_PROGRESS' }),
    );
    expect(st.updated).toEqual([a.id]);
    expect(st.skipped).toEqual([{ id: c.id, reason: expect.stringContaining('completed') }]);
    const done = exact(
      BulkDeadlinesResult,
      await bulk({ ids: [b.id], action: 'STATUS', status: 'COMPLETED' }),
    );
    expect(done.updated).toEqual([b.id]);
    expect((await get(b.id)).status).toBe('COMPLETED');
    const na = exact(
      BulkDeadlinesResult,
      await bulk({ ids: [a.id], action: 'STATUS', status: 'NOT_APPLICABLE', reason: 'Closed' }),
    );
    expect(na.updated).toEqual([a.id]);
    expect((await get(a.id)).notApplicableReason).toBe('Closed');
    const arch = exact(
      BulkDeadlinesResult,
      await bulk({ ids: [a.id, b.id, c.id], action: 'ARCHIVE' }),
    );
    expect(arch.updated.sort()).toEqual([a.id, b.id, c.id].sort());
    expect(
      exact(BulkDeadlinesResult, await bulk({ ids: [a.id], action: 'ARCHIVE' })).skipped,
    ).toHaveLength(1);
    expect(await auditActions(a.id)).toContain('compliance.deadline.archived');
    expect(
      (
        await asOwner(ids.firmA, (tx) =>
          tx.auditLog.findMany({ where: { action: 'compliance.deadlines.bulk' } }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('refuses the whole request for a deadline the caller does not reach or an assignee who is not a member', async () => {
    const a = await mkDeadline();
    const b = await mkDeadline({ clientId: s.c2 });
    const bulk = (body: object, who: Who = people.ownerA) =>
      call('post', '/compliance/deadlines/bulk', who, body);
    expectError(await bulk({ ids: [a.id, randomUUID()], action: 'ARCHIVE' }), 404, 'NOT_FOUND');
    expectError(
      await bulk({ ids: [a.id, b.id], action: 'ARCHIVE' }, people.staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await bulk({ ids: [a.id, b.id], action: 'ARCHIVE' }, people.staff2A),
      404,
      'NOT_FOUND',
    );
    expectError(
      await bulk({ ids: [a.id], action: 'REASSIGN', assignedUserId: people.clientA.id }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(await bulk({ ids: [a.id], action: 'STATUS' }), 400, 'VALIDATION_FAILED');
    expectError(
      await bulk({ ids: [a.id], action: 'STATUS', status: 'NOT_APPLICABLE' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await bulk({ ids: [a.id], action: 'REASSIGN' }), 400, 'VALIDATION_FAILED');
    expectError(await bulk({ ids: [], action: 'ARCHIVE' }), 400, 'VALIDATION_FAILED');
    expectError(
      await bulk({ ids: Array.from({ length: 101 }, () => randomUUID()), action: 'ARCHIVE' }),
      400,
      'VALIDATION_FAILED',
    );
    expect((await get(a.id)).archived).toBe(false);
    // A Staff member's own client works.
    expect(
      exact(BulkDeadlinesResult, await bulk({ ids: [a.id], action: 'ARCHIVE' }, people.staffA))
        .updated,
    ).toEqual([a.id]);
  });
});

describe('the overview, lists, calendar and exports', () => {
  const k: Record<string, string> = {};
  const dl: Record<string, string> = {};

  beforeAll(async () => {
    await asOwner(ids.firmC, async (tx) => {
      const businessId = ids.firmC;
      const mk = async (displayName: string, archived = false) =>
        (
          await tx.client.create({
            data: {
              businessId,
              displayName,
              accountType: 'BUSINESS',
              ...(archived ? { archivedAt: new Date() } : {}),
            },
          })
        ).id;
      k.alpha = await mk('Alpha LLC');
      k.beta = await mk('Beta Co');
      k.gamma = await mk('Gamma Inc');
      k.gone = await mk('Gone Ltd', true);
      const make = async (
        key: string,
        clientId: string,
        title: string,
        due: number,
        over: Record<string, unknown> = {},
      ) => {
        dl[key] = (
          await tx.complianceDeadline.create({
            data: {
              businessId,
              clientId,
              name: title,
              type: 'TAX_FILING',
              dueOn: at(due),
              agency: 'IRS',
              ...over,
            },
          })
        ).id;
      };
      await make('d1', k.alpha!, 'Overdue return', -5);
      await make('d2', k.alpha!, 'Estimate', 3, {
        type: 'ESTIMATED_TAX',
        priority: 'HIGH',
        assignedUserId: people.ownerA.id,
      });
      await make('d3', k.beta!, 'Monthly books', 60, { type: 'BOOKKEEPING', agency: 'Internal' });
      await make('d4', k.beta!, 'Payroll filing', -1, { type: 'PAYROLL', status: 'IN_PROGRESS' });
      await make('d5', k.gamma!, 'Filed return', -10, {
        status: 'COMPLETED',
        completedAt: new Date(),
      });
      await make('d6', k.gamma!, 'Sales tax', 5, {
        type: 'SALES_TAX',
        priority: 'HIGH',
        agency: 'GA DOR',
      });
      await make('d7', k.gamma!, 'Not needed', 2, {
        status: 'NOT_APPLICABLE',
        notApplicableReason: 'Fake reason',
      });
      await make('d8', k.alpha!, 'Archived thing', 1, { archivedAt: new Date() });
      await make('d9', k.alpha!, 'Extended return', -20, {
        extensionFiledOn: at(-25),
        extendedDueOn: at(30),
      });
      await make('d10', k.gone!, 'Gone client deadline', -5);
      await tx.complianceRecurrence.create({
        data: {
          businessId,
          name: 'Active recurrence',
          type: 'PAYROLL',
          frequency: 'MONTHLY',
          repeatRule: { dayOfMonth: 15 },
          startOn: at(-100),
        },
      });
      await tx.complianceRecurrence.create({
        data: {
          businessId,
          name: 'A template',
          type: 'PAYROLL',
          frequency: 'MONTHLY',
          repeatRule: { dayOfMonth: 1 },
          isTemplate: true,
        },
      });
      const cal = (authority: string, verifiedDaysAgo: number) =>
        tx.complianceCalendar.create({
          data: {
            businessId,
            family: 'IRS_GENERAL',
            authority,
            jurisdiction: 'FEDERAL',
            effectiveYear: 2031,
            name: authority,
            sourceUrl: 'https://example.test/c',
            status: 'PUBLISHED',
            verifiedAt: new Date(Date.now() - verifiedDaysAgo * DAY),
            publishedAt: new Date(),
          },
        });
      await cal('Stale authority', 200);
      await cal('Fresh authority', 5);
    });
    await asOwner(ids.firmD, async (tx) => {
      const businessId = ids.firmD;
      const evil = (
        await tx.client.create({
          data: { businessId, displayName: '=SUM(A1)', accountType: 'BUSINESS' },
        })
      ).id;
      const mk = (title: string, dueOn: string, over: Record<string, unknown> = {}) =>
        tx.complianceDeadline.create({
          data: {
            businessId,
            clientId: evil,
            name: title,
            type: 'TAX_FILING',
            dueOn: new Date(`${dueOn}T00:00:00.000Z`),
            ...over,
          },
        });
      await mk('Quarterly', '2031-03-10');
      await mk('Filed', '2031-03-10', { status: 'COMPLETED', completedAt: new Date() });
      await mk('Skip', '2031-03-20', { status: 'NOT_APPLICABLE', notApplicableReason: 'Fake' });
      await mk('Edge of month', '2031-03-31');
      await mk('Next month', '2031-04-01');
      await mk('Last month', '2031-02-28');
    });
  });

  const list = async (query: string, firm = ids.firmC, who: Who = people.ownerA) =>
    exact(
      ComplianceDeadlinePage,
      await call('get', `/compliance/deadlines${query}`, who, undefined, firm),
    );
  const names = (page: { items: { name: string }[] }) => page.items.map((i) => i.name);

  it('shows the Overview figures from live data', async () => {
    const sum = exact(
      ComplianceSummary,
      await call('get', '/compliance/deadlines/summary', people.ownerA, undefined, ids.firmC),
    );
    expect(sum.today).toBe(plus(0));
    expect(sum.kpis).toEqual({
      total: { value: 7, previous: 0, changePercent: null },
      next30Days: 3,
      overdue: 2,
      completedThisMonth: { value: 1, previous: 0, changePercent: null },
      recurring: 1,
      clientsAtRisk: 3,
    });
    expect(sum.types).toEqual([
      { type: 'TAX_FILING', count: 3, percent: 42.9 },
      { type: 'BOOKKEEPING', count: 1, percent: 14.3 },
      { type: 'ESTIMATED_TAX', count: 1, percent: 14.3 },
      { type: 'PAYROLL', count: 1, percent: 14.3 },
      { type: 'SALES_TAX', count: 1, percent: 14.3 },
    ]);
    expect(
      sum.atRiskClients.map((c) => [
        c.client.displayName,
        c.overdueCount,
        c.highPriorityUpcomingCount,
      ]),
    ).toEqual([
      ['Alpha LLC', 1, 1],
      ['Beta Co', 1, 0],
      ['Gamma Inc', 0, 1],
    ]);
    expect(sum.staleCalendars).toBe(1);
  });

  it('shows empty lists and zeros for a firm with no data, never invented numbers', async () => {
    const sum = exact(
      ComplianceSummary,
      await call('get', '/compliance/deadlines/summary', people.ownerB, undefined, ids.firmB),
    );
    expect(sum.kpis).toEqual({
      total: { value: 0, previous: 0, changePercent: null },
      next30Days: 0,
      overdue: 0,
      completedThisMonth: { value: 0, previous: 0, changePercent: null },
      recurring: 0,
      clientsAtRisk: 0,
    });
    expect(sum).toMatchObject({ types: [], atRiskClients: [], staleCalendars: 0 });
    expect(await list('', ids.firmB, people.ownerB)).toMatchObject({ items: [], total: 0 });
    expect(
      exact(
        ComplianceByClientPage,
        await call('get', '/compliance/deadlines/by-client', people.ownerB, undefined, ids.firmB),
      ),
    ).toMatchObject({ items: [], total: 0 });
    expect(
      exact(
        ComplianceAtRiskList,
        await call('get', '/compliance/deadlines/at-risk', people.ownerB, undefined, ids.firmB),
      ).items,
    ).toEqual([]);
    expect(
      exact(
        ComplianceCalendarMonth,
        await call('get', '/compliance/deadlines/calendar', people.ownerB, undefined, ids.firmB),
      ),
    ).toMatchObject({ days: [], truncated: false });
  });

  it("keeps the firm's deadlines out of the other firms' figures", async () => {
    const a = exact(
      ComplianceSummary,
      await call('get', '/compliance/deadlines/summary', people.ownerA),
    );
    expect(a.kpis.total.value).toBeGreaterThan(0);
    // Firm C's seven deadlines never reach firm A.
    expect(names(await list('?pageSize=100', ids.firmA))).not.toContain('Overdue return');
  });

  it('lists with the status filters Overdue, Due Soon and Upcoming, derived from the date', async () => {
    expect(names(await list('?status=OVERDUE'))).toEqual(['Overdue return', 'Payroll filing']);
    expect(names(await list('?status=DUE_SOON'))).toEqual(['Estimate', 'Sales tax']);
    expect(names(await list('?status=UPCOMING'))).toEqual(['Extended return', 'Monthly books']);
    expect((await list('?status=IN_PROGRESS')).total).toBe(0);
    expect(names(await list('?status=COMPLETED'))).toEqual(['Filed return']);
    expect(names(await list('?status=NOT_APPLICABLE'))).toEqual(['Not needed']);
    // The row shows the derived status.
    const rows = (await list('?pageSize=100')).items;
    expect(Object.fromEntries(rows.map((r) => [r.name, r.displayStatus]))).toEqual({
      'Overdue return': 'OVERDUE',
      Estimate: 'DUE_SOON',
      'Monthly books': 'UPCOMING',
      'Payroll filing': 'OVERDUE',
      'Filed return': 'COMPLETED',
      'Sales tax': 'DUE_SOON',
      'Not needed': 'NOT_APPLICABLE',
      'Extended return': 'UPCOMING',
    });
  });

  it('filters by tab, date range, type, client, assignee, agency, mine and search', async () => {
    expect((await list('')).total).toBe(8);
    expect(names(await list('?tab=ARCHIVED'))).toEqual(['Archived thing']);
    expect((await list('?tab=RECURRING')).total).toBe(0);
    expect(names(await list('?tab=COMPLETED'))).toEqual(['Filed return']);
    expect(names(await list('?range=NEXT_7_DAYS'))).toEqual([
      'Not needed',
      'Estimate',
      'Sales tax',
    ]);
    expect(names(await list(`?from=${plus(-6)}&to=${plus(0)}`))).toEqual([
      'Overdue return',
      'Payroll filing',
    ]);
    expect(names(await list(`?from=${plus(10)}`))).toEqual(['Monthly books']);
    expect(names(await list('?type=PAYROLL'))).toEqual(['Payroll filing']);
    expect(names(await list(`?clientId=${k.alpha}`))).toEqual([
      'Extended return',
      'Overdue return',
      'Estimate',
    ]);
    expect(names(await list('?agency=irs')).sort()).toEqual([
      'Estimate',
      'Extended return',
      'Filed return',
      'Not needed',
      'Overdue return',
      'Payroll filing',
    ]);
    expect(names(await list('?agency=ga%20dor'))).toEqual(['Sales tax']);
    expect(names(await list('?mine=true'))).toEqual(['Estimate']);
    expect(names(await list(`?assignedUserId=${people.ownerA.id}`))).toEqual(['Estimate']);
    expect(names(await list('?search=return')).sort()).toEqual([
      'Extended return',
      'Filed return',
      'Overdue return',
    ]);
    expect(names(await list('?search=beta')).sort()).toEqual(['Monthly books', 'Payroll filing']);
    expect((await list('?search=nothing-matches')).total).toBe(0);
  });

  it('sorts and pages', async () => {
    expect(names(await list('?pageSize=100'))).toEqual([
      'Extended return',
      'Filed return',
      'Overdue return',
      'Payroll filing',
      'Not needed',
      'Estimate',
      'Sales tax',
      'Monthly books',
    ]);
    const p2 = await list('?sort=name&pageSize=3&page=2');
    expect(names(p2)).toEqual(['Monthly books', 'Not needed', 'Overdue return']);
    expect(p2).toMatchObject({ total: 8, page: 2, pageSize: 3 });
    expect(names(await list('?sort=name&direction=desc&pageSize=2'))).toEqual([
      'Sales tax',
      'Payroll filing',
    ]);
    expect((await list('?sort=client&pageSize=100')).items[0]?.client.displayName).toBe(
      'Alpha LLC',
    );
    expect((await list('?sort=priority&direction=desc&pageSize=1')).items[0]?.priority).toBe(
      'HIGH',
    );
    expect((await list('?sort=type&pageSize=1')).total).toBe(8);
    expect((await list('?sort=agency&pageSize=1')).total).toBe(8);
    expect((await list('?sort=status&pageSize=1')).total).toBe(8);
    expect((await list('?page=99')).items).toEqual([]);
  });

  it('refuses bad queries', async () => {
    for (const q of [
      '?page=0',
      '?pageSize=101',
      '?sort=nope',
      '?status=NOPE',
      '?range=NOPE',
      '?from=2031-13-01',
      `?from=${plus(5)}&to=${plus(1)}`,
      '?mine=maybe',
      '?clientId=x',
      '?unknown=1',
    ]) {
      expectError(
        await call('get', `/compliance/deadlines${q}`, people.ownerA, undefined, ids.firmC),
        400,
        'VALIDATION_FAILED',
      );
    }
  });

  it('limits a Staff member to the deadlines of clients assigned to them', async () => {
    const own = await mkDeadline();
    const other = await mkDeadline({ clientId: s.c2 });
    const staff = await list('?pageSize=100', ids.firmA, people.staffA);
    expect(staff.items.map((i) => i.id)).toContain(own.id);
    expect(staff.items.map((i) => i.id)).not.toContain(other.id);
    expect(staff.items.every((i) => i.client.id === s.c1)).toBe(true);
    const none = await list('?pageSize=100', ids.firmA, people.staff2A);
    expect(none.total).toBe(0);
    const all = await list('?pageSize=100&clientId=' + s.c2, ids.firmA, people.ownerA);
    expect(all.items.map((i) => i.id)).toContain(other.id);
    // The Overview, the By Client tab and the calendar follow the same limit.
    const sum = exact(
      ComplianceSummary,
      await call('get', '/compliance/deadlines/summary', people.staff2A),
    );
    expect(sum.kpis.total.value).toBe(0);
    const by = exact(
      ComplianceByClientPage,
      await call('get', '/compliance/deadlines/by-client?pageSize=100', people.staffA),
    );
    expect(by.items.map((i) => i.client.id)).toEqual([s.c1]);
  });

  it('shows the By Client tab and the At Risk panel', async () => {
    const by = exact(
      ComplianceByClientPage,
      await call('get', '/compliance/deadlines/by-client', people.ownerA, undefined, ids.firmC),
    );
    expect(
      by.items.map((c) => [
        c.client.displayName,
        c.total,
        c.open,
        c.overdue,
        c.dueSoon,
        c.completed,
        c.nextDueOn,
        c.atRisk,
      ]),
    ).toEqual([
      ['Alpha LLC', 3, 3, 1, 1, 0, plus(3), true],
      ['Beta Co', 2, 2, 1, 0, 0, plus(60), true],
      ['Gamma Inc', 2, 1, 0, 1, 1, plus(5), true],
    ]);
    const g = exact(
      ComplianceByClientPage,
      await call(
        'get',
        '/compliance/deadlines/by-client?search=gamm',
        people.ownerA,
        undefined,
        ids.firmC,
      ),
    );
    expect(g.total).toBe(1);
    const paged = exact(
      ComplianceByClientPage,
      await call(
        'get',
        '/compliance/deadlines/by-client?pageSize=1&page=2',
        people.ownerA,
        undefined,
        ids.firmC,
      ),
    );
    expect(paged.items.map((c) => c.client.displayName)).toEqual(['Beta Co']);
    expect(
      exact(
        ComplianceByClientPage,
        await call(
          'get',
          '/compliance/deadlines/by-client?atRisk=true',
          people.ownerA,
          undefined,
          ids.firmC,
        ),
      ).total,
    ).toBe(3);
    const risk = exact(
      ComplianceAtRiskList,
      await call('get', '/compliance/deadlines/at-risk', people.ownerA, undefined, ids.firmC),
    );
    expect(
      risk.items.map((c) => [
        c.client.displayName,
        c.overdueCount,
        c.highPriorityUpcomingCount,
        c.waitingOnClientCount,
      ]),
    ).toEqual([
      ['Alpha LLC', 1, 1, 0],
      ['Beta Co', 1, 0, 0],
      ['Gamma Inc', 0, 1, 0],
    ]);
    expectError(
      await call(
        'get',
        '/compliance/deadlines/by-client?pageSize=0',
        people.ownerA,
        undefined,
        ids.firmC,
      ),
      400,
      'VALIDATION_FAILED',
    );
  });

  it("follows the firm's Due Soon threshold", async () => {
    const patch = (dueSoonDays: number) =>
      call('patch', '/compliance/settings', people.ownerA, { dueSoonDays }, ids.firmC);
    expect((await patch(2)).status).toBe(200);
    expect((await list('?status=DUE_SOON')).total).toBe(0);
    expect(names(await list('?status=UPCOMING')).sort()).toEqual([
      'Estimate',
      'Extended return',
      'Monthly books',
      'Sales tax',
    ]);
    expect((await patch(14)).status).toBe(200);
    expect(names(await list('?status=DUE_SOON'))).toEqual(['Estimate', 'Sales tax']);
  });

  it('shows a month with the legend counts, leaving out what is not an obligation', async () => {
    const m = exact(
      ComplianceCalendarMonth,
      await call(
        'get',
        '/compliance/deadlines/calendar?month=2031-03',
        people.ownerA,
        undefined,
        ids.firmD,
      ),
    );
    expect(m.month).toBe('2031-03');
    expect(m.truncated).toBe(false);
    expect(m.days.map((d) => d.date)).toEqual(['2031-03-10', '2031-03-31']);
    expect(m.days[0]).toMatchObject({
      counts: { upcoming: 1, overdue: 0, dueSoon: 0, completed: 1 },
      deadlines: [
        { name: 'Filed', displayStatus: 'COMPLETED', clientName: '=SUM(A1)' },
        { name: 'Quarterly', displayStatus: 'UPCOMING' },
      ],
    });
    const current = exact(
      ComplianceCalendarMonth,
      await call('get', '/compliance/deadlines/calendar', people.ownerA, undefined, ids.firmC),
    );
    expect(current.month).toBe(plus(0).slice(0, 7));
    const filtered = exact(
      ComplianceCalendarMonth,
      await call(
        'get',
        '/compliance/deadlines/calendar?month=2031-03&type=PAYROLL',
        people.ownerA,
        undefined,
        ids.firmD,
      ),
    );
    expect(filtered.days).toEqual([]);
    for (const q of ['?month=2031-13', '?month=2031-3', '?month=next', '?type=NOPE']) {
      expectError(
        await call(
          'get',
          `/compliance/deadlines/calendar${q}`,
          people.ownerA,
          undefined,
          ids.firmD,
        ),
        400,
        'VALIDATION_FAILED',
      );
    }
  });

  it('exports the filtered list as a CSV a spreadsheet cannot run, and audits it', async () => {
    const res = await call(
      'get',
      `/compliance/deadlines/export?from=2031-03-01&to=2031-03-31&sort=name`,
      people.ownerA,
      undefined,
      ids.firmD,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('compliance-deadlines.csv');
    expect(res.headers['cache-control']).toBe('no-store');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Due date,Deadline,Client,Type,Agency,Form,Tax year,State,Status,Priority,Assigned to',
    );
    expect(lines).toHaveLength(1 + 4);
    expect(lines.slice(1).every((l) => l.includes("'=SUM(A1)"))).toBe(true);
    expect(res.text).not.toMatch(/,=SUM/);
    expect(
      (
        await asOwner(ids.firmD, (tx) =>
          tx.auditLog.findMany({ where: { action: 'compliance.deadlines.exported' } }),
        )
      ).length,
    ).toBe(1);
    expect(
      (await call('get', '/compliance/deadlines/export?from=2031-03-01', people.staffA)).status,
    ).toBe(200);
    expect((await call('get', '/compliance/deadlines/export', people.clientA)).status).toBe(403);
  });

  it("shows a client's compliance view", async () => {
    const view = exact(
      ClientCompliance,
      await call('get', `/clients/${k.alpha}/compliance`, people.ownerA, undefined, ids.firmC),
    );
    expect(view).toMatchObject({
      client: { displayName: 'Alpha LLC' },
      totals: { open: 3, overdue: 1, dueSoon: 1, completed: 0 },
      atRisk: { overdueCount: 1, highPriorityUpcomingCount: 1 },
      suggestions: 0,
    });
    expect(view.deadlines.map((d) => d.name)).toEqual([
      'Extended return',
      'Overdue return',
      'Estimate',
    ]);
    const gamma = exact(
      ClientCompliance,
      await call('get', `/clients/${k.gamma}/compliance`, people.ownerA, undefined, ids.firmC),
    );
    expect(gamma.deadlines.map((d) => d.name)).toEqual(['Sales tax']);
    const closed = exact(
      ClientCompliance,
      await call(
        'get',
        `/clients/${k.gamma}/compliance?includeClosed=true`,
        people.ownerA,
        undefined,
        ids.firmC,
      ),
    );
    expect(closed.deadlines.map((d) => d.name).sort()).toEqual([
      'Filed return',
      'Not needed',
      'Sales tax',
    ]);
    expect(closed.totals).toEqual({ open: 1, overdue: 0, dueSoon: 1, completed: 1 });
    // Not another firm's client, not a Staff member's unassigned client.
    expectError(
      await call('get', `/clients/${k.alpha}/compliance`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    expectError(await call('get', `/clients/${s.c2}/compliance`, people.staffA), 404, 'NOT_FOUND');
    expect((await call('get', `/clients/${s.c1}/compliance`, people.staffA)).status).toBe(200);
    expectError(
      await call('get', `/clients/${randomUUID()}/compliance`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'get',
        `/clients/${k.alpha}/compliance?includeClosed=maybe`,
        people.ownerA,
        undefined,
        ids.firmC,
      ),
      400,
      'VALIDATION_FAILED',
    );
    expect(await auditActions(k.alpha!, ids.firmC)).toContain('compliance.client.viewed');
  });
});

describe('the calendar library', () => {
  const authority = `Fake IRS ${run}`;
  const cal = (path = '', who: Who = people.ownerA, firm = ids.firmA) =>
    call('get', `/compliance/calendars${path}`, who, undefined, firm);
  const post = (path: string, body?: object, who: Who = people.ownerA, firm = ids.firmA) =>
    call('post', `/compliance/calendars${path}`, who, body ?? {}, firm);
  const entries = {
    form1040: {
      ruleKind: 'FIXED_DATE',
      name: 'Form 1040',
      type: 'TAX_FILING',
      dueOn: '2031-04-15',
      form: '1040',
    },
    form1065: {
      ruleKind: 'FORMULA',
      name: 'Form 1065',
      type: 'TAX_FILING',
      rule: { monthsAfterYearEnd: 3, day: 15 },
      form: '1065',
    },
    form2553: { ruleKind: 'NEEDS_VERIFICATION', name: 'Form 2553', type: 'ELECTION', form: '2553' },
  };
  let v1: ComplianceCalendar;
  let v2: ComplianceCalendar;
  let entry1040: string;

  it('imports a DRAFT version with fixed dates, formulas and unknown dates, and logs it', async () => {
    v1 = await mkCalendar({
      authority,
      entries: [entries.form2553, entries.form1065, entries.form1040],
      retrievedAt: '2031-01-02T10:00:00.000Z',
    });
    expect(v1).toMatchObject({
      family: 'IRS_GENERAL',
      authority,
      jurisdiction: 'FEDERAL',
      state: null,
      effectiveYear: 2031,
      version: 1,
      status: 'DRAFT',
      verifiedAt: null,
      publishedAt: null,
      retrievedAt: '2031-01-02T10:00:00.000Z',
      entryCount: 3,
      needsVerificationCount: 1,
      stale: false,
    });
    expect(v1.entries.map((e) => e.name)).toEqual(['Form 1040', 'Form 1065', 'Form 2553']);
    expect(v1.entries[1]).toMatchObject({
      ruleKind: 'FORMULA',
      dueOn: null,
      rule: { monthsAfterYearEnd: 3, day: 15 },
    });
    expect(v1.entries[2]).toMatchObject({
      ruleKind: 'NEEDS_VERIFICATION',
      dueOn: null,
      rule: null,
    });
    entry1040 = v1.entries[0]!.id;
    expect(await auditActions(v1.id)).toEqual(['compliance.calendar.imported']);
    const logs = exact(
      ComplianceLogPage,
      await call('get', `/compliance/logs?kind=IMPORT&calendarId=${v1.id}`, people.staffA),
    );
    expect(logs.items).toHaveLength(1);
    expect(logs.items[0]).toMatchObject({
      kind: 'IMPORT',
      outcome: 'SUCCESS',
      calendarId: v1.id,
      details: { entries: 3, version: 1 },
      actor: { userId: people.ownerA.id },
    });
  });

  it('refuses an import that is not valid, and never takes an unverified date for a date', async () => {
    const body = {
      family: 'IRS_GENERAL',
      authority,
      jurisdiction: 'FEDERAL',
      effectiveYear: 2031,
      name: 'X',
      sourceUrl: 'https://www.irs.gov/x',
      entries: [],
    };
    for (const over of [
      { sourceUrl: 'http://www.irs.gov/x' },
      { sourceUrl: 'https://' },
      { jurisdiction: 'FEDERAL', state: 'GA' },
      { effectiveYear: 1999 },
      { family: 'NOPE' },
      { name: '' },
      { entries: [{ ruleKind: 'FIXED_DATE', name: 'A', type: 'TAX_FILING' }] },
      {
        entries: [
          {
            ruleKind: 'FORMULA',
            name: 'A',
            type: 'TAX_FILING',
            rule: { monthsAfterYearEnd: 13, day: 1 },
          },
        ],
      },
      {
        entries: [
          { ruleKind: 'NEEDS_VERIFICATION', name: 'A', type: 'TAX_FILING', dueOn: '2031-01-01' },
        ],
      },
      { entries: [entries.form1040, entries.form1040] },
      { unknown: true },
    ]) {
      expectError(await post('', { ...body, ...over }), 400, 'VALIDATION_FAILED');
      expectError(await post('/import-preview', { ...body, ...over }), 400, 'VALIDATION_FAILED');
    }
  });

  it('will not verify a version with an unknown date or with no entries', async () => {
    expectError(await post(`/${v1.id}/verify`), 409, 'ENTRIES_NEED_VERIFICATION');
    const empty = await mkCalendar({ authority: `${authority} empty`, entries: [] });
    expect(empty.entryCount).toBe(0);
    expectError(await post(`/${empty.id}/verify`), 409, 'NO_ENTRIES');
  });

  it('edits a draft: its details and its entries', async () => {
    const patch = (body: object, who: Who = people.ownerA) =>
      call('patch', `/compliance/calendars/${v1.id}`, who, body);
    const saved = exact(
      ComplianceCalendar,
      await patch({
        name: 'Renamed calendar',
        sourceUrl: 'https://www.irs.gov/p15',
        retrievedAt: '2031-02-01T00:00:00.000Z',
      }),
    );
    expect(saved).toMatchObject({
      name: 'Renamed calendar',
      sourceUrl: 'https://www.irs.gov/p15',
      retrievedAt: '2031-02-01T00:00:00.000Z',
    });
    expectError(await patch({}), 400, 'VALIDATION_FAILED');
    expectError(await patch({ sourceUrl: 'http://x' }), 400, 'VALIDATION_FAILED');
    expectError(await patch({ authority: 'Nope' }), 400, 'VALIDATION_FAILED');
    const add = (body: object) =>
      call('post', `/compliance/calendars/${v1.id}/entries`, people.ownerA, body);
    const extra = await add({
      ruleKind: 'FIXED_DATE',
      name: 'Extra',
      type: 'ADVISORY',
      dueOn: '2031-08-01',
    });
    expect(extra.status).toBe(201);
    expectError(
      await add({ ruleKind: 'FIXED_DATE', name: 'Extra', type: 'ADVISORY', dueOn: '2031-08-01' }),
      409,
      'DUPLICATE',
    );
    expectError(
      await add({ ruleKind: 'FIXED_DATE', name: 'No date', type: 'ADVISORY' }),
      400,
      'VALIDATION_FAILED',
    );
    const entryId = (extra.body as { id: string }).id;
    const upd = (id: string, body: object) =>
      call('patch', `/compliance/calendars/${v1.id}/entries/${id}`, people.ownerA, body);
    expect((await upd(entryId, { name: 'Extra renamed', description: 'Fake' })).status).toBe(200);
    expectError(await upd(entryId, { ruleKind: 'FORMULA' }), 400, 'VALIDATION_FAILED');
    expectError(await upd(entryId, { dueOn: null }), 400, 'VALIDATION_FAILED');
    expectError(await upd(entryId, {}), 400, 'VALIDATION_FAILED');
    expectError(await upd(randomUUID(), { name: 'X' }), 404, 'NOT_FOUND');
    const toFormula = exact(
      ComplianceCalendarEntry,
      await upd(entryId, { ruleKind: 'FORMULA', rule: { monthsAfterYearEnd: 1, day: 1 } }),
    );
    expect(toFormula).toMatchObject({
      ruleKind: 'FORMULA',
      dueOn: null,
      rule: { monthsAfterYearEnd: 1, day: 1 },
    });
    const del = (id: string) =>
      call('delete', `/compliance/calendars/${v1.id}/entries/${id}`, people.ownerA);
    exact(ComplianceOk, await del(entryId));
    expectError(await del(entryId), 404, 'NOT_FOUND');
    // The unknown date gets its date, then the version verifies.
    const nv = v1.entries.find((e) => e.name === 'Form 2553')!;
    expect(
      exact(
        ComplianceCalendarEntry,
        await upd(nv.id, { ruleKind: 'FIXED_DATE', dueOn: '2031-03-16' }),
      ),
    ).toMatchObject({ ruleKind: 'FIXED_DATE', dueOn: '2031-03-16', rule: null });
    expect(await auditActions(v1.id)).toEqual(
      expect.arrayContaining([
        'compliance.calendar.entry-added',
        'compliance.calendar.entry-updated',
        'compliance.calendar.entry-deleted',
        'compliance.calendar.updated',
      ]),
    );
  });

  it('verifies a draft, after which it can no longer change', async () => {
    const verified = exact(ComplianceCalendar, await post(`/${v1.id}/verify`));
    expect(verified).toMatchObject({ status: 'VERIFIED', needsVerificationCount: 0 });
    expect(verified.verifiedAt).not.toBeNull();
    expectError(await post(`/${v1.id}/verify`), 409, 'CALENDAR_STATE');
    expectError(
      await call('patch', `/compliance/calendars/${v1.id}`, people.ownerA, { name: 'Late' }),
      409,
      'CALENDAR_STATE',
    );
    expectError(
      await call('post', `/compliance/calendars/${v1.id}/entries`, people.ownerA, {
        ruleKind: 'FIXED_DATE',
        name: 'Late',
        type: 'ADVISORY',
        dueOn: '2031-09-01',
      }),
      409,
      'CALENDAR_STATE',
    );
    expectError(
      await call('delete', `/compliance/calendars/${v1.id}/entries/${entry1040}`, people.ownerA),
      409,
      'CALENDAR_STATE',
    );
    expectError(
      await call('patch', `/compliance/calendars/${v1.id}/entries/${entry1040}`, people.ownerA, {
        name: 'Late',
      }),
      409,
      'CALENDAR_STATE',
    );
  });

  const v2Body = () => ({
    family: 'IRS_GENERAL',
    authority,
    jurisdiction: 'FEDERAL',
    effectiveYear: 2031,
    name: 'IRS 2031 revised',
    sourceUrl: 'https://www.irs.gov/publications/p509',
    entries: [
      { ...entries.form1040, dueOn: '2031-04-20' },
      entries.form1065,
      { ruleKind: 'FIXED_DATE', name: 'Form 941', type: 'PAYROLL', dueOn: '2031-04-30' },
    ],
  });

  it('previews an import against nothing published, then publishes the verified version', async () => {
    const first = exact(ComplianceCalendarDiff, await post('/import-preview', v2Body()));
    expect(first).toMatchObject({
      from: null,
      to: null,
      counts: { added: 3, changed: 0, removed: 0, unchanged: 0 },
      conflicts: 0,
    });
    // Nothing was written.
    expect(
      exact(
        ComplianceCalendarPage,
        await cal(`?family=IRS_GENERAL&year=2031&search=${encodeURIComponent(authority)}`),
      ).items.filter((c) => c.authority === authority),
    ).toHaveLength(1);
    expectError(await post(`/${randomUUID()}/publish`), 404, 'NOT_FOUND');
    const draft = await mkCalendar({
      authority: `${authority} draft`,
      entries: [entries.form1040],
    });
    expectError(await post(`/${draft.id}/publish`), 409, 'CALENDAR_STATE');
    const pub = exact(ComplianceCalendar, await post(`/${v1.id}/publish`));
    expect(pub.status).toBe('PUBLISHED');
    expect(pub.publishedAt).not.toBeNull();
    expectError(await post(`/${v1.id}/publish`), 409, 'CALENDAR_STATE');
    // The failed attempt is in the log.
    const failed = exact(
      ComplianceLogPage,
      await call(
        'get',
        `/compliance/logs?kind=PUBLISH&outcome=FAILED&calendarId=${draft.id}`,
        people.ownerA,
      ),
    );
    expect(failed.items).toHaveLength(1);
    expect(await auditActions(v1.id)).toContain('compliance.calendar.published');
  });

  it('previews an import against the published version: added, changed, removed, unchanged and conflicts', async () => {
    // A deadline whose date the firm moved, made from the published entry.
    await asOwner(ids.firmA, (tx) =>
      tx.complianceDeadline.create({
        data: {
          businessId: ids.firmA,
          clientId: s.c1,
          name: 'Form 1040 override',
          type: 'TAX_FILING',
          source: 'GOVERNMENT',
          statutoryDueOn: new Date('2031-04-15T00:00:00.000Z'),
          dueOn: new Date('2031-04-18T00:00:00.000Z'),
          dueOverridden: true,
          dueOverrideReason: 'Fake reason',
          calendarEntryId: entry1040,
        },
      }),
    );
    const diff = exact(ComplianceCalendarDiff, await post('/import-preview', v2Body()));
    expect(diff.from).toMatchObject({ id: v1.id, version: 1, status: 'PUBLISHED' });
    expect(diff.to).toBeNull();
    expect(diff.counts).toEqual({ added: 1, changed: 1, removed: 1, unchanged: 1 });
    expect(diff.conflicts).toBe(1);
    const by = Object.fromEntries(diff.entries.map((e) => [e.name, e]));
    expect(by['Form 1040']).toMatchObject({
      change: 'CHANGED',
      overriddenDeadlines: 1,
      before: { dueOn: '2031-04-15' },
      after: { dueOn: '2031-04-20' },
    });
    expect(by['Form 1065']).toMatchObject({ change: 'UNCHANGED', overriddenDeadlines: 0 });
    expect(by['Form 2553']).toMatchObject({ change: 'REMOVED', after: null });
    expect(by['Form 941']).toMatchObject({ change: 'ADDED', before: null });
  });

  it('versions per family, authority, state and year, and compares two versions', async () => {
    v2 = await mkCalendar({ ...v2Body(), entries: v2Body().entries });
    expect(v2).toMatchObject({ version: 2, status: 'DRAFT' });
    // Another state, another year and another authority start at version 1.
    expect(
      (await mkCalendar({ authority, jurisdiction: 'STATE', state: 'GA', entries: [] })).version,
    ).toBe(1);
    expect((await mkCalendar({ authority, effectiveYear: 2032, entries: [] })).version).toBe(1);
    const diff = exact(ComplianceCalendarDiff, await cal(`/${v2.id}/compare/${v1.id}`));
    expect(diff.from?.id).toBe(v1.id);
    expect(diff.to?.id).toBe(v2.id);
    expect(diff.counts).toEqual({ added: 1, changed: 1, removed: 1, unchanged: 1 });
    expect(diff.conflicts).toBe(1);
    expectError(await cal(`/${v2.id}/compare/${randomUUID()}`), 404, 'NOT_FOUND');
    expectError(await cal(`/${v2.id}/compare/not-a-uuid`), 400, 'VALIDATION_FAILED');
    expectError(await cal(`/${v2.id}/compare/${v1.id}`, people.staffA), 403, 'FORBIDDEN');
  });

  it('publishes a version, supersedes the one in use and rolls back to it', async () => {
    exact(ComplianceCalendar, await post(`/${v2.id}/verify`));
    const pub = exact(ComplianceCalendar, await post(`/${v2.id}/publish`));
    expect(pub.status).toBe('PUBLISHED');
    expect(exact(ComplianceCalendar, await cal(`/${v1.id}`)).status).toBe('SUPERSEDED');
    // At most one is published for the family, authority, state and year.
    const published = exact(
      ComplianceCalendarPage,
      await cal(`?status=PUBLISHED&year=2031&search=${encodeURIComponent(authority)}&pageSize=100`),
    );
    expect(
      published.items.filter((c) => c.authority === authority && c.state === null).map((c) => c.id),
    ).toEqual([v2.id]);
    // Roll back: the old version is in use again and the new one superseded.
    expectError(await post(`/${v2.id}/rollback`), 409, 'CALENDAR_STATE');
    const back = exact(ComplianceCalendar, await post(`/${v1.id}/rollback`));
    expect(back.status).toBe('PUBLISHED');
    expect(exact(ComplianceCalendar, await cal(`/${v2.id}`)).status).toBe('SUPERSEDED');
    expectError(await post(`/${v1.id}/rollback`), 409, 'CALENDAR_STATE');
    expect(await auditActions(v1.id)).toContain('compliance.calendar.rolled-back');
    // The log has each step.
    const kinds = exact(
      ComplianceLogPage,
      await call('get', `/compliance/logs?calendarId=${v2.id}&pageSize=100`, people.staffA),
    ).items.map((l) => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(['IMPORT', 'VERIFY', 'PUBLISH']));
    const rb = exact(
      ComplianceLogPage,
      await call(
        'get',
        `/compliance/logs?kind=ROLLBACK&calendarId=${v1.id}&outcome=SUCCESS`,
        people.staffA,
      ),
    );
    expect(rb.items).toHaveLength(1);
    // The refused attempt (the version was not replaced) is logged as failed.
    const refused = exact(
      ComplianceLogPage,
      await call(
        'get',
        `/compliance/logs?kind=ROLLBACK&calendarId=${v1.id}&outcome=FAILED`,
        people.staffA,
      ),
    );
    expect(refused.items).toHaveLength(1);
    expect(
      exact(
        ComplianceLogPage,
        await call(
          'get',
          `/compliance/logs?from=${plus(0)}&to=${plus(0)}&pageSize=100`,
          people.staffA,
        ),
      ).total,
    ).toBeGreaterThan(0);
    expect(
      exact(
        ComplianceLogPage,
        await call('get', `/compliance/logs?from=${plus(-9)}&to=${plus(-5)}`, people.staffA),
      ).total,
    ).toBe(0);
  });

  it('archives what is not in use, and lists with filters', async () => {
    expectError(await post(`/${v1.id}/archive`), 409, 'CALENDAR_STATE');
    expect(exact(ComplianceCalendar, await post(`/${v2.id}/archive`)).status).toBe('ARCHIVED');
    expectError(await post(`/${v2.id}/archive`), 409, 'CALENDAR_STATE');
    expectError(await post(`/${randomUUID()}/archive`), 404, 'NOT_FOUND');
    const q = (query: string, who: Who = people.staffA) => cal(`?${query}`, who);
    const byStatus = exact(
      ComplianceCalendarPage,
      await q(`status=ARCHIVED&search=${encodeURIComponent(authority)}`),
    );
    expect(byStatus.items.map((c) => c.id)).toEqual([v2.id]);
    expect(
      exact(
        ComplianceCalendarPage,
        await q(`state=GA&search=${encodeURIComponent(authority)}`),
      ).items.every((c) => c.state === 'GA'),
    ).toBe(true);
    expect(
      exact(ComplianceCalendarPage, await q(`year=2032&search=${encodeURIComponent(authority)}`))
        .total,
    ).toBe(1);
    expect(exact(ComplianceCalendarPage, await q('family=SALES_USE_TAX')).total).toBe(0);
    const page = exact(
      ComplianceCalendarPage,
      await q(`search=${encodeURIComponent(authority)}&pageSize=2&page=1`),
    );
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
    // Newest year first, then authority, then newest version.
    const all = exact(
      ComplianceCalendarPage,
      await q(`search=${encodeURIComponent(authority)}&pageSize=100`),
    ).items;
    expect(all[0]?.effectiveYear).toBe(2032);
    for (const bad of ['status=NOPE', 'year=1999', 'state=Georgia', 'pageSize=101']) {
      expectError(await q(bad), 400, 'VALIDATION_FAILED');
    }
  });

  it('warns about a published calendar that was last verified long ago', async () => {
    await asOwner(ids.firmA, (tx) =>
      tx.complianceCalendar.update({
        where: { id: v1.id },
        data: { verifiedAt: new Date(Date.now() - 100 * DAY) },
      }),
    );
    expect(exact(ComplianceCalendar, await cal(`/${v1.id}`)).stale).toBe(true);
    expect(
      exact(
        ComplianceCalendarPage,
        await cal(`?status=PUBLISHED&search=${encodeURIComponent(authority)}`),
      ).items[0]?.stale,
    ).toBe(true);
    // A superseded or draft version is not "in use", so it does not warn.
    expect(exact(ComplianceCalendar, await cal(`/${v2.id}`)).stale).toBe(false);
    const dl = await asOwner(ids.firmA, (tx) =>
      tx.complianceDeadline.findFirstOrThrow({ where: { calendarEntryId: entry1040 } }),
    );
    const detail = await get(dl.id);
    expect(detail.calendarStale).toBe(true);
    expect(detail.calendarEntry).toMatchObject({
      id: entry1040,
      calendarId: v1.id,
      authority,
      effectiveYear: 2031,
      version: 1,
    });
    // A shorter limit makes a fresh calendar stale too.
    expect(
      (await call('patch', '/compliance/settings', people.ownerA, { staleCalendarDays: 120 }))
        .status,
    ).toBe(200);
    expect((await get(dl.id)).calendarStale).toBe(false);
    expect(
      (await call('patch', '/compliance/settings', people.ownerA, { staleCalendarDays: 90 }))
        .status,
    ).toBe(200);
  });

  it("is firm A's: firm B cannot read, change, compare or publish it", async () => {
    const b = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) =>
      call(method, `/compliance/calendars${path}`, people.ownerB, body, ids.firmB);
    expect(exact(ComplianceCalendarPage, await b('get', '')).total).toBe(0);
    for (const [method, path, body] of [
      ['get', `/${v1.id}`],
      ['patch', `/${v1.id}`, { name: 'Hacked' }],
      ['get', `/${v1.id}/compare/${v2.id}`],
      ['post', `/${v1.id}/verify`],
      ['post', `/${v1.id}/publish`],
      ['post', `/${v1.id}/rollback`],
      ['post', `/${v1.id}/archive`],
      [
        'post',
        `/${v1.id}/entries`,
        { ruleKind: 'FIXED_DATE', name: 'X', type: 'TAX_FILING', dueOn: '2031-01-01' },
      ],
      ['patch', `/${v1.id}/entries/${entry1040}`, { name: 'Hacked' }],
      ['delete', `/${v1.id}/entries/${entry1040}`],
    ] as const) {
      expectError(await b(method, path, body as object | undefined), 404, 'NOT_FOUND');
    }
    // Firm B's own version of the same calendar starts at 1 and is its own.
    const own = exact(
      ComplianceCalendar,
      await post('', { ...v2Body(), entries: [] }, people.ownerB, ids.firmB),
      201,
    );
    expect(own.version).toBe(1);
    expect((await call('get', `/compliance/calendars/${own.id}`, people.ownerA)).status).toBe(404);
  });
});

describe('recurring definitions', () => {
  const rec = (path = '', who: Who = people.ownerA, firm = ids.firmA) =>
    call('get', `/compliance/recurrences${path}`, who, undefined, firm);
  const mk = async (body: object = {}, who: Who = people.ownerA, firm = ids.firmA) =>
    exact(
      ComplianceRecurrence,
      await call(
        'post',
        '/compliance/recurrences',
        who,
        {
          name: name('recurrence'),
          type: 'PAYROLL',
          frequency: 'MONTHLY',
          repeatRule: { dayOfMonth: 15 },
          startOn: plus(-100),
          ...body,
        },
        firm,
      ),
      201,
    );

  it('creates a definition with its next date, from the repeat rule and the holiday rule', async () => {
    const r = await mk({
      description: 'Fake description',
      agency: 'IRS',
      relatedForm: '941',
      holidayRule: 'NEXT_BUSINESS_DAY',
      reminders: [{ daysBefore: 7 }],
      createTask: true,
      taskTemplateId: s.tpl,
      assignedUserId: people.adminA.id,
      clientVisible: true,
      remindClient: true,
      notifyTeam: true,
      sendPastDueNotice: true,
      escalateToManager: true,
      addToTaxCalendar: false,
    });
    expect(r).toMatchObject({
      type: 'PAYROLL',
      frequency: 'MONTHLY',
      interval: null,
      repeatRule: { dayOfMonth: 15 },
      holidayRule: 'NEXT_BUSINESS_DAY',
      isTemplate: false,
      status: 'ACTIVE',
      endMode: 'NEVER',
      createTask: true,
      taskTemplateId: s.tpl,
      assignedTo: { userId: people.adminA.id },
      clientVisible: true,
      remindClient: true,
      addToTaxCalendar: false,
      reminders: [{ daysBefore: 7, inApp: true, channels: [] }],
      deadlineCount: 0,
      pausedAt: null,
      endedAt: null,
    });
    // The 15th, or the next business day after it, from today on.
    expect(r.nextDueOn! >= plus(0)).toBe(true);
    expect(r.nextDueOn! <= plus(45)).toBe(true);
    expect(await auditActions(r.id)).toEqual(['compliance.recurrence.created']);
    expect(exact(ComplianceRecurrence, await rec(`/${r.id}`, people.staffA))).toEqual(r);
  });

  it('refuses a definition that does not make sense, as the database would', async () => {
    const post = (body: object, who: Who = people.ownerA) =>
      call('post', '/compliance/recurrences', who, {
        name: name('r'),
        type: 'PAYROLL',
        frequency: 'MONTHLY',
        repeatRule: { dayOfMonth: 15 },
        startOn: plus(1),
        ...body,
      });
    for (const body of [
      { repeatRule: { month: 4, day: 15 } },
      { frequency: 'CUSTOM' },
      { interval: 3 },
      { startOn: undefined },
      { endMode: 'AFTER_COUNT' },
      { endMode: 'ON_DATE', endOn: plus(-10) },
      { endMode: 'NEVER', endOn: plus(10) },
      { remindClient: true },
      { taskTemplateId: s.tpl },
      { name: '' },
      { type: 'NOPE' },
      { state: 'Georgia' },
      { reminders: [{ daysBefore: 1 }, { daysBefore: 1 }] },
      { repeatRule: { dayOfMonth: 32 } },
      { unknown: 1 },
    ]) {
      expectError(await post(body), 400, 'VALIDATION_FAILED');
    }
    expectError(await post({ assignedUserId: people.clientA.id }), 409, 'NOT_A_MEMBER');
    expectError(
      await post({ createTask: true, taskTemplateId: s.tplB }),
      409,
      'TEMPLATE_NOT_FOUND',
    );
    expectError(await post({ calendarEntryId: randomUUID() }), 404, 'NOT_FOUND');
    expectError(await post({}, people.staffA), 403, 'FORBIDDEN');
    expectError(await post({}, people.clientA), 403, 'FORBIDDEN');
  });

  it('keeps names unique among definitions and among templates, and a template makes no deadlines', async () => {
    const r = await mk({ name: `Same ${run}` });
    expectError(
      await call('post', '/compliance/recurrences', people.ownerA, {
        name: `Same ${run}`,
        type: 'PAYROLL',
        frequency: 'MONTHLY',
        repeatRule: { dayOfMonth: 1 },
        startOn: plus(1),
      }),
      409,
      'DUPLICATE',
    );
    const tpl = await mk({ name: `Same ${run}`, isTemplate: true, startOn: undefined });
    expect(tpl).toMatchObject({ isTemplate: true, startOn: null, nextDueOn: null });
    expect(tpl.id).not.toBe(r.id);
    // Custom, quarterly, annual and authority-defined definitions.
    expect(
      await mk({ frequency: 'CUSTOM', interval: 2, repeatRule: { dayOfMonth: 10 } }),
    ).toMatchObject({ interval: 2 });
    expect(
      await mk({
        frequency: 'QUARTERLY',
        repeatRule: { monthsAfterQuarterEnd: 1, dayOfMonth: 30 },
      }),
    ).toMatchObject({ frequency: 'QUARTERLY' });
    expect(await mk({ frequency: 'ANNUAL', repeatRule: { month: 4, day: 15 } })).toMatchObject({
      frequency: 'ANNUAL',
    });
    const auth = await mk({ frequency: 'AUTHORITY_DEFINED', repeatRule: {} });
    expect(auth.nextDueOn).toBeNull();
    expect(
      await mk({ repeatRule: { nth: 2, weekday: 2 }, endMode: 'AFTER_COUNT', endAfterCount: 12 }),
    ).toMatchObject({ endMode: 'AFTER_COUNT', endAfterCount: 12 });
  });

  it('lists with filters, sorts and pages', async () => {
    const a = await mk({ name: `Aaa ${run}`, type: 'SALES_TAX', repeatRule: { dayOfMonth: 20 } });
    const z = await mk({ name: `Zzz ${run}`, type: 'SALES_TAX', repeatRule: { dayOfMonth: 5 } });
    const page = async (q: string, who: Who = people.staffA) =>
      exact(ComplianceRecurrencePage, await rec(`?${q}`, who));
    expect((await page(`type=SALES_TAX&search=${run}&sort=name`)).items.map((r) => r.id)).toEqual([
      a.id,
      z.id,
    ]);
    expect(
      (await page(`type=SALES_TAX&search=${run}&sort=name&direction=desc&pageSize=1`)).items.map(
        (r) => r.id,
      ),
    ).toEqual([z.id]);
    const byNext = await page(`type=SALES_TAX&search=${run}&sort=nextDueOn`);
    expect(byNext.items.map((r) => r.nextDueOn)).toEqual(
      [...byNext.items.map((r) => r.nextDueOn)].sort(),
    );
    expect((await page(`templates=true&search=Same ${run}`)).items.every((r) => r.isTemplate)).toBe(
      true,
    );
    expect(
      (await page(`templates=false&search=Same ${run}`)).items.every((r) => !r.isTemplate),
    ).toBe(true);
    expect((await page('status=ENDED')).total).toBe(0);
    expect((await page('status=ACTIVE&type=SALES_TAX&search=' + run)).total).toBe(2);
    for (const bad of ['status=NOPE', 'sort=nope', 'templates=maybe', 'pageSize=0']) {
      expectError(await rec(`?${bad}`), 400, 'VALIDATION_FAILED');
    }
  });

  it('edits a definition, checking the whole of it', async () => {
    const r = await mk();
    const patch = (body: object, who: Who = people.ownerA) =>
      call('patch', `/compliance/recurrences/${r.id}`, who, body);
    const saved = exact(
      ComplianceRecurrence,
      await patch({
        name: `Renamed ${run}`,
        holidayRule: 'PREVIOUS_BUSINESS_DAY',
        reminders: [{ daysBefore: 3 }],
        description: null,
      }),
    );
    expect(saved).toMatchObject({
      name: `Renamed ${run}`,
      holidayRule: 'PREVIOUS_BUSINESS_DAY',
      reminders: [{ daysBefore: 3, inApp: true, channels: [] }],
    });
    // Changing the frequency needs a repeat rule that fits.
    expectError(await patch({ frequency: 'ANNUAL' }), 400, 'VALIDATION_FAILED');
    expect((await patch({ frequency: 'ANNUAL', repeatRule: { month: 9, day: 5 } })).status).toBe(
      200,
    );
    expectError(await patch({}), 400, 'VALIDATION_FAILED');
    expectError(await patch({ isTemplate: true }), 400, 'VALIDATION_FAILED');
    expectError(await patch({ taskTemplateId: s.tpl }), 400, 'VALIDATION_FAILED');
    expectError(
      await patch({ createTask: true, taskTemplateId: s.tplB }),
      409,
      'TEMPLATE_NOT_FOUND',
    );
    expectError(await patch({ assignedUserId: people.clientA.id }), 409, 'NOT_A_MEMBER');
    expectError(await patch({ name: 'X' }, people.staffA), 403, 'FORBIDDEN');
    expectError(
      await call('patch', `/compliance/recurrences/${randomUUID()}`, people.ownerA, { name: 'X' }),
      404,
      'NOT_FOUND',
    );
    const other = await mk();
    expectError(await patch({ name: other.name }), 409, 'DUPLICATE');
    expect(await auditActions(r.id)).toContain('compliance.recurrence.updated');
  });

  it('pauses, resumes, ends and archives', async () => {
    const r = await mk();
    const act2 = (action: string, who: Who = people.ownerA) =>
      call('post', `/compliance/recurrences/${r.id}/${action}`, who);
    const paused = exact(ComplianceRecurrence, await act2('pause', people.staffA));
    expect(paused.status).toBe('PAUSED');
    expect(paused.pausedAt).not.toBeNull();
    expect(paused.nextDueOn).toBeNull();
    expectError(await act2('pause'), 409, 'RECURRENCE_STATE');
    expect(exact(ComplianceRecurrence, await act2('resume', people.staffA))).toMatchObject({
      status: 'ACTIVE',
      pausedAt: null,
    });
    expectError(await act2('resume'), 409, 'RECURRENCE_STATE');
    expectError(await act2('end', people.staffA), 403, 'FORBIDDEN');
    expectError(await act2('archive', people.staffA), 403, 'FORBIDDEN');
    const ended = exact(ComplianceRecurrence, await act2('end'));
    expect(ended.status).toBe('ENDED');
    expect(ended.endedAt).not.toBeNull();
    expectError(await act2('end'), 409, 'RECURRENCE_STATE');
    expectError(await act2('pause'), 409, 'RECURRENCE_STATE');
    expectError(
      await call('patch', `/compliance/recurrences/${r.id}`, people.ownerA, { name: 'Late' }),
      409,
      'RECURRENCE_STATE',
    );
    expect(exact(ComplianceRecurrence, await act2('archive')).status).toBe('ARCHIVED');
    expectError(await act2('archive'), 409, 'RECURRENCE_STATE');
    expect(await auditActions(r.id)).toEqual([
      'compliance.recurrence.created',
      'compliance.recurrence.paused',
      'compliance.recurrence.resumed',
      'compliance.recurrence.ended',
      'compliance.recurrence.archived',
    ]);
    // An active definition can be archived directly.
    const direct = await mk();
    const arch = exact(
      ComplianceRecurrence,
      await call('post', `/compliance/recurrences/${direct.id}/archive`, people.ownerA),
    );
    expect(arch.endedAt).not.toBeNull();
  });

  it('previews the next dates without saving, keeping the unadjusted date', async () => {
    const preview = async (body: object) =>
      exact(
        ComplianceRecurrencePreview,
        await call('post', '/compliance/recurrences/preview', people.staffA, body),
      );
    const monthly = await preview({
      frequency: 'MONTHLY',
      repeatRule: { dayOfMonth: 15 },
      startOn: '2026-09-01',
      holidayRule: 'NONE',
    });
    expect(monthly.dates.map((d) => d.statutoryOn)).toEqual([
      '2026-09-15',
      '2026-10-15',
      '2026-11-15',
      '2026-12-15',
      '2027-01-15',
      '2027-02-15',
    ]);
    expect(monthly.dates.every((d) => !d.adjusted && d.dueOn === d.statutoryOn)).toBe(true);
    const annual = await preview({
      frequency: 'ANNUAL',
      repeatRule: { month: 9, day: 5 },
      startOn: '2026-01-01',
      count: 1,
    });
    expect(annual.dates).toEqual([
      { statutoryOn: '2026-09-05', dueOn: '2026-09-08', adjusted: true },
    ]);
    const prev = await preview({
      frequency: 'ANNUAL',
      repeatRule: { month: 7, day: 4 },
      startOn: '2026-01-01',
      count: 1,
      holidayRule: 'PREVIOUS_BUSINESS_DAY',
    });
    expect(prev.dates).toEqual([
      { statutoryOn: '2026-07-04', dueOn: '2026-07-02', adjusted: true },
    ]);
    const limited = await preview({
      frequency: 'MONTHLY',
      repeatRule: { dayOfMonth: 1 },
      startOn: '2026-01-01',
      endMode: 'AFTER_COUNT',
      endAfterCount: 2,
    });
    expect(limited.dates).toHaveLength(2);
    expect(
      (
        await preview({
          frequency: 'QUARTERLY',
          repeatRule: { monthsAfterQuarterEnd: 1, dayOfMonth: 30 },
          startOn: '2026-02-01',
          count: 3,
        })
      ).dates.map((d) => d.statutoryOn),
    ).toEqual(['2026-04-30', '2026-07-30', '2026-10-30']);
    const noStart = await preview({ frequency: 'MONTHLY', repeatRule: { dayOfMonth: 28 } });
    expect(noStart.dates).toHaveLength(6);
    expect(noStart.dates[0]!.statutoryOn >= plus(0)).toBe(true);
    // Authority-defined: the dates come from the library, never invented.
    expect(await preview({ frequency: 'AUTHORITY_DEFINED' })).toEqual({
      dates: [],
      message: expect.stringContaining('authority'),
    });
    const calendar = await mkCalendar({
      authority: `Preview ${run}`,
      entries: [{ ruleKind: 'FIXED_DATE', name: 'Fixed', type: 'TAX_FILING', dueOn: '2031-04-15' }],
    });
    const entry = calendar.entries[0]!.id;
    expect(await preview({ frequency: 'AUTHORITY_DEFINED', calendarEntryId: entry })).toEqual({
      dates: [{ statutoryOn: '2031-04-15', dueOn: '2031-04-15', adjusted: false }],
      message: null,
    });
    expectError(
      await call('post', '/compliance/recurrences/preview', people.staffA, {
        frequency: 'AUTHORITY_DEFINED',
        calendarEntryId: randomUUID(),
      }),
      404,
      'NOT_FOUND',
    );
    for (const bad of [
      { frequency: 'MONTHLY' },
      { frequency: 'MONTHLY', repeatRule: { dayOfMonth: 1 }, count: 25 },
      { frequency: 'ANNUAL', repeatRule: { dayOfMonth: 1 } },
    ]) {
      expectError(
        await call('post', '/compliance/recurrences/preview', people.staffA, bad),
        400,
        'VALIDATION_FAILED',
      );
    }
  });

  it("is firm A's: firm B cannot read or change it, nor name its records", async () => {
    const r = await mk();
    const b = (method: 'get' | 'post' | 'patch', path: string, body?: object) =>
      call(method, `/compliance/recurrences${path}`, people.ownerB, body, ids.firmB);
    for (const [method, path, body] of [
      ['get', `/${r.id}`],
      ['patch', `/${r.id}`, { name: 'Hacked' }],
      ['post', `/${r.id}/pause`],
      ['post', `/${r.id}/resume`],
      ['post', `/${r.id}/end`],
      ['post', `/${r.id}/archive`],
    ] as const) {
      expectError(await b(method, path, body as object | undefined), 404, 'NOT_FOUND');
    }
    expect(exact(ComplianceRecurrencePage, await b('get', '')).total).toBe(0);
    const entry = await asOwner(ids.firmA, (tx) =>
      tx.complianceCalendarEntry.findFirstOrThrow({ where: { businessId: ids.firmA } }),
    );
    const body = {
      name: 'B',
      type: 'PAYROLL',
      frequency: 'MONTHLY',
      repeatRule: { dayOfMonth: 1 },
      startOn: plus(1),
    };
    expectError(await b('post', '', { ...body, calendarEntryId: entry.id }), 404, 'NOT_FOUND');
    expectError(
      await b('post', '', { ...body, createTask: true, taskTemplateId: s.tpl }),
      409,
      'TEMPLATE_NOT_FOUND',
    );
    expectError(
      await b('post', '', { ...body, assignedUserId: people.adminA.id }),
      409,
      'NOT_A_MEMBER',
    );
  });
});

describe('applicability rules and suggestions', () => {
  let entry: string;
  let formula: string;
  let rule: z.output<typeof ComplianceApplicabilityRule>;
  const rules = (path = '', who: Who = people.ownerA, firm = ids.firmA) =>
    call('get', `/compliance/applicability-rules${path}`, who, undefined, firm);
  const mkRule = async (body: object = {}, who: Who = people.ownerA) =>
    exact(
      ComplianceApplicabilityRule,
      await call('post', '/compliance/applicability-rules', who, {
        name: name('rule'),
        target: { kind: 'CALENDAR_ENTRY', id: entry },
        ...body,
      }),
      201,
    );
  const generate = (ruleId: string, body: object = {}, who: Who = people.ownerA) =>
    call('post', '/compliance/suggestions', who, { ruleId, ...body });
  const suggestions = async (query = '', who: Who = people.ownerA) =>
    exact(ComplianceSuggestionPage, await call('get', `/compliance/suggestions${query}`, who));

  beforeAll(async () => {
    const calendar = await mkCalendar({
      authority: `Rules ${run}`,
      entries: [
        {
          ruleKind: 'FIXED_DATE',
          name: 'S corp return',
          type: 'TAX_FILING',
          dueOn: '2031-09-15',
          form: '1120-S',
          description: 'Fake description',
        },
        {
          ruleKind: 'FORMULA',
          name: 'Formula return',
          type: 'TAX_FILING',
          rule: { monthsAfterYearEnd: 3, day: 15 },
        },
      ],
    });
    entry = calendar.entries.find((e) => e.name === 'S corp return')!.id;
    formula = calendar.entries.find((e) => e.name === 'Formula return')!.id;
  });

  it('creates a rule for a library entry, which a Staff member cannot', async () => {
    rule = await mkRule({
      name: `S corps in Georgia ${run}`,
      entityTypes: ['S_CORPORATION'],
      states: ['GA'],
      excludeStatuses: ['INACTIVE'],
      criteria: {},
    });
    expect(rule).toMatchObject({
      target: { kind: 'CALENDAR_ENTRY', id: entry, name: 'S corp return' },
      outcome: 'SUGGEST',
      entityTypes: ['S_CORPORATION'],
      states: ['GA'],
      services: [],
      excludeStatuses: ['INACTIVE'],
      priorYearLiabilityOverCents: null,
      active: true,
      version: 1,
    });
    expect(await auditActions(rule.id)).toEqual(['compliance.rule.created']);
    expectError(
      await call('post', '/compliance/applicability-rules', people.staffA, {
        name: 'X',
        target: { kind: 'CALENDAR_ENTRY', id: entry },
      }),
      403,
      'FORBIDDEN',
    );
    expect(exact(ComplianceApplicabilityRule, await rules(`/${rule.id}`, people.staffA))).toEqual(
      rule,
    );
  });

  it('refuses a rule that names nothing real, or that the database would refuse', async () => {
    const post = (body: object) =>
      call('post', '/compliance/applicability-rules', people.ownerA, {
        name: name('rule'),
        target: { kind: 'CALENDAR_ENTRY', id: entry },
        ...body,
      });
    for (const body of [
      { name: '' },
      { states: ['XX'] },
      { states: ['Georgia'] },
      { services: ['NOPE'] },
      { entityTypes: Array.from({ length: 31 }, (_, i) => `E${i}`) },
      { priorYearLiabilityOverCents: -1 },
      { criteria: { nested: { no: 1 } } },
      { outcome: 'NOPE' },
      { target: { kind: 'CALENDAR_ENTRY' } },
      { target: { kind: 'NOPE', id: entry } },
      { target: undefined },
      { unknown: 1 },
    ]) {
      expectError(await post(body), 400, 'VALIDATION_FAILED');
    }
    expectError(
      await post({ target: { kind: 'CALENDAR_ENTRY', id: randomUUID() } }),
      404,
      'NOT_FOUND',
    );
    expectError(await post({ target: { kind: 'RECURRENCE', id: randomUUID() } }), 404, 'NOT_FOUND');
    const tpl = exact(
      ComplianceRecurrence,
      await call('post', '/compliance/recurrences', people.ownerA, {
        name: name('tpl'),
        type: 'PAYROLL',
        frequency: 'ANNUAL',
        repeatRule: { month: 1, day: 1 },
        isTemplate: true,
      }),
      201,
    );
    expectError(
      await post({ target: { kind: 'RECURRENCE', id: tpl.id } }),
      409,
      'RECURRENCE_STATE',
    );
  });

  it("raises the rule's version whenever what it decides changes, and not for a rename", async () => {
    const patch = (body: object, who: Who = people.ownerA) =>
      call('patch', `/compliance/applicability-rules/${rule.id}`, who, body);
    expect(
      exact(ComplianceApplicabilityRule, await patch({ name: `Renamed ${run}` })).version,
    ).toBe(2);
    const same = exact(ComplianceApplicabilityRule, await patch({ states: ['GA'] }));
    expect(same.version).toBe(2);
    const changed = exact(ComplianceApplicabilityRule, await patch({ states: ['GA', 'FL'] }));
    expect(changed).toMatchObject({ states: ['GA', 'FL'], version: 3 });
    const back = exact(ComplianceApplicabilityRule, await patch({ states: ['GA'] }));
    expect(back.version).toBe(4);
    expectError(await patch({}), 400, 'VALIDATION_FAILED');
    expectError(await patch({ states: ['XX'] }), 400, 'VALIDATION_FAILED');
    expectError(
      await patch({ target: { kind: 'CALENDAR_ENTRY', id: entry } }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await patch({ name: 'X' }, people.staffA), 403, 'FORBIDDEN');
    expectError(
      await call('patch', `/compliance/applicability-rules/${randomUUID()}`, people.ownerA, {
        name: 'X',
      }),
      404,
      'NOT_FOUND',
    );
    rule = back;
    expect(await auditActions(rule.id)).toContain('compliance.rule.updated');
  });

  it('lists rules with filters', async () => {
    const other = await mkRule({ name: `Inactive ${run}`, active: false });
    const page = async (q: string) =>
      exact(ComplianceApplicabilityRulePage, await rules(`?${q}`, people.staffA));
    expect((await page(`search=${run}&active=false`)).items.map((r) => r.id)).toEqual([other.id]);
    expect((await page(`search=${run}&active=true`)).items.map((r) => r.id)).toEqual([rule.id]);
    expect((await page(`calendarEntryId=${entry}&pageSize=1`)).items).toHaveLength(1);
    expect((await page(`calendarEntryId=${entry}&search=${run}`)).total).toBe(2);
    expect((await page(`recurrenceId=${randomUUID()}`)).total).toBe(0);
    expectError(await rules('?active=maybe'), 400, 'VALIDATION_FAILED');
  });

  it('previews which clients a rule matches, and which it cannot decide for lack of data', async () => {
    const ev = exact(
      ComplianceRuleEvaluation,
      await call('post', `/compliance/applicability-rules/${rule.id}/evaluate`, people.ownerA),
    );
    expect(ev).toMatchObject({
      ruleId: rule.id,
      ruleVersion: 4,
      matchingCount: 1,
      needsReviewCount: 1,
      excludedCount: 0,
    });
    expect(ev.matching.map((c) => c.id)).toEqual([s.c1]);
    expect(ev.needsReview.map((r) => r.client.id)).toEqual([s.c3]);
    expect(ev.needsReview[0]?.reason).toContain('entity type');
    // Nothing was written.
    expect((await suggestions()).total).toBe(0);
    expectError(
      await call('post', `/compliance/applicability-rules/${rule.id}/evaluate`, people.staffA),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/compliance/applicability-rules/${randomUUID()}/evaluate`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    // An excluded status keeps a client out; a client with a criterion the records cannot check needs review.
    await asOwner(ids.firmA, (tx) =>
      tx.client.update({ where: { id: s.c1 }, data: { status: 'INACTIVE' } }),
    );
    expect(
      exact(
        ComplianceRuleEvaluation,
        await call('post', `/compliance/applicability-rules/${rule.id}/evaluate`, people.ownerA),
      ),
    ).toMatchObject({ matchingCount: 0, excludedCount: 1 });
    await asOwner(ids.firmA, (tx) =>
      tx.client.update({ where: { id: s.c1 }, data: { status: 'ACTIVE' } }),
    );
    const review = await mkRule({
      name: `Criteria ${run}`,
      criteria: { election: 'S corporation' },
    });
    const ev2 = exact(
      ComplianceRuleEvaluation,
      await call('post', `/compliance/applicability-rules/${review.id}/evaluate`, people.ownerA),
    );
    expect(ev2).toMatchObject({ matchingCount: 0, needsReviewCount: 3 });
    expect(ev2.needsReview[0]?.reason).toContain('election');
  });

  it('records suggestions and flags clients for review, once per rule and date', async () => {
    const res = exact(GenerateSuggestionsResult, await generate(rule.id));
    expect(res).toEqual({
      ruleId: rule.id,
      dueOn: '2031-09-15',
      suggested: 1,
      needsReview: 1,
      applied: 0,
      alreadyDecided: 0,
    });
    expect(exact(GenerateSuggestionsResult, await generate(rule.id))).toMatchObject({
      suggested: 0,
      needsReview: 0,
      alreadyDecided: 2,
    });
    const open = await suggestions();
    expect(open.total).toBe(2);
    const byClient = Object.fromEntries(open.items.map((i) => [i.client.id, i]));
    expect(byClient[s.c1]).toMatchObject({
      decision: 'SUGGESTED',
      name: 'S corp return',
      dueOn: '2031-09-15',
      rule: { id: rule.id, version: 4 },
      decidedBy: null,
      deadlineId: null,
    });
    expect(byClient[s.c1]?.reason).toContain('v4');
    expect(byClient[s.c3]).toMatchObject({ decision: 'NEEDS_REVIEW' });
    expect(byClient[s.c3]?.reason).toContain('not recorded');
    // Filters; Staff see only the clients assigned to them.
    expect((await suggestions('?decision=NEEDS_REVIEW')).items.map((i) => i.client.id)).toEqual([
      s.c3,
    ]);
    expect((await suggestions(`?clientId=${s.c1}`)).total).toBe(1);
    expect((await suggestions(`?ruleId=${randomUUID()}`)).total).toBe(0);
    expect((await suggestions('?pageSize=1&page=2')).items).toHaveLength(1);
    expect((await suggestions('', people.staffA)).items.map((i) => i.client.id)).toEqual([s.c1]);
    expect((await suggestions('', people.staff2A)).total).toBe(0);
    expectError(
      await call('get', '/compliance/suggestions?decision=NOPE', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    const logs = exact(
      ComplianceLogPage,
      await call('get', `/compliance/logs?kind=GENERATE`, people.ownerA),
    );
    expect(logs.items[0]).toMatchObject({
      kind: 'GENERATE',
      outcome: 'SUCCESS',
      details: { ruleId: rule.id, suggested: 0 },
    });
    expect(await auditActions(rule.id)).toContain('compliance.suggestions.generated');
  });

  it('confirms a suggestion into a deadline that says why it applies, and does it once', async () => {
    const [mine] = (await suggestions(`?clientId=${s.c1}`)).items;
    expectError(
      await call('post', `/compliance/suggestions/${mine!.id}/confirm`, people.staff2A, {}),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/compliance/suggestions/${mine!.id}/confirm`, people.staffA, {
        assignedUserId: people.staff2A.id,
      }),
      409,
      'CLIENT_NOT_ASSIGNED',
    );
    expectError(
      await call('post', `/compliance/suggestions/${mine!.id}/confirm`, people.staffA, {
        assignedUserId: people.clientA.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    const d = exact(
      ComplianceDeadline,
      await call('post', `/compliance/suggestions/${mine!.id}/confirm`, people.staffA, {
        assignedUserId: people.staffA.id,
        priority: 'HIGH',
        clientVisible: true,
      }),
    );
    expect(d).toMatchObject({
      name: 'S corp return',
      source: 'GOVERNMENT',
      type: 'TAX_FILING',
      client: { id: s.c1 },
      statutoryDueOn: '2031-09-15',
      dueOn: '2031-09-15',
      dueOverridden: false,
      relatedForm: '1120-S',
      agency: `Rules ${run}`,
      jurisdiction: 'FEDERAL',
      assignedTo: { userId: people.staffA.id },
      priority: 'HIGH',
      clientVisible: true,
      calendarEntry: { id: entry, authority: `Rules ${run}`, effectiveYear: 2031 },
    });
    expect(d.applicabilityReason).toContain('v4');
    expect(d.reminders).toEqual(
      await call('get', '/compliance/settings', people.ownerA).then(
        (r) => (r.body as { defaultReminders: unknown[] }).defaultReminders,
      ),
    );
    expectError(
      await call('post', `/compliance/suggestions/${mine!.id}/confirm`, people.ownerA, {}),
      409,
      'SUGGESTION_STATE',
    );
    const confirmed = (await suggestions('?decision=CONFIRMED')).items.find(
      (i) => i.id === mine!.id,
    )!;
    expect(confirmed).toMatchObject({ deadlineId: d.id, decidedBy: { userId: people.staffA.id } });
    expect(confirmed.decidedAt).not.toBeNull();
    expect((await suggestions()).total).toBe(1);
    expect(await auditActions(mine!.id)).toEqual(['compliance.suggestion.confirmed']);
    // The deadline is the client's and carries the library entry: asking again for the same date finds it.
    expect(exact(GenerateSuggestionsResult, await generate(rule.id))).toMatchObject({
      suggested: 0,
      alreadyDecided: 2,
    });
  });

  it('dismisses a suggestion with a reason, and decides each only once', async () => {
    const [needs] = (await suggestions('?decision=NEEDS_REVIEW')).items;
    const dismiss = (
      id: string,
      body: object = { reason: 'Not an S corporation' },
      who: Who = people.ownerA,
    ) => call('post', `/compliance/suggestions/${id}/dismiss`, who, body);
    expectError(await dismiss(needs!.id, {}), 400, 'VALIDATION_FAILED');
    expectError(await dismiss(needs!.id, undefined, people.staff2A), 404, 'NOT_FOUND');
    exact(ComplianceOk, await dismiss(needs!.id));
    const done = (await suggestions('?decision=DISMISSED')).items.find((i) => i.id === needs!.id)!;
    expect(done.reason).toBe('Dismissed: Not an S corporation');
    expect(done).toMatchObject({ deadlineId: null, decidedBy: { userId: people.ownerA.id } });
    expectError(await dismiss(needs!.id), 409, 'SUGGESTION_STATE');
    expectError(
      await call('post', `/compliance/suggestions/${needs!.id}/confirm`, people.ownerA, {}),
      409,
      'SUGGESTION_STATE',
    );
    expect((await suggestions()).total).toBe(0);
    expectError(await dismiss(randomUUID()), 404, 'NOT_FOUND');
  });

  it('never invents a date: a formula entry needs the date, a fixed one keeps its own', async () => {
    const r = await mkRule({
      name: `Formula ${run}`,
      target: { kind: 'CALENDAR_ENTRY', id: formula },
    });
    expectError(await generate(r.id), 409, 'DUE_DATE_REQUIRED');
    expect(
      exact(GenerateSuggestionsResult, await generate(r.id, { dueOn: '2031-03-15' })),
    ).toMatchObject({ dueOn: '2031-03-15', suggested: 3 });
    expectError(await generate(rule.id, { dueOn: '2031-09-16' }), 400, 'VALIDATION_FAILED');
    expect(
      exact(GenerateSuggestionsResult, await generate(rule.id, { dueOn: '2031-09-15' })).suggested,
    ).toBe(0);
    expectError(await generate(randomUUID()), 404, 'NOT_FOUND');
    expectError(await generate(rule.id, {}, people.clientA), 403, 'FORBIDDEN');
    expectError(
      await call('post', '/compliance/suggestions', people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('does nothing for a rule that is switched off', async () => {
    const r = await mkRule({ name: `Off ${run}`, active: false });
    expectError(await generate(r.id), 409, 'RULE_INACTIVE');
  });

  it('makes the deadline at once for an APPLY rule, once per client, entry and date', async () => {
    const fl = await mkRule({ name: `Apply FL ${run}`, outcome: 'APPLY', states: ['FL'] });
    expect(exact(GenerateSuggestionsResult, await generate(fl.id))).toMatchObject({
      applied: 1,
      suggested: 0,
      needsReview: 1,
      alreadyDecided: 0,
    });
    const made = await asOwner(ids.firmA, (tx) =>
      tx.complianceDeadline.findMany({ where: { calendarEntryId: entry, clientId: s.c2 } }),
    );
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ source: 'GOVERNMENT', dueOverridden: false });
    const record = (await suggestions('?decision=CONFIRMED')).items.find(
      (i) => i.client.id === s.c2,
    )!;
    expect(record).toMatchObject({
      deadlineId: made[0]!.id,
      decidedBy: { userId: people.ownerA.id },
    });
    expect(exact(GenerateSuggestionsResult, await generate(fl.id))).toMatchObject({
      applied: 0,
      alreadyDecided: 2,
    });
    // Everyone else: c1 and c2 already have the deadline; c3 has no data a rule asks for.
    const all = await mkRule({ name: `Apply all ${run}`, outcome: 'APPLY' });
    expect(exact(GenerateSuggestionsResult, await generate(all.id))).toMatchObject({
      applied: 1,
      alreadyDecided: 2,
    });
    expect(
      await asOwner(ids.firmA, (tx) =>
        tx.complianceDeadline.count({ where: { calendarEntryId: entry } }),
      ),
    ).toBe(3);
    expect(await auditActions(made[0]!.id)).toEqual(['compliance.deadline.created']);
  });

  it("makes a recurring definition's deadline from its next date, with its task, assignee and reminders", async () => {
    const r = exact(
      ComplianceRecurrence,
      await call('post', '/compliance/recurrences', people.ownerA, {
        name: name('apply recurrence'),
        type: 'PAYROLL',
        frequency: 'ANNUAL',
        repeatRule: { month: 9, day: 1 },
        startOn: '2031-01-01',
        holidayRule: 'NEXT_BUSINESS_DAY',
        agency: 'IRS',
        createTask: true,
        taskTemplateId: s.tpl,
        assignedUserId: people.adminA.id,
        reminders: [{ daysBefore: 5, channels: ['EMAIL'] }],
      }),
      201,
    );
    const rr = exact(
      ComplianceApplicabilityRule,
      await call('post', '/compliance/applicability-rules', people.ownerA, {
        name: name('rule'),
        outcome: 'APPLY',
        states: ['GA'],
        target: { kind: 'RECURRENCE', id: r.id },
      }),
      201,
    );
    expect(rr.target).toMatchObject({ kind: 'RECURRENCE', id: r.id });
    expect(exact(GenerateSuggestionsResult, await generate(rr.id))).toMatchObject({
      dueOn: '2031-09-01',
      applied: 1,
    });
    const d = await asOwner(ids.firmA, (tx) =>
      tx.complianceDeadline.findFirstOrThrow({ where: { recurrenceId: r.id } }),
    );
    const detail = await get(d.id);
    expect(detail).toMatchObject({
      client: { id: s.c1 },
      source: 'FIRM',
      statutoryDueOn: '2031-09-01',
      dueOn: '2031-09-02',
      recurring: true,
      recurrence: { id: r.id },
      assignedTo: { userId: people.adminA.id },
      reminders: [{ daysBefore: 5, inApp: true, channels: ['EMAIL'] }],
    });
    expect(detail.tasks).toHaveLength(1);
    expect((await get(d.id)).applicabilityReason).toContain('applies');
    expect(
      exact(
        ComplianceRecurrence,
        await call('get', `/compliance/recurrences/${r.id}`, people.ownerA),
      ).deadlineCount,
    ).toBe(1);
  });

  it("is firm A's: firm B cannot read, change, evaluate or run its rules, nor confirm its suggestions", async () => {
    const b = (method: 'get' | 'post' | 'patch', path: string, body?: object) =>
      call(method, path, people.ownerB, body, ids.firmB);
    const some = (await suggestions('?decision=CONFIRMED')).items[0]!;
    for (const [method, path, body] of [
      ['get', `/compliance/applicability-rules/${rule.id}`],
      ['patch', `/compliance/applicability-rules/${rule.id}`, { name: 'Hacked' }],
      ['post', `/compliance/applicability-rules/${rule.id}/evaluate`],
      ['post', '/compliance/suggestions', { ruleId: rule.id }],
      ['post', `/compliance/suggestions/${some.id}/confirm`, {}],
      ['post', `/compliance/suggestions/${some.id}/dismiss`, { reason: 'X' }],
    ] as const) {
      expectError(await b(method, path, body as object | undefined), 404, 'NOT_FOUND');
    }
    expectError(
      await b('post', '/compliance/applicability-rules', {
        name: 'B',
        target: { kind: 'CALENDAR_ENTRY', id: entry },
      }),
      404,
      'NOT_FOUND',
    );
    expect(
      exact(ComplianceApplicabilityRulePage, await b('get', '/compliance/applicability-rules')),
    ).toMatchObject({ items: [], total: 0 });
    expect(
      exact(ComplianceSuggestionPage, await b('get', '/compliance/suggestions')),
    ).toMatchObject({ items: [], total: 0 });
    expect(exact(ComplianceLogPage, await b('get', '/compliance/logs?kind=GENERATE')).total).toBe(
      0,
    );
  });
});

describe('who sees what in firm B', () => {
  it("never shows firm A's deadlines, and A's deadlines are not reachable by id", async () => {
    const a = await mkDeadline({ name: `Only A ${run}` });
    const page = exact(
      ComplianceDeadlinePage,
      await call(
        'get',
        `/compliance/deadlines?search=${encodeURIComponent(`Only A ${run}`)}`,
        people.ownerB,
        undefined,
        ids.firmB,
      ),
    );
    expect(page.total).toBe(0);
    for (const path of [`/compliance/deadlines/${a.id}`]) {
      expectError(await call('get', path, people.ownerB, undefined, ids.firmB), 404, 'NOT_FOUND');
    }
    const b = exact(
      ComplianceDeadline,
      await call(
        'post',
        '/compliance/deadlines',
        people.ownerB,
        { clientId: s.b1, name: `Only B ${run}`, type: 'TAX_FILING', dueOn: plus(5) },
        ids.firmB,
      ),
      201,
    );
    expect(
      exact(
        ComplianceDeadlinePage,
        await call(
          'get',
          `/compliance/deadlines?search=${encodeURIComponent(`Only B ${run}`)}`,
          people.ownerA,
        ),
      ).total,
    ).toBe(0);
    // A's client in B's request, and B's record in A's.
    expectError(
      await call(
        'post',
        '/compliance/deadlines',
        people.ownerB,
        { clientId: s.c1, name: 'X', type: 'TAX_FILING', dueOn: plus(5) },
        ids.firmB,
      ),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/compliance/deadlines/${a.id}/links`, people.ownerA, {
        relatedDeadlineId: b.id,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/compliance/deadlines/${a.id}/documents`, people.ownerA, {
        documentId: randomUUID(),
      }),
      409,
      'NOT_THIS_CLIENTS',
    );
    expectError(
      await call('post', '/compliance/deadlines/bulk', people.ownerA, {
        ids: [a.id, b.id],
        action: 'ARCHIVE',
      }),
      404,
      'NOT_FOUND',
    );
    expect((await get(a.id)).archived).toBe(false);
  });
});
