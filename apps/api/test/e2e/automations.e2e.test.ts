// End-to-end: R55, Automations (contract in packages/types/src/automations): the catalog, rules
// with immutable versions, activation checks, dry runs that create nothing, templates, the run
// engine (idempotent runs and actions, delays, dependencies, the safety threshold), the logs with
// re-run and export, and the settings. Firm B sees none of firm A's. Nothing in an audit row or a
// log holds client data.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AutomationCatalog,
  AutomationConfirmationList,
  AutomationEventConfirmation,
  AutomationMatches,
  AutomationLogExport,
  AutomationOverview,
  AutomationPreview,
  AutomationRuleDetail,
  AutomationRulePage,
  AutomationRunDetail,
  AutomationRunPage,
  AutomationRunsSummary,
  AutomationSettingsView,
  AutomationStartersResult,
  AutomationTemplateDetail,
  AutomationTemplatePage,
  AutomationVersionDetail,
  INTAKE_FORMS,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { AUTOMATION_FILES, type AutomationFiles } from '../../src/automations/automation-files.js';
import { AutomationEngine, quietUntil } from '../../src/automations/engine.service.js';
import { attachProviderEvidence } from '../../src/automations/confirmations.service.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

class MemoryFiles implements AutomationFiles {
  readonly objects = new Map<string, Buffer>();
  put(key: string, bytes: Uint8Array) {
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }
  presignDownload(input: { key: string; fileName: string }) {
    return Promise.resolve(`memory:${input.key}?name=${encodeURIComponent(input.fileName)}`);
  }
}
const files = new MemoryFiles();
const outbox: NotifyMessage[] = [];

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55u-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  preparerA: person('preparer-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'c1' | 'c2' | 'cB', string>;
const ids = {} as { template: string; inactive: string };

let app: INestApplication;
let engine: AutomationEngine;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.59.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
// The test owner is a superuser in Docker and CI, so RLS does not narrow these reads: a count
// names its firm, or it also counts what other test files write at the same time.
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
    [method](`/api/v1/business/automations${path}`)
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
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;
const { ownerA, adminA, staffA, preparerA, ownerB } = people;

const DAY = 86_400_000;
// The firm's day (New York, the default zone), as the rules, the job and the runs filter use it:
// a UTC day is a day ahead from 00:00 to 04:00 or 05:00 UTC.
/** New York's day, moved by calendar days (never 24 hours: a clock change makes a day 23 or 25). */
const day = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  );
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// ---------- Definitions ----------

const note = (over: object = {}) => ({
  id: 'note',
  type: 'ADD_CLIENT_NOTE',
  config: { body: 'Hello {{client.name}}' },
  ...over,
});
const overdueInvoices = (actions: object[], over: object = {}) => ({
  trigger: { module: 'INVOICES_PAYMENTS', event: 'invoice.overdue' },
  actions,
  ...over,
});
const clientCreated = (actions: object[] = [note()], over: object = {}) => ({
  trigger: { module: 'CLIENTS', event: 'client.created' },
  actions,
  ...over,
});

const rule = async (id: string, who: Who = ownerA) =>
  AutomationRuleDetail.parse(ok(await call('get', `/rules/${id}`, who)));
const createRule = async (definition: object, over: object = {}, who: Who = ownerA) =>
  AutomationRuleDetail.parse(
    ok(
      await call('post', '/rules', who, {
        name: mark('Rule'),
        category: 'CLIENTS',
        definition,
        ...over,
      }),
      201,
    ),
  );
const activate = async (id: string, who: Who = ownerA) =>
  call('post', `/rules/${id}/activate`, who, {});
const runs = async (query = '', who: Who = ownerA) =>
  AutomationRunPage.parse(ok(await call('get', `/runs${query}`, who)));
const runDetail = async (id: string, who: Who = ownerA) =>
  AutomationRunDetail.parse(ok(await call('get', `/runs/${id}`, who)));

const auditRows = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55u ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55u-${key}-${run}`;
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
    ['a', preparerA.id, 'TAX_PREPARER'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    clients.c1 = (
      await tx.client.create({
        data: {
          businessId,
          displayName: 'Jamie Sample (fake)',
          email: `c1-${run}@client.test`,
          assignedUserId: staffA.id,
        },
        select: { id: true },
      })
    ).id;
    // A business client without an email address.
    clients.c2 = (
      await tx.client.create({
        data: { businessId, displayName: 'Riley Example (fake)', accountType: 'BUSINESS' },
        select: { id: true },
      })
    ).id;
    const invoice = async (
      clientId: string,
      number: string,
      cents: number,
      overdueDays: number,
    ) => {
      const inv = await tx.invoice.create({
        data: { businessId, clientId, number, dueOn: new Date(Date.now() - overdueDays * DAY) },
        select: { id: true },
      });
      await tx.invoiceLine.create({
        data: { businessId, invoiceId: inv.id, description: 'Fake', unitAmountCents: cents },
      });
      await tx.invoice.update({
        where: { id: inv.id },
        data: { status: 'OPEN', issuedAt: new Date() },
      });
    };
    await invoice(clients.c1, `INV-U-${run}-1`, 10_000, 10);
    await invoice(clients.c2, `INV-U-${run}-2`, 5_000, 2);
    ids.template = (
      await tx.messageTemplate.create({
        data: {
          businessId,
          kind: 'PORTAL_MESSAGE',
          name: `Fake follow-up ${run}`,
          subject: 'About {{record.label}}',
          body: 'Hello {{client.firstName}}, a note from {{firm.name}}.',
          status: 'ACTIVE',
          includeInAutomations: true,
          ownerUserId: ownerA.id,
        },
        select: { id: true },
      })
    ).id;
    ids.inactive = (
      await tx.messageTemplate.create({
        data: {
          businessId,
          kind: 'PORTAL_MESSAGE',
          name: `Fake draft ${run}`,
          body: 'Draft',
          status: 'DRAFT',
          ownerUserId: ownerA.id,
        },
        select: { id: true },
      })
    ).id;
  });
  await inFirm('b', async (tx) => {
    clients.cB = (
      await tx.client.create({
        data: { businessId: firms.b, displayName: 'Firm B Client (fake)' },
        select: { id: true },
      })
    ).id;
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(AUTOMATION_FILES)
    .useValue(files)
    // No mail server in tests: what Messages and the Notifier send is kept here.
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (m: NotifyMessage) => {
        outbox.push(m);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  engine = nest.get(AutomationEngine, { strict: false });
});

afterAll(async () => {
  await app.close();
});

const shared = {} as { r1: string; r2: string; starter: string };

describe('the catalog', () => {
  it('serves what a rule can start from and do, as data', async () => {
    const c = AutomationCatalog.parse(ok(await call('get', '/catalog', staffA)));
    expect(c.modules).toHaveLength(17);
    expect(c.events.map((e) => e.code)).toEqual(
      expect.arrayContaining([
        'client.created',
        'invoice.overdue',
        'deadline.approaching',
        'task.overdue',
        'appointment.upcoming',
      ]),
    );
    const invoice = c.events.find((e) => e.code === 'invoice.overdue');
    expect(invoice?.timings).toEqual(['IMMEDIATE', 'AFTER']);
    const total = invoice?.conditionFields.find((f) => f.field === 'totalCents');
    expect(total).toMatchObject({
      type: 'MONEY',
      operators: ['IS', 'GREATER_THAN', 'LESS_THAN', 'EXISTS'],
    });
    expect(
      invoice?.conditionFields.find((f) => f.field === 'clientType')?.options.map((o) => o.value),
    ).toEqual(['INDIVIDUAL', 'BUSINESS']);
    expect(c.actions.map((a) => a.type)).toEqual([
      'CREATE_TASK',
      'SEND_CLIENT_MESSAGE',
      'SEND_CLIENT_EMAIL',
      'SEND_CLIENT_SMS',
      'REQUEST_DOCUMENTS',
      'SEND_INTAKE',
      'ASSIGN_CLIENT',
      'UPDATE_CLIENT_STATUS',
      'UPDATE_CLIENT_PRIORITY',
      'ADD_CLIENT_TAGS',
      'REMOVE_CLIENT_TAGS',
      'CREATE_DEADLINE',
      'ADD_SERVICE',
      'SEND_RESOURCE',
      'INVITE_TO_BOOK',
      'SCHEDULE_LEAD_FOLLOW_UP',
      'REQUEST_APPROVAL',
      'ADD_CLIENT_NOTE',
      'NOTIFY_STAFF',
    ]);
    expect(c.actions.find((a) => a.type === 'SEND_CLIENT_MESSAGE')?.contactsClient).toBe(true);
    expect(c.variables.map((v) => v.key)).toContain('client.firstName');
    expectError(await call('get', '/catalog', undefined), 401, 'UNAUTHENTICATED');
  });
});

describe('rules and their versions', () => {
  it('saves a draft that may be incomplete, and refuses what the catalog does not have', async () => {
    const created = await createRule(clientCreated(), {
      name: mark('Welcome note'),
      description: 'Notes new clients (fake)',
      priority: 'HIGH',
      expiresOn: day(300),
    });
    shared.r1 = created.id;
    expect(created).toMatchObject({
      status: 'DRAFT',
      category: 'CLIENTS',
      priority: 'HIGH',
      currentVersion: 1,
      owner: { userId: ownerA.id },
      triggerSummary: 'New client added',
      appliesTo: 'All records',
      actionsSummary: 'Add client note',
      expiresOn: day(300),
      needsAttention: false,
      archived: false,
      canEdit: true,
      canActivate: true,
      activationBlockers: [],
    });
    expect(created.definition?.settings).toMatchObject({
      preventDuplicatesDays: 7,
      logAll: true,
      addToCalendar: false,
      quietHours: null,
      safetyThreshold: null,
    });
    expect(created.versions).toHaveLength(1);
    expect(created.stats).toEqual({ runs: 0, succeeded: 0, failed: 0, skipped: 0 });

    expectError(
      await call('post', '/rules', ownerA, {
        name: created.name.toUpperCase(),
        category: 'CLIENTS',
        definition: clientCreated(),
      }),
      409,
      'DUPLICATE_NAME',
    );
    const bad = async (definition: object, path: RegExp) => {
      const res = await call('post', '/rules', ownerA, {
        name: mark('Bad'),
        category: 'CLIENTS',
        definition,
      });
      expectError(res, 400, 'INVALID_DEFINITION');
      expect(JSON.stringify(res.body)).toMatch(path);
    };
    await bad(
      { trigger: { module: 'CLIENTS', event: 'client.deleted' }, actions: [note()] },
      /trigger\.event/,
    );
    await bad(
      { trigger: { module: 'TASKS', event: 'client.created' }, actions: [note()] },
      /trigger\.module/,
    );
    await bad(
      {
        trigger: {
          module: 'CLIENTS',
          event: 'client.created',
          timing: 'BEFORE',
          offsetValue: 1,
          offsetUnit: 'DAY',
        },
        actions: [note()],
      },
      /trigger\.timing/,
    );
    await bad(
      clientCreated([note()], { conditions: [{ field: 'shoeSize', operator: 'IS', value: 'x' }] }),
      /conditions\.0\.field/,
    );
    await bad(
      clientCreated([note()], {
        conditions: [{ field: 'source', operator: 'GREATER_THAN', value: 3 }],
      }),
      /conditions\.0\.operator/,
    );
    await bad(
      clientCreated([note()], {
        conditions: [{ field: 'clientType', operator: 'IS', value: 'ROBOT' }],
      }),
      /conditions\.0\.value/,
    );
    await bad(
      clientCreated([note()], {
        conditions: [{ field: 'source', operator: 'EXISTS', value: 'x' }],
      }),
      /conditions\.0\.value/,
    );
    await bad(clientCreated([note({ type: 'LAUNCH_ROCKET' })]), /actions\.0\.type/);
    await bad(
      clientCreated([note({ config: { body: 'x', colour: 'red' } })]),
      /actions\.0\.config\.colour/,
    );
    await bad(
      clientCreated([note({ config: { body: 'Hi {{client.ssn}}' } })]),
      /not an approved merge field/,
    );
    await bad(
      clientCreated([{ id: 't', type: 'CREATE_TASK', config: { title: 'x', priority: 'URGENT' } }]),
      /actions\.0\.config\.priority/,
    );
    await bad(clientCreated([note({ dependsOn: 'later' })]), /actions\.0\.dependsOn/);
    await bad(
      clientCreated([note()], { settings: { quietHours: { start: '09:00', end: '09:00' } } }),
      /quietHours/,
    );

    // The contract's own refusals (shape) are VALIDATION_FAILED.
    for (const body of [
      { name: mark('x'), category: 'CLIENTS', definition: clientCreated([]) },
      { name: mark('x'), category: 'CLIENTS', definition: clientCreated([note(), note()]) },
      { name: mark('x'), category: 'NOPE', definition: clientCreated() },
      { name: `a\u0000b`, category: 'CLIENTS', definition: clientCreated() },
      {
        name: mark('x'),
        category: 'CLIENTS',
        definition: clientCreated(),
        expiresOn: '0000-01-01',
      },
    ])
      expectError(await call('post', '/rules', ownerA, body), 400, 'VALIDATION_FAILED');

    // A draft may lack what activation needs; the blockers say what.
    const incomplete = await createRule(
      clientCreated([{ id: 'task', type: 'CREATE_TASK', config: {} }]),
      { name: mark('Incomplete') },
    );
    expect(incomplete.status).toBe('DRAFT');
    expect(incomplete.activationBlockers.join(' ')).toMatch(/Task title is required/);
    const blocked = await activate(incomplete.id);
    expectError(blocked, 409, 'NOT_READY');
    expect(JSON.stringify(blocked.body)).toMatch(/Task title is required/);
    expectError(
      await call('post', '/rules', ownerA, {
        name: mark('Active at once'),
        category: 'CLIENTS',
        definition: clientCreated([{ id: 'task', type: 'CREATE_TASK', config: {} }]),
        activate: true,
      }),
      409,
      'NOT_READY',
    );

    // Who may do it: a read-only role and the legacy Staff role read, but do not write.
    expectError(
      await call('post', '/rules', staffA, {
        name: mark('x'),
        category: 'CLIENTS',
        definition: clientCreated(),
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/rules', preparerA, {
        name: mark('x'),
        category: 'CLIENTS',
        definition: clientCreated(),
      }),
      403,
      'FORBIDDEN',
    );
    expect(
      AutomationRulePage.parse(ok(await call('get', '/rules', staffA))).total,
    ).toBeGreaterThanOrEqual(2);
    expectError(
      await call('post', '/rules', ownerA, {
        name: mark('x'),
        category: 'CLIENTS',
        definition: clientCreated(),
        ownerUserId: staffA.id,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/rules', ownerA, {
        name: mark('x'),
        category: 'CLIENTS',
        definition: clientCreated(),
        ownerUserId: ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('post', '/rules', ownerA, {
        name: mark('x'),
        category: 'CLIENTS',
        definition: clientCreated([note()], { settings: { notifyOnFailureUserIds: [ownerB.id] } }),
      }),
      409,
      'NOT_A_MEMBER',
    );
    expect(JSON.stringify(await auditRows(created.id))).not.toContain('Hello');
  });

  it('makes a new version for every saved definition, and never changes an old one', async () => {
    const id = shared.r1;
    const first = await rule(id);
    const v2 = AutomationRuleDetail.parse(
      ok(
        await call('put', `/rules/${id}/definition`, ownerA, {
          etag: first.etag,
          definition: clientCreated([note({ config: { body: 'Second wording' } })], {
            conditions: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }],
            settings: {
              preventDuplicatesDays: 30,
              quietHours: { start: '21:00', end: '07:00' },
              safetyThreshold: 50,
            },
          }),
        }),
      ),
    );
    expect(v2.currentVersion).toBe(2);
    expect(v2.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(v2.appliesTo).toBe('Client type is Business');
    expect(v2.definition?.settings).toMatchObject({
      preventDuplicatesDays: 30,
      quietHours: { start: '21:00', end: '07:00' },
      safetyThreshold: 50,
    });
    expectError(
      await call('put', `/rules/${id}/definition`, ownerA, {
        etag: first.etag,
        definition: clientCreated(),
      }),
      409,
      'SAVE_CONFLICT',
    );
    const old = AutomationVersionDetail.parse(
      ok(await call('get', `/rules/${id}/versions/1`, ownerA)),
    );
    expect(old.definition.actions[0]?.config.body).toBe('Hello {{client.name}}');
    expect(old.definition.conditions).toEqual([]);
    expect(
      AutomationVersionDetail.parse(ok(await call('get', `/rules/${id}/versions/2`, staffA)))
        .definition.settings.preventDuplicatesDays,
    ).toBe(30);
    expectError(await call('get', `/rules/${id}/versions/9`, ownerA), 404, 'NOT_FOUND');

    // The change of name and the like is not a new version; it needs the current etag.
    const renamed = AutomationRuleDetail.parse(
      ok(
        await call('patch', `/rules/${id}`, ownerA, {
          etag: v2.etag,
          name: mark('Renamed'),
          priority: 'LOW',
          ownerUserId: adminA.id,
        }),
      ),
    );
    expect(renamed).toMatchObject({
      currentVersion: 2,
      priority: 'LOW',
      owner: { userId: adminA.id },
    });
    expectError(
      await call('patch', `/rules/${id}`, ownerA, { etag: v2.etag, name: 'late' }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('patch', `/rules/${id}`, ownerA, { etag: renamed.etag }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('get', `/rules/${id}`, ownerB, undefined, 'b'), 404, 'NOT_FOUND');
    expect(
      AutomationRulePage.parse(ok(await call('get', '/rules', ownerB, undefined, 'b'))).total,
    ).toBe(0);
    expectError(await call('get', '/rules/not-a-uuid', ownerA), 400, 'VALIDATION_FAILED');
  });

  it('lists rules with filters and sorting', async () => {
    const all = AutomationRulePage.parse(ok(await call('get', `/rules?search=${run}`, ownerA)));
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(
      AutomationRulePage.parse(ok(await call('get', `/rules?search=${run}&status=ACTIVE`, ownerA)))
        .total,
    ).toBe(0);
    expect(
      AutomationRulePage.parse(
        ok(await call('get', `/rules?search=${run}&sort=name&direction=asc`, ownerA)),
      ).items.map((r) => r.name),
    ).toEqual([...all.items.map((r) => r.name)].sort());
    expect(
      AutomationRulePage.parse(
        ok(await call('get', `/rules?ownerUserId=${adminA.id}`, ownerA)),
      ).items.map((r) => r.id),
    ).toContain(shared.r1);
    expect(
      AutomationRulePage.parse(
        ok(await call('get', '/rules?needsAttention=true', ownerA)),
      ).items.every((r) => r.needsAttention),
    ).toBe(true);
    expect(
      AutomationRulePage.parse(ok(await call('get', '/rules?pageSize=1&page=2', ownerA))),
    ).toMatchObject({ page: 2, pageSize: 1 });
    expectError(await call('get', '/rules?status=NOPE', ownerA), 400, 'VALIDATION_FAILED');
  });
});

describe('activation, pausing and copies', () => {
  it('activates only a rule whose checks pass, and tells which check blocks', async () => {
    const missing = await createRule(
      clientCreated([
        { id: 'msg', type: 'SEND_CLIENT_MESSAGE', config: { templateId: randomUUID() } },
      ]),
      { name: mark('Missing template') },
    );
    const res = await activate(missing.id);
    expectError(res, 409, 'NOT_READY');
    expect(JSON.stringify(res.body)).toMatch(/template was not found/);
    // A template not offered to Automations is a warning, not a block.
    const draftTemplate = await createRule(
      clientCreated([
        { id: 'msg', type: 'SEND_CLIENT_MESSAGE', config: { templateId: ids.inactive } },
      ]),
      { name: mark('Inactive template') },
    );
    expect(draftTemplate.activationBlockers).toEqual([]);
    // A rule whose owner may not act in the module.
    const noBody = await createRule(
      clientCreated([{ id: 'msg', type: 'SEND_CLIENT_MESSAGE', config: {} }]),
      {
        name: mark('No words'),
      },
    );
    expect(noBody.activationBlockers.join(' ')).toMatch(/template or write the message/);
    // A rule that would start itself.
    const loop = await createRule(
      {
        trigger: { module: 'TASKS', event: 'task.overdue' },
        actions: [{ id: 't', type: 'CREATE_TASK', config: { title: 'Again' } }],
      },
      { name: mark('Loop'), category: 'TASKS' },
    );
    const loopRes = await activate(loop.id);
    expectError(loopRes, 409, 'NOT_READY');
    expect(JSON.stringify(loopRes.body)).toMatch(/start itself/);
    const fine = await createRule(
      {
        trigger: { module: 'TASKS', event: 'task.overdue' },
        actions: [{ id: 't', type: 'CREATE_TASK', config: { title: 'Once', dueInDays: 7 } }],
      },
      { name: mark('No loop'), category: 'TASKS' },
    );
    expect((await rule(fine.id)).activationBlockers).toEqual([]);
    // A rule past its date.
    const expired = await createRule(clientCreated(), {
      name: mark('Expired'),
      expiresOn: day(-1),
    });
    expect(expired.activationBlockers.join(' ')).toMatch(/end date has passed/);

    // Activate, then a new version of an active rule is checked as for activation.
    const ok1 = await createRule(clientCreated(), { name: mark('Goes live') });
    shared.r2 = ok1.id;
    expect(AutomationRuleDetail.parse(ok(await activate(ok1.id)))).toMatchObject({
      status: 'ACTIVE',
      currentVersion: 1,
    });
    expectError(
      await call('put', `/rules/${ok1.id}/definition`, ownerA, {
        etag: (await rule(ok1.id)).etag,
        definition: clientCreated([{ id: 'task', type: 'CREATE_TASK', config: {} }]),
      }),
      409,
      'NOT_READY',
    );
    expectError(await activate(ok1.id, staffA), 403, 'FORBIDDEN');
    expect(AutomationRuleDetail.parse(ok(await activate(ok1.id))).status).toBe('ACTIVE');
    expectError(
      await call('post', `/rules/${ok1.id}/activate`, ownerA, { etag: '2000-01-01T00:00:00.000Z' }),
      409,
      'SAVE_CONFLICT',
    );
  });

  it('pauses, copies, archives and restores', async () => {
    const id = shared.r2;
    expect(
      AutomationRuleDetail.parse(
        ok(await call('post', `/rules/${id}/pause`, ownerA, { scheduledActions: 'CANCEL' })),
      ).status,
    ).toBe('PAUSED');
    expect(
      AutomationRuleDetail.parse(ok(await call('post', `/rules/${id}/pause`, ownerA, {}))).status,
    ).toBe('PAUSED');
    expect(AutomationRuleDetail.parse(ok(await activate(id))).status).toBe('ACTIVE');
    expectError(await call('post', `/rules/${shared.r1}/pause`, ownerA, {}), 409, 'INVALID_STATUS');
    expectError(
      await call('post', `/rules/${id}/pause`, ownerA, { scheduledActions: 'LATER' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('post', `/rules/${id}/pause`, preparerA, {}), 403, 'FORBIDDEN');

    const copy = AutomationRuleDetail.parse(
      ok(await call('post', `/rules/${id}/duplicate`, ownerA), 201),
    );
    expect(copy).toMatchObject({ status: 'DRAFT', currentVersion: 1, stats: { runs: 0 } });
    expect(copy.name).toMatch(/\(copy\)$/);
    const copy2 = AutomationRuleDetail.parse(
      ok(await call('post', `/rules/${id}/duplicate`, ownerA), 201),
    );
    expect(copy2.name).toMatch(/\(copy 2\)$/);

    const archived = AutomationRuleDetail.parse(
      ok(await call('post', `/rules/${copy.id}/archive`, ownerA)),
    );
    expect(archived).toMatchObject({ status: 'ARCHIVED', archived: true, canEdit: false });
    expectError(
      await call('patch', `/rules/${copy.id}`, ownerA, { etag: archived.etag, name: 'x' }),
      409,
      'RULE_ARCHIVED',
    );
    expectError(await activate(copy.id), 409, 'RULE_ARCHIVED');
    expect(
      AutomationRulePage.parse(ok(await call('get', `/rules?search=${run}`, ownerA))).items.map(
        (r) => r.id,
      ),
    ).not.toContain(copy.id);
    expect(
      AutomationRulePage.parse(
        ok(await call('get', `/rules?search=${run}&includeArchived=true`, ownerA)),
      ).items.map((r) => r.id),
    ).toContain(copy.id);
    // Restoring needs the name to be free.
    await call('patch', `/rules/${copy2.id}`, ownerA, { etag: copy2.etag, name: copy.name });
    expectError(await call('post', `/rules/${copy.id}/restore`, ownerA), 409, 'DUPLICATE_NAME');
    await call('patch', `/rules/${copy2.id}`, ownerA, {
      etag: (await rule(copy2.id)).etag,
      name: mark('Moved on'),
    });
    expect(
      AutomationRuleDetail.parse(ok(await call('post', `/rules/${copy.id}/restore`, ownerA)))
        .status,
    ).toBe('DRAFT');
    const actions = (await auditRows(id)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'automation_rule.created',
        'automation_rule.activated',
        'automation_rule.paused',
      ]),
    );
  });
});

describe('dry runs', () => {
  it('count and sample what a rule would act on, create nothing, and say what is wrong', async () => {
    const runsBefore = await inFirm('a', (tx) =>
      tx.automationRun.count({ where: { businessId: firms.a } }),
    );
    const tasksBefore = await inFirm('a', (tx) =>
      tx.task.count({ where: { businessId: firms.a } }),
    );
    const validate = async (definition: object) =>
      AutomationPreview.parse(ok(await call('post', '/rules/validate', ownerA, { definition })));
    const task = {
      id: 'follow',
      type: 'CREATE_TASK',
      config: { title: 'Follow up {{record.label}}' },
    };

    const all = await validate(overdueInvoices([task]));
    expect(all.matchCount).toBe(2);
    expect(all.sample.map((s) => s.label).sort()).toEqual([`INV-U-${run}-1`, `INV-U-${run}-2`]);
    expect(all.sample.find((s) => s.label.endsWith('-1'))).toMatchObject({
      recordKind: 'invoice',
      client: { id: clients.c1, name: 'Jamie Sample (fake)' },
    });
    expect(all.plannedActions).toEqual([
      {
        id: 'follow',
        type: 'CREATE_TASK',
        label: 'Create task',
        delayMinutes: 0,
        summary: 'Create task, right away',
      },
    ]);
    expect(all.triggerPreview).toMatch(/Invoice overdue/);
    expect(all.canActivate).toBe(true);
    expect(all.integrations).toEqual([]);

    expect(
      (
        await validate(
          overdueInvoices([task], {
            conditions: [{ field: 'totalCents', operator: 'GREATER_THAN', value: 6_000 }],
          }),
        )
      ).matchCount,
    ).toBe(1);
    expect(
      (
        await validate(
          overdueInvoices([task], {
            conditions: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }],
          }),
        )
      ).sample.map((s) => s.client?.id),
    ).toEqual([clients.c2]);
    expect(
      (
        await validate(
          overdueInvoices([task], {
            matchMode: 'ANY',
            conditions: [
              { field: 'clientType', operator: 'IS', value: 'BUSINESS' },
              { field: 'daysOverdue', operator: 'GREATER_THAN', value: 5 },
            ],
          }),
        )
      ).matchCount,
    ).toBe(2);
    // Three days after: only the invoice that is ten days overdue.
    const after = await validate({
      trigger: {
        module: 'INVOICES_PAYMENTS',
        event: 'invoice.overdue',
        timing: 'AFTER',
        offsetValue: 3,
        offsetUnit: 'DAY',
      },
      actions: [task],
    });
    expect(after.matchCount).toBe(1);
    expect(after.sample[0]?.client?.id).toBe(clients.c1);
    expect(
      (await validate(overdueInvoices([task, task].map((t, i) => ({ ...t, id: `a${i}` })))))
        .plannedActions,
    ).toHaveLength(2);

    // Warnings: no match, and a client with no email behind a message.
    const none = await validate(
      clientCreated([note()], {
        conditions: [{ field: 'source', operator: 'IS', value: 'nowhere' }],
      }),
    );
    expect(none.checks.map((c) => c.code)).toContain('NO_MATCHES');
    const message = await validate(
      overdueInvoices([
        { id: 'msg', type: 'SEND_CLIENT_MESSAGE', config: { body: 'Hi {{client.firstName}}' } },
      ]),
    );
    expect(message.checks.find((c) => c.code === 'BAD_CONTACT_DATA')).toMatchObject({
      severity: 'WARN',
    });
    expect(message.canActivate).toBe(true);
    const templated = await validate(
      overdueInvoices([
        { id: 'msg', type: 'SEND_CLIENT_MESSAGE', config: { templateId: ids.template } },
      ]),
    );
    expect(templated.templates).toEqual([
      { id: ids.template, name: `Fake follow-up ${run}`, kind: 'PORTAL_MESSAGE', active: true },
    ]);
    const missing = await validate(
      overdueInvoices([
        { id: 'msg', type: 'SEND_CLIENT_MESSAGE', config: { templateId: randomUUID() } },
      ]),
    );
    expect(missing.canActivate).toBe(false);
    expect(missing.checks.find((c) => c.code === 'MISSING_TEMPLATE')).toMatchObject({
      severity: 'BLOCK',
      path: 'actions.0.config.templateId',
    });
    const high = await validate(overdueInvoices([task], { settings: { safetyThreshold: 1 } }));
    expect(high.checks.map((c) => c.code)).toContain('HIGH_VOLUME');
    expect((await validate(overdueInvoices([task]))).sample.length).toBe(2);

    // A saved rule is tested the same way, for a version; sample sizes are honoured.
    const saved = await createRule(overdueInvoices([task]), {
      name: mark('To test'),
      category: 'INVOICES_PAYMENTS',
    });
    const tested = AutomationPreview.parse(
      ok(await call('post', `/rules/${saved.id}/test`, ownerA, { sample: 1 })),
    );
    expect(tested).toMatchObject({ matchCount: 2 });
    expect(tested.sample).toHaveLength(1);
    expect(
      AutomationPreview.parse(
        ok(await call('post', `/rules/${saved.id}/test`, ownerA, { version: 1, sample: 0 })),
      ).sample,
    ).toEqual([]);
    expectError(
      await call('post', `/rules/${saved.id}/test`, ownerA, { version: 7 }),
      404,
      'NOT_FOUND',
    );
    expectError(await call('post', `/rules/${saved.id}/test`, ownerB, {}, 'b'), 404, 'NOT_FOUND');
    expectError(
      await call('post', '/rules/validate', staffA, { definition: clientCreated() }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/rules/validate', ownerA, {
        definition: { ...clientCreated(), trigger: { module: 'CLIENTS', event: 'x.y' } },
      }),
      400,
      'INVALID_DEFINITION',
    );

    // Nothing was made or sent.
    expect(
      await inFirm('a', (tx) => tx.automationRun.count({ where: { businessId: firms.a } })),
    ).toBe(runsBefore);
    expect(await inFirm('a', (tx) => tx.task.count({ where: { businessId: firms.a } }))).toBe(
      tasksBefore,
    );
    expect(
      await inFirm('a', (tx) => tx.messageThread.count({ where: { businessId: firms.a } })),
    ).toBe(0);
  });
});

describe('the run engine', () => {
  const taskOf = (title: string) =>
    inFirm('a', (tx) => tx.task.findMany({ where: { title: { contains: title } } }));
  const noteCount = () => inFirm('a', (tx) => tx.note.count({ where: { clientId: clients.c1 } }));

  it('starts one run per record and occurrence, runs its actions in order once, and records them', async () => {
    const title = `Follow up ${run}`;
    const live = await createRule(
      overdueInvoices(
        [
          {
            id: 'task',
            type: 'CREATE_TASK',
            config: {
              title: `${title} {{record.label}} for {{client.name}}`,
              priority: 'HIGH',
              dueInDays: 2,
            },
          },
          {
            id: 'note',
            type: 'ADD_CLIENT_NOTE',
            config: { body: 'Task made for {{record.label}}' },
            dependsOn: 'task',
          },
        ],
        {
          trigger: {
            module: 'INVOICES_PAYMENTS',
            event: 'invoice.overdue',
            timing: 'AFTER',
            offsetValue: 3,
            offsetUnit: 'DAY',
          },
        },
      ),
      { name: mark('Overdue follow-up'), category: 'INVOICES_PAYMENTS' },
    );
    expect(AutomationRuleDetail.parse(ok(await activate(live.id))).status).toBe('ACTIVE');
    const notesBefore = await noteCount();

    const first = await engine.scanRule(firms.a, live.id);
    expect(first).toMatchObject({ started: 1, stopped: false });
    const page = await runs(`?ruleId=${live.id}`);
    expect(page.total).toBe(1);
    const row = page.items[0]!;
    expect(row).toMatchObject({
      status: 'SUCCESS',
      ruleVersion: 1,
      triggerModule: 'INVOICES_PAYMENTS',
      recordKind: 'invoice',
      client: { id: clients.c1 },
      actionCount: 2,
      actionsSucceeded: 2,
      actionsFailed: 0,
      dryRun: false,
    });
    expect(row.trigger).toMatch(/Invoice overdue: 3 days after/);

    // The task and the note are the other modules' own, made as the rule's owner.
    const [task] = await taskOf(title);
    expect(task).toMatchObject({
      clientId: clients.c1,
      title: `${title} INV-U-${run}-1 for Jamie Sample (fake)`,
      priority: 'HIGH',
      createdByUserId: ownerA.id,
      assignedUserId: staffA.id,
      dueOn: new Date(`${day(2)}T00:00:00.000Z`),
    });
    expect(await noteCount()).toBe(notesBefore + 1);

    const detail = await runDetail(row.id);
    expect(detail.actions.map((a) => [a.actionKey, a.status, a.attempts, a.result?.kind])).toEqual([
      ['task', 'SUCCESS', 1, 'task'],
      ['note', 'SUCCESS', 1, 'note'],
    ]);
    expect(detail.actions[0]?.result?.id).toBe(task?.id);
    expect(detail).toMatchObject({
      error: null,
      depth: 0,
      parentRunId: null,
      ruleChanged: false,
      canRerun: false,
      retryableActionKeys: [],
      rerun: { count: 0, lastAt: null },
    });
    expect(detail.sourceEventKey).toMatch(/^invoice\.overdue:/);
    expect(detail.ruleSnapshot.actions.map((a) => a.id)).toEqual(['task', 'note']);
    expect(detail.related.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['invoice', 'task', 'note']),
    );

    // The same event again starts nothing, and no action is repeated.
    const second = await engine.scanRule(firms.a, live.id);
    expect(second).toMatchObject({ started: 0, duplicates: 1 });
    expect((await taskOf(title)).length).toBe(1);
    expect(await noteCount()).toBe(notesBefore + 1);

    // Editing the rule never rewrites the run.
    await call('put', `/rules/${live.id}/definition`, ownerA, {
      etag: (await rule(live.id)).etag,
      definition: overdueInvoices([
        { id: 'task', type: 'CREATE_TASK', config: { title: 'Changed' } },
      ]),
    });
    const after = await runDetail(row.id);
    expect(after.ruleChanged).toBe(true);
    expect(after.ruleSnapshot.actions.map((a) => a.id)).toEqual(['task', 'note']);
    expect(after.ruleVersion).toBe(1);
    const stats = (await rule(live.id)).stats;
    expect(stats).toMatchObject({ runs: 1, succeeded: 1, failed: 0 });
    expect((await rule(live.id)).lastRunAt).not.toBeNull();
    expect((await rule(live.id)).versions.find((v) => v.version === 1)?.runCount).toBe(1);

    const rows = JSON.stringify(await auditRows(live.id)) + JSON.stringify(await auditRows(row.id));
    expect(rows).not.toMatch(/Jamie|INV-U|Follow up/);
    shared.r2 = live.id;
  });

  it('waits for a delay, and honours quiet hours', async () => {
    const delayed = await createRule(
      overdueInvoices(
        [
          { id: 'now', type: 'ADD_CLIENT_NOTE', config: { body: 'Right away' } },
          {
            id: 'later',
            type: 'ADD_CLIENT_NOTE',
            config: { body: 'An hour on' },
            delayMinutes: 60,
            dependsOn: 'now',
          },
        ],
        { conditions: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }] },
      ),
      { name: mark('Delayed'), category: 'INVOICES_PAYMENTS' },
    );
    await activate(delayed.id);
    const start = new Date();
    await engine.scanRule(firms.a, delayed.id, start);
    let r = (await runs(`?ruleId=${delayed.id}`)).items[0]!;
    expect(r.status).toBe('RUNNING');
    expect(r.actionsSucceeded).toBe(1);
    expect(await runs(`?ruleId=${delayed.id}&tab=pending`)).toMatchObject({ total: 1 });
    const waiting = await runDetail(r.id);
    expect(waiting.actions[1]).toMatchObject({ status: 'PENDING' });
    expect(Date.parse(waiting.actions[1]?.scheduledFor ?? '')).toBeGreaterThanOrEqual(
      start.getTime() + 59 * 60_000,
    );
    // Not yet: nothing runs.
    expect(await engine.runDue(firms.a, new Date(start.getTime() + 30 * 60_000))).toBe(0);
    // An hour on, it runs.
    await engine.runDue(firms.a, new Date(start.getTime() + 61 * 60_000));
    r = (await runs(`?ruleId=${delayed.id}`)).items[0]!;
    expect(r.status).toBe('SUCCESS');
    expect(await runs(`?ruleId=${delayed.id}&tab=success`)).toMatchObject({ total: 1 });

    // Paused with CANCEL, a waiting action is skipped.
    const again = await createRule(
      overdueInvoices(
        [{ id: 'later', type: 'ADD_CLIENT_NOTE', config: { body: 'Never' }, delayMinutes: 120 }],
        {
          conditions: [{ field: 'clientType', operator: 'IS', value: 'INDIVIDUAL' }],
        },
      ),
      { name: mark('Cancelled wait'), category: 'INVOICES_PAYMENTS' },
    );
    await activate(again.id);
    await engine.scanRule(firms.a, again.id);
    const queued = (await runs(`?ruleId=${again.id}`)).items[0]!;
    expect(queued.status).toBe('PENDING');
    await call('post', `/rules/${again.id}/pause`, ownerA, { scheduledActions: 'CANCEL' });
    const cancelled = await runDetail(queued.id);
    expect(cancelled.status).toBe('SKIPPED');
    expect(cancelled.actions[0]).toMatchObject({
      status: 'SKIPPED',
      detail: 'The rule was paused',
    });

    // Quiet hours between 21:00 and 07:00 in the firm's zone end at 07:00.
    const q = { start: '21:00', end: '07:00' };
    expect(quietUntil(new Date('2026-07-01T14:00:00Z'), 'America/New_York', q)).toBeNull();
    expect(quietUntil(new Date('2026-07-01T03:00:00Z'), 'America/New_York', q)?.toISOString()).toBe(
      '2026-07-01T11:00:00.000Z',
    );
    expect(quietUntil(new Date('2026-07-01T02:00:00Z'), 'America/New_York', q)?.toISOString()).toBe(
      '2026-07-01T11:00:00.000Z',
    );
    expect(quietUntil(new Date('2026-07-01T14:00:00Z'), 'America/New_York', null)).toBeNull();
    expect(
      quietUntil(new Date('2026-07-01T16:00:00Z'), 'America/New_York', {
        start: '09:00',
        end: '17:00',
      })?.toISOString(),
    ).toBe('2026-07-01T21:00:00.000Z');
  });

  it('fails an action for a reason a retry cannot fix, and stops a rule that would act on too much', async () => {
    const noEmail = await createRule(
      overdueInvoices(
        [{ id: 'msg', type: 'SEND_CLIENT_MESSAGE', config: { body: 'Hi {{client.firstName}}' } }],
        {
          conditions: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }],
        },
      ),
      { name: mark('No email'), category: 'INVOICES_PAYMENTS' },
    );
    await activate(noEmail.id);
    await engine.scanRule(firms.a, noEmail.id);
    const failed = (await runs(`?ruleId=${noEmail.id}&tab=failed`)).items[0]!;
    expect(failed).toMatchObject({ status: 'FAILED', actionsFailed: 1 });
    const detail = await runDetail(failed.id);
    expect(detail.error).toMatchObject({ code: 'NO_CONTACT' });
    expect(detail.error?.remediation).toMatch(/email address/);
    expect(detail.actions[0]).toMatchObject({
      status: 'FAILED',
      retryable: false,
      errorCode: 'NO_CONTACT',
    });
    expect(detail.retryableActionKeys).toEqual([]);
    expect(detail.canRerun).toBe(false);
    expectError(
      await call('post', `/runs/${failed.id}/rerun`, ownerA, { reason: 'Try again' }),
      409,
      'RERUN_NOT_ALLOWED',
    );
    expect(
      await inFirm('a', (tx) => tx.messageThread.count({ where: { businessId: firms.a } })),
    ).toBe(0);

    // A dependent action is skipped when the one before it failed.
    const chain = await createRule(
      overdueInvoices(
        [
          { id: 'msg', type: 'SEND_CLIENT_MESSAGE', config: { body: 'Hi' } },
          { id: 'note', type: 'ADD_CLIENT_NOTE', config: { body: 'Sent' }, dependsOn: 'msg' },
        ],
        { conditions: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }] },
      ),
      { name: mark('Chain'), category: 'INVOICES_PAYMENTS' },
    );
    await activate(chain.id);
    await engine.scanRule(firms.a, chain.id);
    const chained = await runDetail((await runs(`?ruleId=${chain.id}`)).items[0]!.id);
    expect(chained.actions.map((a) => a.status)).toEqual(['FAILED', 'SKIPPED']);
    expect(chained.status).toBe('FAILED');

    // More matches than the threshold: nothing runs, and it is audited.
    const wide = await createRule(overdueInvoices([note()], { settings: { safetyThreshold: 1 } }), {
      name: mark('Too wide'),
      category: 'INVOICES_PAYMENTS',
    });
    await activate(wide.id);
    expect(await engine.scanRule(firms.a, wide.id)).toMatchObject({ started: 0, stopped: true });
    expect((await runs(`?ruleId=${wide.id}`)).total).toBe(0);
    expect((await auditRows(wide.id)).map((r) => r.action)).toContain(
      'automation_rule.safety_stop',
    );

    // A rule past its date is paused by the job.
    const old = await createRule(clientCreated(), { name: mark('Old'), expiresOn: day(5) });
    await activate(old.id);
    await inFirm('a', (tx) =>
      tx.automationRule.update({
        where: { id: old.id },
        data: { expiresOn: new Date(`${day(-1)}T00:00:00.000Z`) },
      }),
    );
    expect((await engine.scanFirm(firms.a)).expired).toBeGreaterThanOrEqual(1);
    expect((await rule(old.id)).status).toBe('PAUSED');
  });
});

describe('re-run, logs and export', () => {
  it('retries only the failed, retryable actions, with a reason, and never repeats a success', async () => {
    const live = await createRule(
      clientCreated([note({ id: 'a' }), note({ id: 'b', config: { body: 'Second' } })]),
      {
        name: mark('Retry'),
      },
    );
    const version = await inFirm('a', (tx) =>
      tx.automationRuleVersion.findFirstOrThrow({ where: { ruleId: live.id } }),
    );
    const now = new Date();
    const seeded = await inFirm('a', async (tx) => {
      const r = await tx.automationRun.create({
        data: {
          businessId: firms.a,
          ruleId: live.id,
          ruleVersionId: version.id,
          status: 'PARTIAL_SUCCESS',
          sourceModule: 'CLIENTS',
          sourceEventKey: `client.created:${clients.c1}:created`,
          clientId: clients.c1,
          recordKind: 'client',
          recordId: clients.c1,
          correlationId: randomUUID(),
          startedAt: now,
          finishedAt: now,
          errorCode: 'ACTION_ERROR',
          message: 'An action failed',
        },
      });
      const e = (key: string, position: number, status: 'SUCCESS' | 'FAILED') =>
        tx.automationActionExecution.create({
          data: {
            businessId: firms.a,
            runId: r.id,
            actionKey: key,
            position,
            actionType: 'ADD_CLIENT_NOTE',
            status,
            idempotencyKey: randomUUID(),
            finishedAt: now,
            attempts: 1,
            ...(status === 'FAILED'
              ? { errorCode: 'ACTION_ERROR', retryable: true, detail: 'It failed' }
              : {}),
            ...(status === 'SUCCESS' ? { resultKind: 'note', resultId: randomUUID() } : {}),
          },
        });
      await e('a', 0, 'SUCCESS');
      await e('b', 1, 'FAILED');
      return r.id;
    });
    const before = await runDetail(seeded);
    expect(before).toMatchObject({
      status: 'PARTIAL_SUCCESS',
      retryableActionKeys: ['b'],
      canRerun: true,
    });
    expect(before.error).toMatchObject({ code: 'ACTION_ERROR' });
    const notes = () =>
      inFirm('a', (tx) => tx.note.count({ where: { clientId: clients.c1, body: 'Second' } }));

    expectError(await call('post', `/runs/${seeded}/rerun`, ownerA, {}), 400, 'VALIDATION_FAILED');
    expectError(
      await call('post', `/runs/${seeded}/rerun`, staffA, { reason: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/runs/${seeded}/rerun`, ownerA, { reason: 'x', actionKeys: ['a'] }),
      409,
      'RERUN_NOT_ALLOWED',
    );
    expectError(
      await call('post', `/runs/${seeded}/rerun`, ownerA, { reason: 'x', force: true }, 'b'),
      404,
      'NOT_FOUND',
    );
    // The rule changed since: confirm first.
    await call('put', `/rules/${live.id}/definition`, ownerA, {
      etag: (await rule(live.id)).etag,
      definition: clientCreated([note({ id: 'a' }), note({ id: 'b', config: { body: 'Second' } })]),
    });
    expectError(
      await call('post', `/runs/${seeded}/rerun`, ownerA, { reason: 'Try again' }),
      409,
      'RERUN_NOT_ALLOWED',
    );
    const reason = 'The client record is fixed now (fake)';
    const done = AutomationRunDetail.parse(
      ok(await call('post', `/runs/${seeded}/rerun`, ownerA, { reason, confirmRuleChanged: true })),
    );
    expect(done.status).toBe('SUCCESS');
    expect(done.rerun).toMatchObject({
      count: 1,
      lastReason: reason,
      lastBy: { userId: ownerA.id },
    });
    expect(done.rerun.lastAt).not.toBeNull();
    expect(done.actions.map((a) => [a.actionKey, a.status, a.attempts])).toEqual([
      ['a', 'SUCCESS', 1],
      ['b', 'SUCCESS', 2],
    ]);
    expect(await notes()).toBe(1);
    expect(done.retryableActionKeys).toEqual([]);
    expect(JSON.stringify(await auditRows(seeded))).toContain(reason);
    expectError(
      await call('post', `/runs/${seeded}/rerun`, ownerA, {
        reason: 'Again',
        confirmRuleChanged: true,
      }),
      409,
      'RERUN_NOT_ALLOWED',
    );
    expect(await notes()).toBe(1);

    // A record that no longer matches: the failed action is skipped unless an Automation Admin forces it.
    const picky = await createRule(
      clientCreated([note({ id: 'a' })], {
        conditions: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }],
      }),
      {
        name: mark('Picky'),
      },
    );
    const pv = await inFirm('a', (tx) =>
      tx.automationRuleVersion.findFirstOrThrow({ where: { ruleId: picky.id } }),
    );
    const seed2 = async () =>
      inFirm('a', async (tx) => {
        const r = await tx.automationRun.create({
          data: {
            businessId: firms.a,
            ruleId: picky.id,
            ruleVersionId: pv.id,
            status: 'FAILED',
            sourceModule: 'CLIENTS',
            sourceEventKey: `client.created:${clients.c1}:${randomUUID()}`,
            clientId: clients.c1,
            recordKind: 'client',
            recordId: clients.c1,
            correlationId: randomUUID(),
            startedAt: now,
            finishedAt: now,
            errorCode: 'ACTION_ERROR',
            message: 'An action failed',
          },
        });
        await tx.automationActionExecution.create({
          data: {
            businessId: firms.a,
            runId: r.id,
            actionKey: 'a',
            position: 0,
            actionType: 'ADD_CLIENT_NOTE',
            status: 'FAILED',
            idempotencyKey: randomUUID(),
            finishedAt: now,
            attempts: 1,
            errorCode: 'ACTION_ERROR',
            retryable: true,
          },
        });
        return r.id;
      });
    const skipped = AutomationRunDetail.parse(
      ok(await call('post', `/runs/${await seed2()}/rerun`, ownerA, { reason: 'Try it' })),
    );
    expect(skipped.status).toBe('SKIPPED');
    expect(skipped.actions[0]).toMatchObject({ status: 'SKIPPED' });
    const forcedId = await seed2();
    const forced = AutomationRunDetail.parse(
      ok(
        await call('post', `/runs/${forcedId}/rerun`, adminA, { reason: 'Force it', force: true }),
      ),
    );
    expect(forced.status).toBe('SUCCESS');
  });
});

describe('the logs', () => {
  it('lists runs in tabs with filters and a summary, to Staff only for their clients', async () => {
    const all = await runs('?pageSize=100');
    expect(all.total).toBeGreaterThanOrEqual(6);
    expect(all.items.every((r) => !r.dryRun)).toBe(true);
    const summary = AutomationRunsSummary.parse(ok(await call('get', '/runs/summary', ownerA)));
    expect(summary.total).toBe(
      summary.success + summary.failed + summary.skipped + summary.pending,
    );
    expect(summary.failed).toBeGreaterThanOrEqual(2);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    // The summary ignores the tab; the list honours it.
    expect(
      AutomationRunsSummary.parse(ok(await call('get', '/runs/summary?tab=failed', ownerA))),
    ).toEqual(summary);
    expect((await runs('?tab=failed&pageSize=100')).items.every((r) => r.status === 'FAILED')).toBe(
      true,
    );
    expect(
      (await runs('?tab=success&pageSize=100')).items.every((r) =>
        ['SUCCESS', 'PARTIAL_SUCCESS'].includes(r.status),
      ),
    ).toBe(true);
    expect(
      (await runs('?tab=pending&pageSize=100')).items.every((r) =>
        ['PENDING', 'RUNNING'].includes(r.status),
      ),
    ).toBe(true);
    expect((await runs(`?ruleId=${shared.r2}`)).total).toBeGreaterThanOrEqual(1);
    expect(
      (await runs('?module=INVOICES_PAYMENTS&pageSize=100')).items.every(
        (r) => r.triggerModule === 'INVOICES_PAYMENTS',
      ),
    ).toBe(true);
    expect(
      (await runs(`?clientId=${clients.c2}&pageSize=100`)).items.every(
        (r) => r.client?.id === clients.c2,
      ),
    ).toBe(true);
    expect(
      (await runs('?search=Riley&pageSize=100')).items.every((r) =>
        r.client?.name.startsWith('Riley'),
      ),
    ).toBe(true);
    expect((await runs(`?from=${day(0)}&to=${day(0)}`)).total).toBeGreaterThanOrEqual(6);
    expect((await runs(`?from=${day(-30)}&to=${day(-20)}`)).total).toBe(0);
    expect((await runs('?dryRun=true')).total).toBe(0);
    expect(await runs('?pageSize=2&page=2')).toMatchObject({ page: 2, pageSize: 2 });
    // The legacy Staff role sees the runs of its own clients and those with none.
    const staff = await runs('?pageSize=100', staffA);
    expect(staff.items.every((r) => r.client === null || r.client.id === clients.c1)).toBe(true);
    expect(staff.total).toBeGreaterThan(0);
    const c2Run = (await runs(`?clientId=${clients.c2}`)).items[0]!;
    expectError(await call('get', `/runs/${c2Run.id}`, staffA), 404, 'NOT_FOUND');
    expect(
      AutomationRunPage.parse(ok(await call('get', '/runs', ownerB, undefined, 'b'))).total,
    ).toBe(0);
    expectError(await call('get', `/runs/${c2Run.id}`, ownerB, undefined, 'b'), 404, 'NOT_FOUND');
    expectError(await call('get', '/runs?tab=nope', ownerA), 400, 'VALIDATION_FAILED');
    expectError(await call('get', '/runs/not-a-uuid', ownerA), 400, 'VALIDATION_FAILED');
    expect(
      AutomationRunsSummary.parse(ok(await call('get', '/runs/summary', ownerB, undefined, 'b'))),
    ).toMatchObject({ total: 0 });
  });

  it('exports the filtered runs as a CSV of ids and safe columns, for those who may', async () => {
    const link = AutomationLogExport.parse(
      ok(await call('post', '/runs/export', ownerA, { filter: { tab: 'failed' } })),
    );
    expect(link.rowCount).toBeGreaterThanOrEqual(2);
    expect(link.fileName).toMatch(/^automation-logs-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(link.url).toMatch(/^memory:tenant\/.+\/automations\/exports\/.+\.csv/);
    const key = decodeURIComponent(link.url.slice('memory:'.length).split('?')[0]!);
    const csv = (files.objects.get(key) ?? Buffer.alloc(0)).toString('utf8');
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(link.rowCount + 1);
    expect(lines[0]).toContain('"Run","Rule"');
    expect(csv).toContain(clients.c2);
    expect(csv).not.toMatch(/Riley|Jamie|INV-U/);
    expect(csv).toMatch(/"FAILED"/);
    expect(
      await inFirm('a', (tx) =>
        tx.auditLog.count({ where: { action: 'automation_logs.exported' } }),
      ),
    ).toBeGreaterThanOrEqual(1);
    expectError(await call('post', '/runs/export', staffA, { filter: {} }), 403, 'FORBIDDEN');
    expectError(
      await call('post', '/runs/export', ownerA, { filter: { page: 2 } }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/runs/export', ownerA, { filter: { ruleId: randomUUID() } }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('templates', () => {
  it('installs the starters once, and lists and finds templates', async () => {
    const first = AutomationStartersResult.parse(
      ok(await call('post', '/templates/starters', ownerA)),
    );
    expect(first).toEqual({ available: 4, installed: 4, alreadyThere: 0 });
    expect(
      AutomationStartersResult.parse(ok(await call('post', '/templates/starters', ownerA))),
    ).toEqual({
      available: 4,
      installed: 0,
      alreadyThere: 4,
    });
    const page = AutomationTemplatePage.parse(
      ok(await call('get', '/templates?pageSize=100', staffA)),
    );
    expect(page.items.filter((t) => t.starter)).toHaveLength(4);
    const overdue = page.items.find((t) => t.name === 'Overdue invoice reminder');
    expect(overdue).toMatchObject({
      category: 'INVOICES_PAYMENTS',
      triggerSummary: 'Invoice overdue: 3 days after',
      actionsSummary: 'Send client message, Create task',
      integrationsMissing: [],
    });
    expect(
      AutomationTemplatePage.parse(ok(await call('get', '/templates?search=welcome', ownerA)))
        .total,
    ).toBe(1);
    expect(
      AutomationTemplatePage.parse(
        ok(await call('get', '/templates?category=APPOINTMENTS', ownerA)),
      ).total,
    ).toBe(1);
    expectError(await call('post', '/templates/starters', staffA), 403, 'FORBIDDEN');
    expect(
      AutomationTemplatePage.parse(ok(await call('get', '/templates', ownerB, undefined, 'b')))
        .total,
    ).toBe(0);
    shared.starter = overdue?.id ?? '';
  });

  it('uses a template to make a draft for review, and shares one without client data or choices of one firm', async () => {
    const used = AutomationRuleDetail.parse(
      ok(
        await call('post', `/templates/${shared.starter}/use`, ownerA, {
          name: mark('From starter'),
        }),
        201,
      ),
    );
    expect(used).toMatchObject({
      status: 'DRAFT',
      currentVersion: 1,
      category: 'INVOICES_PAYMENTS',
    });
    expect(used.definition?.actions.map((a) => a.type)).toEqual([
      'SEND_CLIENT_MESSAGE',
      'CREATE_TASK',
    ]);
    expect((await call('post', `/templates/${shared.starter}/use`, ownerA, {})).status).toBe(201);
    expectError(
      await call('post', `/templates/${shared.starter}/use`, ownerA, { name: used.name }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(await call('post', `/templates/${randomUUID()}/use`, ownerA, {}), 404, 'NOT_FOUND');
    expectError(
      await call('post', `/templates/${shared.starter}/use`, ownerB, {}, 'b'),
      404,
      'NOT_FOUND',
    );

    // A rule saved as a template leaves out the template and person it chose, and a secret.
    const live = await createRule(
      clientCreated(
        [
          {
            id: 'msg',
            type: 'SEND_CLIENT_MESSAGE',
            config: {
              templateId: ids.template,
              subject: 'Hello',
              body: 'Z'.repeat(48),
            },
          },
          {
            id: 'task',
            type: 'CREATE_TASK',
            config: { title: 'Do it', assigneeUserId: staffA.id },
          },
        ],
        { settings: { notifyOnFailureUserIds: [adminA.id] } },
      ),
      { name: mark('To share') },
    );
    const saved = AutomationTemplateDetail.parse(
      ok(
        await call('post', `/rules/${live.id}/save-as-template`, ownerA, {
          name: mark('Shared'),
          description: 'For others',
        }),
        201,
      ),
    );
    expect(saved).toMatchObject({ category: 'CLIENTS', starter: false });
    expect(JSON.stringify(saved.definition)).not.toMatch(
      new RegExp(`${ids.template}|${staffA.id}|${adminA.id}|Z{48}`),
    );
    expect(saved.definition.actions[0]?.config).toEqual({ subject: 'Hello' });
    expect(saved.definition.settings.notifyOnFailureUserIds).toEqual([]);
    expectError(
      await call('post', `/rules/${live.id}/save-as-template`, ownerA, {
        name: saved.name.toUpperCase(),
      }),
      409,
      'DUPLICATE_NAME',
    );
    // A record id in a condition or a setting is refused.
    expectError(
      await call('post', '/templates', ownerA, {
        name: mark('Names a record'),
        category: 'CLIENTS',
        definition: clientCreated([note({ config: { body: `For ${randomUUID()}` } })]),
      }),
      400,
      'INVALID_DEFINITION',
    );

    // Export, then import into the other firm's shape (here the same firm under a new name).
    const exported = ok(await call('get', `/templates/${saved.id}/export`, ownerA)) as {
      format: string;
      schemaVersion: number;
      template: { name: string };
    };
    expect(exported).toMatchObject({ format: 'firmivra.automation-template', schemaVersion: 1 });
    exported.template.name = mark('Imported');
    const imported = AutomationTemplateDetail.parse(
      ok(await call('post', '/templates/import', ownerA, exported), 201),
    );
    expect(imported.definition.actions).toEqual(saved.definition.actions);
    expectError(
      await call('post', '/templates/import', ownerA, { ...exported, schemaVersion: 2 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/templates/import', ownerA, { ...exported, format: 'other' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('post', '/templates/import', ownerA, exported), 409, 'DUPLICATE_NAME');
    expectError(await call('post', '/templates/import', staffA, exported), 403, 'FORBIDDEN');
    expectError(
      await call('get', `/templates/${saved.id}/export`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );

    // Change, archive, and restore.
    const changed = AutomationTemplateDetail.parse(
      ok(
        await call('patch', `/templates/${saved.id}`, ownerA, {
          description: 'Better words',
          requiredIntegrations: ['quickbooks'],
        }),
      ),
    );
    expect(changed).toMatchObject({
      description: 'Better words',
      requiredIntegrations: ['quickbooks'],
      integrationsMissing: ['quickbooks'],
    });
    expectError(
      await call('patch', `/templates/${saved.id}`, ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    // It needs a connection the firm does not have: not available until the firm connects it.
    expectError(
      await call('post', `/templates/${saved.id}/use`, ownerA, {}),
      409,
      'TEMPLATE_UNAVAILABLE',
    );
    await inFirm('a', (tx) =>
      tx.integrationConnection.create({
        data: {
          businessId: firms.a,
          provider: 'quickbooks',
          status: 'CONNECTED',
          connectedByUserId: ownerA.id,
        },
      }),
    );
    expect(
      AutomationTemplateDetail.parse(ok(await call('get', `/templates/${saved.id}`, staffA)))
        .integrationsMissing,
    ).toEqual([]);
    expect((await call('post', `/templates/${saved.id}/use`, ownerA, {})).status).toBe(201);
    const archived = AutomationTemplateDetail.parse(
      ok(await call('post', `/templates/${saved.id}/archive`, ownerA)),
    );
    expect(archived.archived).toBe(true);
    expectError(
      await call('post', `/templates/${saved.id}/use`, ownerA, {}),
      409,
      'TEMPLATE_UNAVAILABLE',
    );
    expectError(
      await call('patch', `/templates/${saved.id}`, ownerA, { name: 'x' }),
      409,
      'INVALID_STATUS',
    );
    expect(
      AutomationTemplateDetail.parse(
        ok(await call('post', `/templates/${saved.id}/restore`, ownerA)),
      ).archived,
    ).toBe(false);
  });
});

describe('settings and the overview', () => {
  it('keeps the firm’s settings, for an Automation Admin to change', async () => {
    const view = AutomationSettingsView.parse(ok(await call('get', '/settings', staffA)));
    expect(view).toMatchObject({
      quietHours: null,
      defaultDedupeDays: 7,
      maxDepth: 3,
      safetyThreshold: 500,
      failureAlertUsers: [],
      minutesSavedPerAction: 5,
      logRetentionDays: 365,
      updatedAt: null,
    });
    expect(view.timezone).toBeTruthy();
    expectError(await call('put', '/settings', staffA, { maxDepth: 4 }), 403, 'FORBIDDEN');
    expectError(await call('put', '/settings', preparerA, { maxDepth: 4 }), 403, 'FORBIDDEN');
    for (const bad of [
      {},
      { logRetentionDays: 30 },
      { defaultDedupeDays: 120 },
      { maxDepth: 11 },
      { quietHours: { start: '25:00', end: '07:00' } },
      { surprise: 1 },
    ])
      expectError(await call('put', '/settings', ownerA, bad), 400, 'VALIDATION_FAILED');
    expectError(
      await call('put', '/settings', ownerA, { failureAlertUserIds: [ownerB.id] }),
      409,
      'NOT_A_MEMBER',
    );
    const saved = AutomationSettingsView.parse(
      ok(
        await call('put', '/settings', ownerA, {
          quietHours: { start: '21:00', end: '07:00' },
          defaultDedupeDays: 14,
          failureAlertUserIds: [adminA.id],
          minutesSavedPerAction: 10,
          logRetentionDays: 400,
        }),
      ),
    );
    expect(saved).toMatchObject({
      quietHours: { start: '21:00', end: '07:00' },
      defaultDedupeDays: 14,
      minutesSavedPerAction: 10,
      logRetentionDays: 400,
    });
    expect(saved.failureAlertUsers.map((u) => u.userId)).toEqual([adminA.id]);
    expect(saved.updatedAt).not.toBeNull();
    // A new default applies to new rules only.
    const fresh = await createRule(clientCreated(), { name: mark('New default') });
    expect(fresh.definition?.settings.preventDuplicatesDays).toBe(14);
    expect((await rule(shared.r1)).definition?.settings.preventDuplicatesDays).toBe(30);
    expect(
      AutomationSettingsView.parse(ok(await call('put', '/settings', ownerA, { quietHours: null })))
        .quietHours,
    ).toBeNull();
    expect(
      AutomationSettingsView.parse(ok(await call('get', '/settings', ownerB, undefined, 'b')))
        .defaultDedupeDays,
    ).toBe(7);
  });

  it('shows the overview: counts, health and recent activity', async () => {
    const o = AutomationOverview.parse(ok(await call('get', '/overview', ownerA)));
    expect(o.activeRules.value).toBeGreaterThanOrEqual(1);
    expect(o.tasksCreated.value).toBeGreaterThanOrEqual(1);
    // Every successful action counts; each counts as the minutes the firm set.
    expect(o.timeSavedMinutes.value % 10).toBe(0);
    expect(o.timeSavedMinutes.value).toBeGreaterThanOrEqual(10);
    expect(o.clientNotifications.value).toBe(0);
    expect(o.health.failedRuns24h).toBeGreaterThanOrEqual(2);
    expect(o.health.status).not.toBe('HEALTHY');
    expect(o.recent.length).toBeGreaterThan(0);
    expect(o.recent.length).toBeLessThanOrEqual(10);
    expect(o).toMatchObject({ canCreate: true, canManage: true });
    const reader = AutomationOverview.parse(ok(await call('get', '/overview', staffA)));
    expect(reader).toMatchObject({ canCreate: false, canManage: false });
    const b = AutomationOverview.parse(ok(await call('get', '/overview', ownerB, undefined, 'b')));
    expect(b.activeRules.value).toBe(0);
    expect(b.recent).toEqual([]);
    expect(b.health).toMatchObject({ status: 'HEALTHY', failedRuns24h: 0, pendingRuns: 0 });
  });
});

describe('trigger events from the source modules (AU-F08 to F11)', () => {
  /** The clients API itself, so the event is the module's own record of the change. */
  const clientAction = async (firm: 'a' | 'b', who: Who, id: string, what: 'archive' | 'restore') =>
    ok(
      await request(app.getHttpServer())
        .post(`/api/v1/business/clients/${id}/${what}`)
        .set('x-business-id', firms[firm])
        .set('x-forwarded-for', viewer())
        .set('authorization', `Bearer ${await tokenFor(who.email)}`)
        .send({}),
    );

  it('lists each module’s events, each with a real source', async () => {
    const catalog = AutomationCatalog.parse(ok(await call('get', '/catalog', ownerA)));
    const codes = (module: string) =>
      catalog.events.filter((e) => e.module === module).map((e) => e.code);
    expect(codes('CLIENTS')).toEqual(
      expect.arrayContaining(['client.created', 'client.archived', 'client.reactivated']),
    );
    expect(codes('LEADS')).toEqual(
      expect.arrayContaining(['lead.created', 'lead.stage_changed', 'lead.converted']),
    );
    expect(codes('INTAKE_FORMS')).toEqual(
      expect.arrayContaining(['intake.sent', 'intake.submitted', 'intake.resubmitted']),
    );
    expect(codes('DOCUMENTS')).toEqual(
      expect.arrayContaining(['document.requested', 'document.uploaded', 'document.approved']),
    );
    // AU-F12 to F14.
    expect(codes('TAX_RETURNS')).toEqual(
      expect.arrayContaining(['tax_return.status_changed', 'tax_return.due']),
    );
    expect(codes('TAX_PLANNING')).toEqual(
      expect.arrayContaining(['tax_plan.status_changed', 'tax_plan.shared']),
    );
    expect(codes('BUSINESS_ADVISORY')).toEqual(
      expect.arrayContaining(['advisory.engagement_created', 'advisory_plan.status_changed']),
    );
    // A client's status changes only through Update client status (AU-F27): its event is listed.
    expect(codes('CLIENTS')).toContain('client.status_changed');
  });

  it('runs once for a client reactivated through Clients, and never for another firm’s', async () => {
    const live = await createRule(
      { trigger: { module: 'CLIENTS', event: 'client.reactivated' }, actions: [note()] },
      { name: mark('Welcome back') },
    );
    expect(AutomationRuleDetail.parse(ok(await activate(live.id))).status).toBe('ACTIVE');
    // Firm B's own change: never firm A's event.
    await clientAction('b', ownerB, clients.cB, 'archive');
    await clientAction('b', ownerB, clients.cB, 'restore');
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 0 });

    await clientAction('a', ownerA, clients.c2, 'archive');
    await clientAction('a', ownerA, clients.c2, 'restore');
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    // The same change never starts a second run.
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 0 });
    const page = await runs(`?ruleId=${live.id}`);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      triggerModule: 'CLIENTS',
      recordKind: 'client',
      client: { id: clients.c2 },
    });
  });
});

describe('Manual Event Confirmation (AU-F29 to F33)', () => {
  const settings = (who: Who) => call('get', '/settings', who);
  const confirm = (body: object, who: Who = ownerA) => call('post', '/confirmations', who, body);
  const switchTo = async (on: boolean) =>
    ok(await call('put', '/settings', ownerA, { manualConfirmationEnabled: on }));
  const taxReturn = () =>
    inFirm('a', async (tx) => {
      const r = await tx.taxReturn.create({
        data: {
          businessId: firms.a,
          clientId: clients.c1,
          taxYear: 2025,
          filingType: 'INDIVIDUAL',
        },
      });
      return r.id;
    });
  const statusOf = (id: string) =>
    inFirm('a', (tx) =>
      tx.taxReturn.findUniqueOrThrow({
        where: { id },
        select: { workflowStatus: true, status: true },
      }),
    );

  it('the master switch: off by default, only an Owner or Admin changes it, audited', async () => {
    expect(AutomationSettingsView.parse(ok(await settings(ownerA))).manualConfirmationEnabled).toBe(
      false,
    );
    expectError(
      await call('put', '/settings', staffA, { manualConfirmationEnabled: true }),
      403,
      'FORBIDDEN',
    );
    const on = AutomationSettingsView.parse(
      ok(await call('put', '/settings', adminA, { manualConfirmationEnabled: true })),
    );
    expect(on.manualConfirmationEnabled).toBe(true);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirst({
        where: { action: 'automation_settings.updated' },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      }),
    );
    expect(audit?.metadata).toMatchObject({ manualConfirmation: { from: false, to: true } });
    await switchTo(false);
  });

  it('confirms one occurrence once, only with the switch on, and changes nothing else', async () => {
    const id = await taxReturn();
    const body = {
      event: 'tax_return.accepted',
      recordId: id,
      occurrence: '2025',
      reference: 'ACK-0001',
    };
    // Off: refused (F29).
    expectError(await confirm(body), 409, 'MANUAL_CONFIRMATION_OFF');
    await switchTo(true);
    // Not a confirmable event, an unknown record, a read-only role: refused.
    expectError(await confirm({ ...body, event: 'client.archived' }), 400, 'VALIDATION_FAILED');
    expect((await confirm({ ...body, recordId: randomUUID() })).status).toBe(404);
    expect((await confirm(body, staffA)).status).toBe(403);
    const before = await statusOf(id);
    const made = AutomationEventConfirmation.parse(ok(await confirm(body), 201));
    expect(made).toMatchObject({
      event: 'tax_return.accepted',
      recordKind: 'tax_return',
      occurrence: '2025',
      client: { id: clients.c1 },
      confirmedBy: { userId: ownerA.id },
      providerEvidence: null,
    });
    // One per occurrence, never twice (F31); a later year is its own occurrence.
    expectError(await confirm(body), 409, 'ALREADY_CONFIRMED');
    ok(await confirm({ ...body, occurrence: '2026' }), 201);
    // F33: it only records the fact; the return's own status is untouched.
    expect(await statusOf(id)).toEqual(before);
    const list = AutomationConfirmationList.parse(
      ok(await call('get', `/confirmations?recordId=${id}`, ownerA)),
    );
    expect(list.items.map((c) => c.occurrence).sort()).toEqual(['2025', '2026']);
    await switchTo(false);
  });

  it('a rule on it runs once per occurrence; provider evidence later never reruns it (F30, F32)', async () => {
    await switchTo(true);
    const manual = await createRule(
      { trigger: { module: 'TAX_RETURNS', event: 'tax_return.accepted' }, actions: [note()] },
      { name: mark('Accepted'), category: 'TAX_RETURNS' },
    );
    const verified = await createRule(
      {
        trigger: {
          module: 'TAX_RETURNS',
          event: 'tax_return.accepted',
          source: 'INTEGRATION_VERIFIED',
        },
        actions: [note()],
      },
      { name: mark('Verified only'), category: 'TAX_RETURNS' },
    );
    expect(manual.definition?.trigger.source).toBe('MANUAL');
    expect(verified.definition?.trigger.source).toBe('INTEGRATION_VERIFIED');
    for (const r of [manual, verified]) ok(await activate(r.id));
    const id = await taxReturn();
    const made = AutomationEventConfirmation.parse(
      ok(await confirm({ event: 'tax_return.accepted', recordId: id, occurrence: '2025' }), 201),
    );
    expect(await engine.scanRule(firms.a, manual.id)).toMatchObject({ started: 1 });
    // Integration verified waits for provider evidence.
    expect(await engine.scanRule(firms.a, verified.id)).toMatchObject({ started: 0 });
    const key = `tax_return.accepted:${id}:2025`;
    const evidence = (reference: string) =>
      inFirm('a', (tx) =>
        attachProviderEvidence(tx, firms.a, key, {
          provider: 'fake_efile',
          reference,
          verifiedAt: new Date(),
        }),
      );
    expect(await evidence('PRV-1')).toBe(true);
    // Set once: a second attempt changes nothing.
    expect(await evidence('PRV-2')).toBe(false);
    expect(await engine.scanRule(firms.a, manual.id)).toMatchObject({ started: 0 });
    expect(await engine.scanRule(firms.a, verified.id)).toMatchObject({ started: 1 });
    const again = AutomationConfirmationList.parse(
      ok(await call('get', `/confirmations?recordId=${id}`, ownerA)),
    ).items[0];
    // The manual confirmation stays as it was; the evidence sits beside it.
    expect(again).toMatchObject({
      id: made.id,
      confirmedBy: { userId: ownerA.id },
      providerEvidence: { provider: 'fake_efile', reference: 'PRV-1' },
    });
    // A source on an event that has none is refused.
    expectError(
      await call('post', '/rules', ownerA, {
        name: mark('x'),
        category: 'CLIENTS',
        definition: {
          trigger: { module: 'CLIENTS', event: 'client.created', source: 'MANUAL' },
          actions: [note()],
        },
      }),
      400,
      'INVALID_DEFINITION',
    );
    await switchTo(false);
  });
});

describe('Rule Owner (AU-F28)', () => {
  it('is the creator by default, an Owner or Admin by choice, and its change is audited', async () => {
    const mine = await createRule(clientCreated(), { name: mark('Owned') });
    expect(mine.owner?.userId).toBe(ownerA.id);
    const theirs = await createRule(clientCreated(), {
      name: mark('Owned by admin'),
      ownerUserId: adminA.id,
    });
    expect(theirs.owner?.userId).toBe(adminA.id);

    const moved = AutomationRuleDetail.parse(
      ok(
        await call('patch', `/rules/${theirs.id}`, adminA, {
          ownerUserId: ownerA.id,
          etag: theirs.etag,
        }),
      ),
    );
    expect(moved.owner).toMatchObject({ userId: ownerA.id });
    const rows = await auditRows(theirs.id);
    expect(
      rows.some(
        (r) =>
          r.action === 'automation_rule.updated' &&
          JSON.stringify(r.metadata).includes('ownerUserId'),
      ),
    ).toBe(true);
  });
});

describe('the Conditions step’s match count (AU-F21)', () => {
  const count = (body: object, who: Who = ownerA) => call('post', '/rules/matches', who, body);

  it('counts what the trigger and conditions match now, before any action, and runs nothing', async () => {
    const runsBefore = await inFirm('a', (tx) =>
      tx.automationRun.count({ where: { businessId: firms.a } }),
    );
    const trigger = { module: 'INVOICES_PAYMENTS', event: 'invoice.overdue' };
    const all = AutomationMatches.parse(ok(await count({ trigger })));
    expect(all.matchCount).toBeGreaterThanOrEqual(0);
    expect(all.sample.length).toBeLessThanOrEqual(5);
    // A condition nothing meets matches nothing.
    const none = AutomationMatches.parse(
      ok(
        await count({
          trigger,
          conditions: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }],
          matchMode: 'ALL',
        }),
      ),
    );
    expect(none.matchCount).toBeLessThanOrEqual(all.matchCount);
    // Checked against the catalog as a definition is; a read-only role may not.
    expectError(
      await count({ trigger: { module: 'CLIENTS', event: 'no.such_event' } }),
      400,
      'INVALID_DEFINITION',
    );
    expectError(await count({ trigger }, staffA), 403, 'FORBIDDEN');
    expect(
      await inFirm('a', (tx) => tx.automationRun.count({ where: { businessId: firms.a } })),
    ).toBe(runsBefore);
  });
});

describe('Add and remove client tags (AU-F27)', () => {
  const tagRule = async (type: 'ADD_CLIENT_TAGS' | 'REMOVE_CLIENT_TAGS', tagIds: string[]) => {
    const live = await createRule(clientCreated([{ id: 'tags', type, config: { tagIds } }]), {
      name: mark(type),
    });
    ok(await activate(live.id));
    return live;
  };
  const newTag = (firm: 'a' | 'b', name: string) =>
    inFirm(
      firm,
      async (tx) => (await tx.tag.create({ data: { businessId: firms[firm], name } })).id,
    );
  const newClient = (name: string) =>
    inFirm(
      'a',
      async (tx) =>
        (
          await tx.client.create({
            data: { businessId: firms.a, displayName: name },
            select: { id: true },
          })
        ).id,
    );
  const tagsOf = (clientId: string) =>
    inFirm('a', async (tx) =>
      (
        await tx.clientTag.findMany({
          where: { clientId },
          select: { tag: { select: { name: true } } },
        })
      ).map((t) => t.tag.name),
    );

  it('adds and removes the firm’s own tags by id; an archived tag fails the step', async () => {
    const vip = await newTag('a', `VIP ${run}`);
    const gone = await newTag('a', `Gone ${run}`);
    const add = await tagRule('ADD_CLIENT_TAGS', [vip]);
    const stale = await tagRule('ADD_CLIENT_TAGS', [gone]);
    // Archived after the rule was saved: the step fails, nothing is added.
    await inFirm('a', (tx) =>
      tx.tag.update({ where: { id: gone }, data: { archivedAt: new Date() } }),
    );
    const id = await newClient(`Tagged ${run} (fake)`);
    expect(await engine.scanRule(firms.a, add.id)).toMatchObject({ started: 1 });
    expect(await tagsOf(id)).toEqual([`VIP ${run}`]);
    expect(await engine.scanRule(firms.a, stale.id)).toMatchObject({ started: 1 });
    const failed = (await runs(`?ruleId=${stale.id}`)).items[0]!;
    expect((await runDetail(failed.id)).actions[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'UNKNOWN_TAG',
    });
    expect(await tagsOf(id)).toEqual([`VIP ${run}`]);
    for (const r of [add, stale]) ok(await call('post', `/rules/${r.id}/pause`, ownerA, {}));

    const remove = await tagRule('REMOVE_CLIENT_TAGS', [vip]);
    const second = await newClient(`Tagged again ${run} (fake)`);
    await inFirm('a', (tx) =>
      tx.clientTag.create({ data: { businessId: firms.a, clientId: second, tagId: vip } }),
    );
    expect(await engine.scanRule(firms.a, remove.id)).toMatchObject({ started: 1 });
    expect(await tagsOf(second)).toEqual([]);
    // As Clients records a tag change: an audit entry on the client.
    expect((await auditRows(second)).map((r) => r.action)).toContain('client.tags_set');
    ok(await call('post', `/rules/${remove.id}/pause`, ownerA, {}));
  });

  it('never takes another firm’s tag or a name; an empty list is a setting still to fill', async () => {
    const validate = async (definition: object) =>
      AutomationPreview.parse(ok(await call('post', '/rules/validate', ownerA, { definition })));
    const theirs = await newTag('b', `Firm B tag ${run}`);
    const foreign = await createRule(
      clientCreated([{ id: 'tags', type: 'ADD_CLIENT_TAGS', config: { tagIds: [theirs] } }]),
      { name: mark('Foreign tag') },
    );
    expectError(await activate(foreign.id), 409, 'NOT_READY');
    const checks = await validate(
      clientCreated([{ id: 'tags', type: 'ADD_CLIENT_TAGS', config: { tagIds: [theirs] } }]),
    );
    expect(checks.checks.find((c) => c.path === 'actions.0.config.tagIds')).toMatchObject({
      code: 'INVALID_ACTION_CONFIG',
      severity: 'BLOCK',
    });
    for (const tagIds of [['VIP'], 'VIP'])
      expect(
        (
          await call('post', '/rules', ownerA, {
            name: mark('Bad tags'),
            category: 'CLIENTS',
            definition: clientCreated([
              { id: 'tags', type: 'ADD_CLIENT_TAGS', config: { tagIds } },
            ]),
          })
        ).status,
      ).toBe(400);
    const empty = await createRule(
      clientCreated([{ id: 'tags', type: 'ADD_CLIENT_TAGS', config: { tagIds: [] } }]),
      { name: mark('No tags yet') },
    );
    expectError(await activate(empty.id), 409, 'NOT_READY');
  });
});

describe('Notify staff, and the firm’s own events with no client (AU-F18 to F20, F27)', () => {
  const tell = (config: object = {}) => ({ id: 'tell', type: 'NOTIFY_STAFF', config });
  const business = async (
    method: Method,
    path: string,
    who: Who,
    body?: object,
    firm: 'a' | 'b' = 'a',
  ) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1/business${path}`)
      .set('x-business-id', firms[firm])
      .set('x-forwarded-for', viewer())
      .set('authorization', `Bearer ${await tokenFor(who.email)}`);
    return body === undefined ? req : req.send(body);
  };
  const notices = (runId: string) =>
    inFirm('a', (tx) =>
      tx.notification.findMany({
        where: { businessId: firms.a, type: 'automation.notice', entityId: runId },
        select: { recipientUserId: true },
      }),
    );
  const validate = async (definition: object) =>
    AutomationPreview.parse(ok(await call('post', '/rules/validate', ownerA, { definition })));

  it('a role change notifies the Owners and Admins by default; never Staff, never another firm', async () => {
    const live = await createRule(
      { trigger: { module: 'STAFF_MANAGEMENT', event: 'staff.role_changed' }, actions: [tell()] },
      { name: mark('Role watch'), category: 'STAFF_MANAGEMENT' },
    );
    expect(AutomationRuleDetail.parse(ok(await activate(live.id))).status).toBe('ACTIVE');
    // A new member of firm A, whose role the Owner changes through Team.
    const newcomer = { id: randomUUID(), email: `r55u-new-${run}@r55.test` };
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: {
          id: newcomer.id,
          cognitoSub: newcomer.id,
          pool: 'STAFF',
          email: newcomer.email,
          name: `Fake R55u newcomer ${run}`,
        },
      }),
    );
    const membershipId = await inFirm(
      'a',
      async (tx) =>
        (
          await tx.membership.create({
            data: {
              businessId: firms.a,
              userId: newcomer.id,
              role: 'BOOKKEEPER',
              status: 'ACTIVE',
            },
            select: { id: true },
          })
        ).id,
    );
    ok(await business('patch', `/team/${membershipId}`, ownerA, { role: 'STAFF' }));
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    const run1 = (await runs(`?ruleId=${live.id}`)).items[0]!;
    const detail = await runDetail(run1.id);
    expect(detail.actions[0]).toMatchObject({ status: 'SUCCESS', detail: '2 member(s) notified' });
    // The Owner and the Admin; no Staff member, and nobody of firm B.
    expect((await notices(run1.id)).map((n) => n.recipientUserId).sort()).toEqual(
      [ownerA.id, adminA.id].sort(),
    );
    // The bell item: the rule's name, opening the run in Automations > Logs.
    const bell = ok(await business('get', '/me/notifications', adminA)) as {
      items: { title: string; body: string; target: { kind: string; id: string } }[];
    };
    expect(bell.items.find((n) => n.target.id === run1.id)).toMatchObject({
      title: 'Automation notice',
      body: live.name,
      target: { kind: 'automation_run', id: run1.id },
    });
    expect((await auditRows(run1.id)).map((r) => r.action)).toContain('automation.notice_sent');
    // The link's page loads the run through the firm's own API: firm B gets 404.
    expect((await call('get', `/runs/${run1.id}`, ownerB, undefined, 'b')).status).toBe(404);
    const theirs = ok(await business('get', '/me/notifications', ownerB, undefined, 'b')) as {
      items: { target: { id: string } }[];
    };
    expect(theirs.items.some((n) => n.target.id === run1.id)).toBe(false);
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));
  });

  it('chosen members: this firm’s active members only, and on a client’s run only those who may see the client', async () => {
    // Firm B's Owner is never someone firm A can notify.
    const foreign = clientCreated([tell({ memberUserIds: [ownerB.id] })]);
    expect(
      (await validate(foreign)).checks.find((c) => c.path === 'actions.0.config.memberUserIds'),
    ).toMatchObject({ code: 'INVALID_ACTION_CONFIG', severity: 'BLOCK' });
    const blocked = await createRule(foreign, { name: mark('Foreign notice') });
    expectError(await activate(blocked.id), 409, 'NOT_READY');

    const live = await createRule(
      clientCreated([tell({ memberUserIds: [staffA.id, preparerA.id, adminA.id] })]),
      { name: mark('New client notice') },
    );
    ok(await activate(live.id));
    // A client assigned to the Staff member: they and the Admin see it; the preparer doesn't.
    const clientId = await inFirm(
      'a',
      async (tx) =>
        (
          await tx.client.create({
            data: {
              businessId: firms.a,
              displayName: `Notice client ${run} (fake)`,
              assignedUserId: staffA.id,
            },
            select: { id: true },
          })
        ).id,
    );
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    const run1 = (await runs(`?ruleId=${live.id}`)).items.find((r) => r.client?.id === clientId)!;
    expect((await notices(run1.id)).map((n) => n.recipientUserId).sort()).toEqual(
      [staffA.id, adminA.id].sort(),
    );
    const bell = ok(await business('get', '/me/notifications', staffA)) as {
      items: { body: string; target: { id: string } }[];
    };
    expect(bell.items.find((n) => n.target.id === run1.id)?.body).toBe(
      `Notice client ${run} (fake): ${live.name}`,
    );
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));
  });

  it('an event with no client refuses an action that needs one; finished syncs are events', async () => {
    expectError(
      await call('post', '/rules', ownerA, {
        name: mark('Task for nobody'),
        category: 'STAFF_MANAGEMENT',
        definition: {
          trigger: { module: 'STAFF_MANAGEMENT', event: 'staff.deactivated' },
          actions: [note()],
        },
      }),
      400,
      'INVALID_DEFINITION',
    );
    const catalog = AutomationCatalog.parse(ok(await call('get', '/catalog', ownerA)));
    const events = (module: string) => catalog.events.filter((e) => e.module === module);
    for (const module of ['STAFF_MANAGEMENT', 'INTEGRATIONS'])
      expect(events(module).every((e) => !e.hasClient)).toBe(true);
    expect(catalog.events.find((e) => e.code === 'communication.sent')?.hasClient).toBe(false);
    expect(catalog.events.find((e) => e.code === 'communication.consent_changed')?.hasClient).toBe(
      true,
    );

    const failed = await createRule(
      { trigger: { module: 'INTEGRATIONS', event: 'integration.sync_failed' }, actions: [tell()] },
      { name: mark('Sync failed'), category: 'INTEGRATIONS' },
    );
    const reauth = await createRule(
      {
        trigger: { module: 'INTEGRATIONS', event: 'integration.reauthorization_needed' },
        actions: [tell()],
      },
      { name: mark('Reauthorize'), category: 'INTEGRATIONS' },
    );
    for (const r of [failed, reauth]) ok(await activate(r.id));
    // The sync worker's results: one expired authorization in each firm, and a connection test
    // in firm A, which is not a sync.
    for (const firm of ['a', 'b'] as const)
      await inFirm(firm, async (tx) => {
        const c = await tx.integrationConnection.create({
          data: {
            businessId: firms[firm],
            // A synthetic provider: an earlier test has the firm's real ones (one per provider).
            provider: 'r55_sync_fake',
            status: 'NEEDS_ATTENTION',
            statusReason: 'authorization_expired',
          },
          select: { id: true },
        });
        for (const entity of firm === 'a' ? ['invoices', 'test'] : ['invoices'])
          await tx.integrationSyncRun.create({
            data: {
              businessId: firms[firm],
              connectionId: c.id,
              entity,
              status: 'FAILED',
              errorCode: 'authorization_expired',
              finishedAt: new Date(),
            },
          });
      });
    for (const r of [failed, reauth])
      expect(await engine.scanRule(firms.a, r.id)).toMatchObject({ started: 1 });
    const one = (await runs(`?ruleId=${reauth.id}`)).items[0]!;
    expect(one).toMatchObject({ recordKind: 'integration_connection', client: null });
    expect((await runDetail(one.id)).actions[0]).toMatchObject({ status: 'SUCCESS' });
    for (const r of [failed, reauth]) ok(await call('post', `/rules/${r.id}/pause`, ownerA, {}));
  });
});

describe('Assign client, and actions that would start themselves (AU-F27)', () => {
  const assign = (assigneeUserId: string) => ({
    id: 'assign',
    type: 'ASSIGN_CLIENT',
    config: { assigneeUserId },
  });
  const assignedOf = (id: string) =>
    inFirm(
      'a',
      async (tx) =>
        (
          await tx.client.findFirstOrThrow({
            where: { businessId: firms.a, id },
            select: { assignedUserId: true },
          })
        ).assignedUserId,
    );

  it('reassigns as Clients does, once; a Staff owner and another firm’s person are refused', async () => {
    const live = await createRule(clientCreated([assign(adminA.id)]), { name: mark('Assign') });
    ok(await activate(live.id));
    const id = await inFirm(
      'a',
      async (tx) =>
        (
          await tx.client.create({
            data: {
              businessId: firms.a,
              displayName: `Assign me ${run} (fake)`,
              assignedUserId: staffA.id,
            },
            select: { id: true },
          })
        ).id,
    );
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    expect(await assignedOf(id)).toBe(adminA.id);
    const entries = await auditRows(id);
    expect(entries.filter((r) => r.action === 'client.updated')).toHaveLength(1);
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));

    // A rule whose owner is now a Staff member (an Owner or Admin who was demoted): Clients lets
    // only an Owner or Admin reassign, so it can't be turned on.
    const staffOwned = await createRule(clientCreated([assign(adminA.id)]), {
      name: mark('Staff assign'),
    });
    await inFirm('a', (tx) =>
      tx.automationRule.update({
        where: { businessId_id: { businessId: firms.a, id: staffOwned.id } },
        data: { ownerUserId: staffA.id },
      }),
    );
    expectError(await activate(staffOwned.id), 409, 'NOT_READY');
    // Firm B's Owner is not someone firm A can assign to.
    const foreign = await createRule(clientCreated([assign(ownerB.id)]), {
      name: mark('Foreign assign'),
    });
    expectError(await activate(foreign.id), 409, 'NOT_READY');
  });

  it('a rule on a tag or assignment change can’t take the action that makes that change', async () => {
    const codes = async (definition: object) =>
      AutomationPreview.parse(
        ok(await call('post', '/rules/validate', ownerA, { definition })),
      ).checks.map((c) => c.code);
    const tag = await inFirm(
      'a',
      async (tx) =>
        (await tx.tag.create({ data: { businessId: firms.a, name: `Loop ${run}` } })).id,
    );
    expect(
      await codes({
        trigger: { module: 'CLIENTS', event: 'client.tags_changed' },
        actions: [{ id: 'tag', type: 'ADD_CLIENT_TAGS', config: { tagIds: [tag] } }],
      }),
    ).toContain('LOOP_RISK');
    expect(
      await codes({
        trigger: { module: 'CLIENTS', event: 'client.assignment_changed' },
        actions: [assign(adminA.id)],
      }),
    ).toContain('LOOP_RISK');
    // On another event, the same actions are fine.
    expect(await codes(clientCreated([assign(adminA.id)]))).not.toContain('LOOP_RISK');
  });
});

describe('Send client email, through Messages (AU-F25)', () => {
  const email = (config: object) => ({ id: 'mail', type: 'SEND_CLIENT_EMAIL', config });
  // A client with an active PRIMARY portal login: Messages' email to a client is the portal
  // message with an email notice (the text stays in the portal), so it needs portal access.
  const newClient = async (name: string, address: string) => {
    const login = randomUUID();
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: { id: login, cognitoSub: login, pool: 'CLIENT', email: `login-${address}`, name },
      }),
    );
    return inFirm('a', async (tx) => {
      const id = (
        await tx.client.create({
          data: { businessId: firms.a, displayName: name, email: address },
          select: { id: true },
        })
      ).id;
      await tx.clientAccount.create({
        data: {
          businessId: firms.a,
          userId: login,
          clientId: id,
          email: `login-${address}`,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      });
      return id;
    });
  };

  it('sends one email through Messages (its notice, the text in the portal); a client who opted out gets none', async () => {
    const live = await createRule(
      clientCreated([
        email({ subject: 'Welcome, {{client.name}}', body: 'Hello from {{firm.name}}.' }),
      ]),
      { name: mark('Welcome email'), category: 'COMMUNICATIONS' },
    );
    ok(await activate(live.id));
    const yes = `mail-yes-${run}@client.test`;
    const no = `mail-no-${run}@client.test`;
    const welcome = await newClient(`Mail yes ${run} (fake)`, yes);
    const optedOut = await newClient(`Mail no ${run} (fake)`, no);
    await inFirm('a', (tx) =>
      tx.communicationConsent.create({
        data: {
          businessId: firms.a,
          clientId: optedOut,
          channel: 'EMAIL',
          status: 'OPTED_OUT',
          source: 'fake',
        },
      }),
    );
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 2 });
    const page = await runs(`?ruleId=${live.id}`);
    const of = async (clientId: string) =>
      (await runDetail(page.items.find((r) => r.client?.id === clientId)!.id)).actions[0]!;

    const sent = await of(welcome);
    expect(sent, JSON.stringify(sent)).toMatchObject({
      status: 'SUCCESS',
      result: { kind: 'outbound_message' },
    });
    const message = await inFirm('a', (tx) =>
      tx.outboundMessage.findFirstOrThrow({
        where: { businessId: firms.a, id: sent.result!.id },
        select: { channel: true, status: true, subject: true },
      }),
    );
    expect(message).toMatchObject({
      channel: 'EMAIL',
      status: 'SENT',
      subject: `Welcome, Mail yes ${run} (fake)`,
    });
    expect(outbox.filter((m) => m.to === yes)).toHaveLength(1);
    // The notice email never carries the text: it stays in the client's portal.
    expect(JSON.stringify(outbox.filter((m) => m.to === yes))).not.toContain('Hello from');

    // Messages' own consent check: nothing goes, and no draft is left behind.
    expect(await of(optedOut)).toMatchObject({
      status: 'FAILED',
      errorCode: 'NO_CONSENT',
      retryable: false,
    });
    expect(outbox.filter((m) => m.to === no)).toHaveLength(0);
    expect(
      await inFirm('a', (tx) =>
        tx.outboundMessage.count({
          where: {
            businessId: firms.a,
            status: { in: ['DRAFT', 'SCHEDULED'] },
            recipients: { some: { clientId: optedOut } },
          },
        }),
      ),
    ).toBe(0);
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));

    // A template or a written email: neither, and it can't be turned on.
    const empty = await createRule(clientCreated([email({ subject: 'Hi' })]), {
      name: mark('Empty email'),
    });
    expectError(await activate(empty.id), 409, 'NOT_READY');
  });
});

describe('Tags and Assigned staff conditions on client and lead events (AU-F22)', () => {
  it('offers the firm’s own tags and members, never another firm’s, and matches on them', async () => {
    const tagIn = (firm: 'a' | 'b') =>
      inFirm(
        firm,
        async (tx) =>
          (
            await tx.tag.create({
              data: { businessId: firms[firm], name: `Field tag ${firm} ${run}` },
            })
          ).id,
      );
    const mine = await tagIn('a');
    const theirs = await tagIn('b');
    const catalog = AutomationCatalog.parse(ok(await call('get', '/catalog', ownerA)));
    const fieldsOf = (code: string) => catalog.events.find((e) => e.code === code)!.conditionFields;
    for (const code of ['client.created', 'client.tags_changed', 'lead.created']) {
      const tags = fieldsOf(code).find((f) => f.field === 'tags')!;
      expect(tags.options.map((o) => o.value)).toContain(mine);
      expect(tags.options.map((o) => o.value)).not.toContain(theirs);
      const staff = fieldsOf(code).find((f) => f.field === 'assignedUserId')!;
      expect(staff.options.map((o) => o.value)).toEqual(
        expect.arrayContaining([ownerA.id, staffA.id]),
      );
      expect(staff.options.map((o) => o.value)).not.toContain(ownerB.id);
    }
    // Not on an event whose record is not a client's or a lead's.
    expect(fieldsOf('invoice.overdue').some((f) => f.field === 'tags')).toBe(false);

    // Only the new client with the tag and the Staff assignee starts the rule.
    const live = await createRule(
      clientCreated([note()], {
        conditions: [
          { field: 'tags', operator: 'INCLUDES', value: [mine] },
          { field: 'assignedUserId', operator: 'IS', value: staffA.id },
        ],
        matchMode: 'ALL',
      }),
      { name: mark('Tagged and assigned') },
    );
    ok(await activate(live.id));
    const make = (name: string, tagged: boolean, assignedUserId: string | null) =>
      inFirm('a', async (tx) => {
        const c = await tx.client.create({
          data: { businessId: firms.a, displayName: `${name} ${run} (fake)`, assignedUserId },
          select: { id: true },
        });
        if (tagged)
          await tx.clientTag.create({
            data: { businessId: firms.a, clientId: c.id, tagId: mine },
          });
        return c.id;
      });
    const both = await make('Both', true, staffA.id);
    await make('Tag only', true, adminA.id);
    await make('Staff only', false, staffA.id);
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    expect((await runs(`?ruleId=${live.id}`)).items[0]).toMatchObject({ client: { id: both } });
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));
  });
});

describe('Request documents, through Documents (AU-F27)', () => {
  const ask = (config: object) => ({ id: 'docs', type: 'REQUEST_DOCUMENTS', config });

  it('asks under the client’s oldest open service of the kind; none open asks nothing; another firm’s category is refused', async () => {
    const { serviceId, categoryId } = await inFirm('a', async (tx) => ({
      serviceId: (
        await tx.service.create({
          data: { businessId: firms.a, kind: 'ANNUAL_TAX', name: `Annual ${run}` },
        })
      ).id,
      categoryId: (
        await tx.documentCategory.create({ data: { businessId: firms.a, name: `Wages ${run}` } })
      ).id,
    }));
    const theirCategory = await inFirm(
      'b',
      async (tx) =>
        (await tx.documentCategory.create({ data: { businessId: firms.b, name: `B ${run}` } })).id,
    );
    // Firm B's category is never one firm A's rule can use.
    const foreign = await createRule(
      clientCreated([ask({ serviceKind: 'ANNUAL_TAX', title: 'W-2', categoryId: theirCategory })]),
      { name: mark('Foreign category') },
    );
    expectError(await activate(foreign.id), 409, 'NOT_READY');

    const live = await createRule(
      clientCreated([
        ask({
          serviceKind: 'ANNUAL_TAX',
          title: 'W-2 for {{client.name}}',
          categoryId,
          dueInDays: 14,
        }),
      ]),
      { name: mark('Ask for the W-2') },
    );
    ok(await activate(live.id));
    const make = (name: string, status: 'ACTIVE' | 'COMPLETED' | null) =>
      inFirm('a', async (tx) => {
        const c = await tx.client.create({
          data: { businessId: firms.a, displayName: `${name} ${run} (fake)` },
          select: { id: true },
        });
        const engagement = status
          ? (
              await tx.engagement.create({
                data: {
                  businessId: firms.a,
                  clientId: c.id,
                  serviceId,
                  title: 'Taxes (fake)',
                  status,
                  ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
                },
                select: { id: true },
              })
            ).id
          : null;
        return { id: c.id, engagement };
      });
    const open = await make('Open service', 'ACTIVE');
    const closed = await make('Closed service', 'COMPLETED');
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 2 });
    const page = await runs(`?ruleId=${live.id}`);
    const stepOf = async (clientId: string) =>
      (await runDetail(page.items.find((r) => r.client?.id === clientId)!.id)).actions[0]!;

    const asked = await stepOf(open.id);
    expect(asked).toMatchObject({ status: 'SUCCESS', result: { kind: 'document_request' } });
    const request = await inFirm('a', (tx) =>
      tx.documentRequest.findFirstOrThrow({
        where: { businessId: firms.a, id: asked.result!.id },
        select: { engagementId: true, categoryId: true, title: true, dueOn: true },
      }),
    );
    expect(request).toMatchObject({
      engagementId: open.engagement,
      categoryId,
      title: `W-2 for Open service ${run} (fake)`,
    });
    expect(request.dueOn).not.toBeNull();

    // Only a completed service: nothing is requested.
    expect(await stepOf(closed.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'NO_OPEN_SERVICE',
      retryable: false,
    });
    expect(
      await inFirm('a', (tx) =>
        tx.documentRequest.count({ where: { businessId: firms.a, clientId: closed.id } }),
      ),
    ).toBe(0);
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));
  });
});

describe('Send intake form, through Intake Forms (AU-F27)', () => {
  it('sends the published form once under the client’s open service; another firm’s form is refused', async () => {
    const form = await inFirm('a', async (tx) => {
      const service = await tx.service.create({
        data: {
          businessId: firms.a,
          kind: 'ANNUAL_TAX',
          name: `Intake tax ${run}`,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      const f = await tx.intakeForm.create({
        data: {
          businessId: firms.a,
          serviceId: service.id,
          version: 1,
          title: `Annual Tax Intake ${run}`,
          definition: INTAKE_FORMS.ANNUAL_TAX as object,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdByUserId: ownerA.id,
        },
        select: { templateId: true },
      });
      return { serviceId: service.id, templateId: f.templateId as string };
    });
    const theirs = await inFirm('b', async (tx) => {
      const service = await tx.service.create({
        data: {
          businessId: firms.b,
          kind: 'ANNUAL_TAX',
          name: `B intake ${run}`,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      const f = await tx.intakeForm.create({
        data: {
          businessId: firms.b,
          serviceId: service.id,
          version: 1,
          title: `B Intake ${run}`,
          definition: INTAKE_FORMS.ANNUAL_TAX as object,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          createdByUserId: ownerB.id,
        },
        select: { templateId: true },
      });
      return f.templateId as string;
    });
    const send = (formId: string) => ({
      id: 'intake',
      type: 'SEND_INTAKE',
      config: {
        formId,
        channel: 'EMAIL',
        subject: 'Your tax organizer, {{client.name}}',
        dueInDays: 10,
      },
    });
    // Firm B's form is never one firm A's rule can send.
    const foreign = await createRule(clientCreated([send(theirs)]), { name: mark('Foreign form') });
    expectError(await activate(foreign.id), 409, 'NOT_READY');

    const live = await createRule(clientCreated([send(form.templateId)]), {
      name: mark('Send organizer'),
    });
    ok(await activate(live.id));
    // Intake delivers through the client's portal login (its bell item), so the client has one.
    const login = randomUUID();
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: {
          id: login,
          cognitoSub: login,
          pool: 'CLIENT',
          email: `intake-login-${run}@client.test`,
          name: `Intake client ${run} (fake)`,
        },
      }),
    );
    const clientId = await inFirm('a', async (tx) => {
      const c = await tx.client.create({
        data: {
          businessId: firms.a,
          displayName: `Intake client ${run} (fake)`,
          email: `intake-${run}@client.test`,
        },
        select: { id: true },
      });
      await tx.clientAccount.create({
        data: {
          businessId: firms.a,
          userId: login,
          clientId: c.id,
          email: `intake-login-${run}@client.test`,
          portalRole: 'PRIMARY',
          status: 'ACTIVE',
        },
      });
      await tx.engagement.create({
        data: {
          businessId: firms.a,
          clientId: c.id,
          serviceId: form.serviceId,
          title: 'Tax (fake)',
        },
      });
      return c.id;
    });
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    const runId = (await runs(`?ruleId=${live.id}`)).items[0]!.id;
    const step = (await runDetail(runId)).actions[0]!;
    expect(step, JSON.stringify(step)).toMatchObject({
      status: 'SUCCESS',
      result: { kind: 'intake' },
    });
    const intakes = await inFirm('a', (tx) =>
      tx.intake.findMany({
        where: { businessId: firms.a, engagement: { clientId } },
        select: { id: true, dueOn: true },
      }),
    );
    expect(intakes).toHaveLength(1);
    expect(intakes[0]!.dueOn).not.toBeNull();
    // Intake's own delivery: the client's bell item for the form.
    expect(
      await inFirm('a', (tx) =>
        tx.notification.count({
          where: { businessId: firms.a, recipientUserId: login, type: 'intake.sent' },
        }),
      ),
    ).toBe(1);
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));
  });
});

describe('Update client status and priority, a typed allowlist (AU-F27, AU-F08)', () => {
  const setStatus = (status: string) => ({
    id: 'status',
    type: 'UPDATE_CLIENT_STATUS',
    config: { status },
  });
  const setPriority = (priority: string) => ({
    id: 'priority',
    type: 'UPDATE_CLIENT_PRIORITY',
    config: { priority },
  });
  const newClient = async (firm: 'a' | 'b', name: string, data: object = {}) =>
    inFirm(
      firm,
      async (tx) =>
        (
          await tx.client.create({
            data: { businessId: firms[firm], displayName: `${name} ${run} (fake)`, ...data },
            select: { id: true },
          })
        ).id,
    );
  const stateOf = (firm: 'a' | 'b', id: string) =>
    inFirm(firm, (tx) =>
      tx.client.findFirstOrThrow({
        where: { businessId: firms[firm], id },
        select: { status: true, priority: true },
      }),
    );

  it('sets an allowed status and priority as Clients records a change, once, and only for the firm’s own client', async () => {
    const live = await createRule(clientCreated([setStatus('IN_PROGRESS'), setPriority('HIGH')]), {
      name: mark('Set status'),
    });
    ok(await activate(live.id));
    // A rule on the status change, with the new status as its condition (AU-F08 old/new).
    const follow = await createRule(
      {
        trigger: { module: 'CLIENTS', event: 'client.status_changed' },
        conditions: [{ field: 'newStatus', operator: 'IS', value: 'IN_PROGRESS' }],
        actions: [note()],
      },
      { name: mark('On status') },
    );
    ok(await activate(follow.id));

    const id = await newClient('a', 'Status me');
    // Already In progress and High: nothing changes and nothing is recorded.
    const same = await newClient('a', 'Already set', { status: 'IN_PROGRESS', priority: 'HIGH' });
    // Firm B's client, added at the same time, is never firm A's to change.
    const theirs = await newClient('b', 'Not yours');
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 2 });

    expect(await stateOf('a', id)).toEqual({ status: 'IN_PROGRESS', priority: 'HIGH' });
    expect(await stateOf('a', same)).toEqual({ status: 'IN_PROGRESS', priority: 'HIGH' });
    expect(await stateOf('b', theirs)).toEqual({ status: 'NEW', priority: null });

    // The database's status history names the rule's owner.
    const history = await inFirm('a', (tx) =>
      tx.clientStatusHistory.findMany({
        where: { businessId: firms.a, clientId: id },
        orderBy: { seq: 'asc' },
        select: { status: true, changedByUserId: true },
      }),
    );
    expect(history.at(-1)).toEqual({ status: 'IN_PROGRESS', changedByUserId: ownerA.id });
    // Clients' client.updated entry names the field with its old and new value.
    const updates = (await auditRows(id)).filter((r) => r.action === 'client.updated');
    expect(updates).toHaveLength(2);
    expect(updates.map((r) => r.metadata)).toEqual(
      expect.arrayContaining([
        { fields: ['status'], from: 'NEW', to: 'IN_PROGRESS' },
        { fields: ['priority'], from: null, to: 'HIGH' },
      ]),
    );
    expect((await auditRows(same)).filter((r) => r.action === 'client.updated')).toEqual([]);
    const theirRows = await inFirm('b', (tx) =>
      tx.auditLog.findMany({ where: { entityId: theirs, action: 'client.updated' } }),
    );
    expect(theirRows).toEqual([]);

    // The status change starts the rule on it, once; the unchanged client starts nothing.
    expect(await engine.scanRule(firms.a, follow.id)).toMatchObject({ started: 1 });
    expect(await engine.scanRule(firms.a, follow.id)).toMatchObject({ started: 0 });
    const page = await runs(`?ruleId=${follow.id}`);
    expect(page.items.map((r) => r.client?.id)).toEqual([id]);
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));
    ok(await call('post', `/rules/${follow.id}/pause`, ownerA, {}));
  });

  it('never sets Inactive or a value outside the list, and None clears the priority', async () => {
    for (const action of [setStatus('INACTIVE'), setStatus('ARCHIVED'), setPriority('URGENT')])
      expect(
        (
          await call('post', '/rules', ownerA, {
            name: mark('Not allowed'),
            category: 'CLIENTS',
            definition: clientCreated([action]),
          })
        ).status,
      ).toBe(400);
    const clear = await createRule(clientCreated([setPriority('NONE')]), {
      name: mark('Clear priority'),
    });
    ok(await activate(clear.id));
    const id = await newClient('a', 'Clear me', { priority: 'LOW' });
    expect(await engine.scanRule(firms.a, clear.id)).toMatchObject({ started: 1 });
    expect(await stateOf('a', id)).toEqual({ status: 'NEW', priority: null });
    ok(await call('post', `/rules/${clear.id}/pause`, ownerA, {}));
  });

  it('a rule on a status change can’t set the status, but may set the priority', async () => {
    const codes = async (definition: object) =>
      AutomationPreview.parse(
        ok(await call('post', '/rules/validate', ownerA, { definition })),
      ).checks.map((c) => c.code);
    const onStatus = (actions: object[]) => ({
      trigger: { module: 'CLIENTS', event: 'client.status_changed' },
      actions,
    });
    expect(await codes(onStatus([setStatus('ACTIVE')]))).toContain('LOOP_RISK');
    expect(await codes(onStatus([setPriority('HIGH')]))).not.toContain('LOOP_RISK');
    expect(await codes(clientCreated([setStatus('ACTIVE')]))).not.toContain('LOOP_RISK');
  });
});

describe('the client’s context and each record’s own fields as conditions (AU-F22, F23)', () => {
  const overdue = { module: 'INVOICES_PAYMENTS', event: 'invoice.overdue' };
  const labels = async (conditions: object[]) =>
    AutomationMatches.parse(
      ok(await call('post', '/rules/matches', ownerA, { trigger: overdue, conditions })),
    ).sample.map((s) => s.label);
  const one = `INV-U-${run}-1`;
  const two = `INV-U-${run}-2`;

  it('offers the client’s status, tags, staff, state and dates, with the firm’s own choices only', async () => {
    const ours = await inFirm(
      'a',
      async (tx) =>
        (await tx.tag.create({ data: { businessId: firms.a, name: `Context ${run}` } })).id,
    );
    const theirs = await inFirm(
      'b',
      async (tx) =>
        (await tx.tag.create({ data: { businessId: firms.b, name: `Theirs ${run}` } })).id,
    );
    const catalog = AutomationCatalog.parse(ok(await call('get', '/catalog', ownerA)));
    const fieldsOf = (code: string) =>
      catalog.events.find((e) => e.code === code)?.conditionFields ?? [];
    const invoice = fieldsOf('invoice.overdue');
    expect(invoice.map((f) => f.field)).toEqual(
      expect.arrayContaining([
        'balanceCents',
        'paymentStatus',
        'dueOn',
        'clientStatus',
        'clientTags',
        'clientAssignedUserId',
        'clientState',
        'clientCreatedOn',
        'clientLastActivityOn',
      ]),
    );
    const tagChoices = invoice.find((f) => f.field === 'clientTags')?.options.map((o) => o.value);
    expect(tagChoices).toContain(ours);
    expect(tagChoices).not.toContain(theirs);
    expect(
      invoice.find((f) => f.field === 'clientAssignedUserId')?.options.map((o) => o.value),
    ).not.toContain(ownerB.id);
    expect(invoice.find((f) => f.field === 'dueOn')?.operators).toEqual([
      'BEFORE',
      'AFTER',
      'ON',
      'WITHIN_LAST',
      'WITHIN_NEXT',
      'EXISTS',
      'NOT_EXISTS',
    ]);
    // A client's own event has its status, tags and staff already: it takes the state and dates.
    const created = fieldsOf('client.created').map((f) => f.field);
    expect(created).toEqual(expect.arrayContaining(['clientState', 'clientCreatedOn']));
    expect(created).not.toContain('clientStatus');
    expect(fieldsOf('task.overdue').map((f) => f.field)).toEqual(
      expect.arrayContaining(['taskProgress', 'taskAssignedUserId', 'dueOn', 'clientTags']),
    );
    expect(fieldsOf('appointment.upcoming').map((f) => f.field)).toEqual(
      expect.arrayContaining(['appointmentTypeId', 'confirmation', 'serviceKind', 'startsOn']),
    );
    // Staff Management has no client: no client fields.
    expect(fieldsOf('staff.invited').map((f) => f.field)).not.toContain('clientStatus');
  });

  it('matches on the client’s context, the balance and the due date, in the firm’s days', async () => {
    const tag = await inFirm('a', async (tx) => {
      const t = await tx.tag.create({ data: { businessId: firms.a, name: `Tagged ${run}` } });
      await tx.clientTag.create({
        data: { businessId: firms.a, clientId: clients.c2, tagId: t.id, addedByUserId: ownerA.id },
      });
      await tx.clientProfile.upsert({
        where: { clientId: clients.c1 },
        create: { businessId: firms.a, clientId: clients.c1, state: 'GA' },
        update: { state: 'GA' },
      });
      return t.id;
    });
    const both = await labels([]);
    expect(both).toEqual(expect.arrayContaining([one, two]));

    expect(await labels([{ field: 'clientTags', operator: 'INCLUDES', value: [tag] }])).toEqual([
      two,
    ]);
    expect(await labels([{ field: 'clientState', operator: 'IS', value: 'GA' }])).toEqual([one]);
    expect(
      await labels([{ field: 'clientAssignedUserId', operator: 'IS', value: staffA.id }]),
    ).toEqual([one]);
    expect(
      await labels([
        { field: 'balanceCents', operator: 'GREATER_THAN', value: 7_000 },
        { field: 'paymentStatus', operator: 'IS', value: 'UNPAID' },
      ]),
    ).toEqual([one]);
    // Due 2 and 10 days ago: only the first is within the last 5 days; both are past.
    expect(await labels([{ field: 'dueOn', operator: 'WITHIN_LAST', value: 5 }])).toEqual([two]);
    expect(await labels([{ field: 'dueOn', operator: 'WITHIN_NEXT', value: 5 }])).toEqual([]);
    expect(
      await labels([
        { field: 'clientCreatedOn', operator: 'WITHIN_LAST', value: 1 },
        { field: 'clientStatus', operator: 'IS', value: 'NEW' },
      ]),
    ).toEqual(expect.arrayContaining([one, two]));
  });

  it('refuses a period that is not a number of days, or a day that is not a date', async () => {
    for (const condition of [
      { field: 'dueOn', operator: 'WITHIN_NEXT', value: 'soon' },
      { field: 'dueOn', operator: 'WITHIN_LAST', value: -1 },
      { field: 'dueOn', operator: 'ON', value: '2026-13-01' },
      { field: 'balanceCents', operator: 'NOT_CONTAINS', value: 'x' },
    ])
      expectError(
        await call('post', '/rules/matches', ownerA, { trigger: overdue, conditions: [condition] }),
        400,
        'INVALID_DEFINITION',
      );
    // Text takes Does not contain.
    ok(
      await call('post', '/rules/matches', ownerA, {
        trigger: { module: 'CLIENTS', event: 'client.created' },
        conditions: [{ field: 'source', operator: 'NOT_CONTAINS', value: 'Referral' }],
      }),
    );
  });
});

describe('Invite to book, lead follow-up and approval requests (AU-F27)', () => {
  /** A change the module records, as its audit entry (the event's source). */
  const recorded = (firm: 'a' | 'b', action: string, entityType: string, entityId: string) =>
    inFirm(firm, (tx) =>
      tx.auditLog.create({
        data: { businessId: firms[firm], action, entityType, entityId },
      }),
    );
  const stepOfRecord = async (ruleId: string, recordId: string) => {
    const page = await runs(`?ruleId=${ruleId}`);
    return (await runDetail(page.items.find((r) => r.recordId === recordId)!.id)).actions[0]!;
  };

  it('invites the client to book in the portal and books nothing', async () => {
    const live = await createRule(
      clientCreated([
        {
          id: 'invite',
          type: 'INVITE_TO_BOOK',
          config: { subject: 'Time to meet', message: 'Hello {{client.firstName}}' },
        },
      ]),
      { name: mark('Invite') },
    );
    ok(await activate(live.id));
    const id = await inFirm(
      'a',
      async (tx) =>
        (
          await tx.client.create({
            data: {
              businessId: firms.a,
              displayName: `Invite Me ${run} (fake)`,
              email: `invite-${run}@client.test`,
            },
            select: { id: true },
          })
        ).id,
    );
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    expect(await stepOfRecord(live.id, id)).toMatchObject({
      status: 'SUCCESS',
      result: { kind: 'message_thread' },
    });
    const sent = await inFirm('a', (tx) =>
      tx.message.findFirstOrThrow({
        where: { businessId: firms.a, thread: { clientId: id } },
        select: { body: true, thread: { select: { subject: true } } },
      }),
    );
    expect(sent.thread.subject).toBe('Time to meet');
    expect(sent.body).toMatch(/^Hello Invite\n\nChoose a time that suits you: .+\/appointments$/);
    // A request, never a booking.
    expect(
      await inFirm('a', (tx) =>
        tx.appointment.count({ where: { businessId: firms.a, clientId: id } }),
      ),
    ).toBe(0);
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));
  });

  it('schedules an open lead’s follow-up through Leads, never a closed one, never firm B’s', async () => {
    const live = await createRule(
      {
        trigger: { module: 'LEADS', event: 'lead.created' },
        actions: [
          {
            id: 'follow',
            type: 'SCHEDULE_LEAD_FOLLOW_UP',
            config: { followUpType: 'CALL', dueInDays: 2, notes: 'Call {{record.label}}' },
          },
        ],
      },
      { name: mark('Follow up'), category: 'LEADS' },
    );
    ok(await activate(live.id));
    const lead = (firm: 'a' | 'b', name: string, status: 'SUBMITTED' | 'LOST') =>
      inFirm(firm, async (tx) => {
        const service = await tx.service.create({
          data: { businessId: firms[firm], kind: 'OTHER', name: `${name} service ${run}` },
          select: { id: true },
        });
        return (
          await tx.lead.create({
            data: {
              businessId: firms[firm],
              serviceId: service.id,
              firstName: name,
              lastName: 'Lead (fake)',
              email: `${name.toLowerCase()}-${run}@lead.test`,
              status,
              submittedAt: new Date(),
            },
            select: { id: true },
          })
        ).id;
      });
    const open = await lead('a', 'Olive', 'SUBMITTED');
    const lost = await lead('a', 'Lou', 'LOST');
    const theirs = await lead('b', 'Bea', 'SUBMITTED');
    for (const [firm, id] of [
      ['a', open],
      ['a', lost],
      ['b', theirs],
    ] as const)
      await recorded(firm, 'lead.created', 'lead', id);
    // Firm B's lead is never firm A's event.
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 2 });

    expect(await stepOfRecord(live.id, open)).toMatchObject({
      status: 'SUCCESS',
      result: { kind: 'lead' },
    });
    const next = await inFirm('a', (tx) =>
      tx.lead.findFirstOrThrow({
        where: { businessId: firms.a, id: open },
        select: { nextActionType: true, nextActionAt: true, nextActionNote: true },
      }),
    );
    expect(next.nextActionType).toBe('CALL');
    expect(next.nextActionNote).toMatch(/^Call /);
    const inDays = (next.nextActionAt!.getTime() - Date.now()) / 86_400_000;
    expect(inDays).toBeGreaterThan(1.9);
    expect(inDays).toBeLessThan(2.1);
    // Leads' own record of it.
    expect((await auditRows(open)).map((r) => r.action)).toContain('lead.follow_up_set');
    // A closed lead has no follow-up: Leads refuses it, and the step says so.
    expect(await stepOfRecord(live.id, lost)).toMatchObject({
      status: 'FAILED',
      errorCode: 'LEAD_CLOSED',
    });
    expect(
      await inFirm('b', (tx) =>
        tx.lead.findFirstOrThrow({ where: { id: theirs }, select: { nextActionType: true } }),
      ),
    ).toEqual({ nextActionType: null });
    ok(await call('post', `/rules/${live.id}/pause`, ownerA, {}));
  });

  it('asks a reviewer for approval as a pending step, never the owner or the preparer, never twice', async () => {
    const ask = (reviewerUserId: string) => ({
      trigger: { module: 'TAX_RETURNS', event: 'tax_return.created' },
      actions: [
        {
          id: 'approve',
          type: 'REQUEST_APPROVAL',
          config: { step: 'Final Review / Approval', reviewerUserId },
        },
      ],
    });
    // The rule's owner asks, so can't be the reviewer; another firm's member is not one of ours.
    const own = await createRule(ask(ownerA.id), {
      name: mark('Own approval'),
      category: 'TAX_RETURNS',
    });
    expectError(await activate(own.id), 409, 'NOT_READY');
    const foreign = await createRule(ask(ownerB.id), {
      name: mark('Foreign approval'),
      category: 'TAX_RETURNS',
    });
    expectError(await activate(foreign.id), 409, 'NOT_READY');

    const live = await createRule(ask(adminA.id), {
      name: mark('Approval'),
      category: 'TAX_RETURNS',
    });
    ok(await activate(live.id));
    const taxReturn = (preparerUserId: string | null) =>
      inFirm('a', async (tx) => {
        const r = await tx.taxReturn.create({
          data: {
            businessId: firms.a,
            clientId: clients.c2,
            taxYear: 2024,
            filingType: 'INDIVIDUAL',
            preparerUserId,
          },
          select: { id: true },
        });
        return r.id;
      });
    const plain = await taxReturn(null);
    const theirOwn = await taxReturn(adminA.id);
    await recorded('a', 'tax_return.created', 'tax_return', plain);
    await recorded('a', 'tax_return.created', 'tax_return', theirOwn);
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 2 });

    const steps = (id: string) =>
      inFirm('a', (tx) =>
        tx.taxReturnApproval.findMany({
          where: { businessId: firms.a, taxReturnId: id },
          select: { step: true, status: true, assignedUserId: true, decidedAt: true },
        }),
      );
    // Pending, for the reviewer: Automations never decides it.
    expect(await steps(plain)).toEqual([
      {
        step: 'Final Review / Approval',
        status: 'PENDING',
        assignedUserId: adminA.id,
        decidedAt: null,
      },
    ]);
    expect(await stepOfRecord(live.id, plain)).toMatchObject({ status: 'SUCCESS' });
    // The reviewer prepared this one: nobody approves their own return.
    expect(await stepOfRecord(live.id, theirOwn)).toMatchObject({
      status: 'FAILED',
      errorCode: 'SELF_APPROVAL',
    });
    expect(await steps(theirOwn)).toEqual([]);
    // A second rule asking the same reviewer for the same step on the same return: the pending
    // step is not added twice.
    const again = await createRule(ask(adminA.id), {
      name: mark('Approval again'),
      category: 'TAX_RETURNS',
    });
    ok(await activate(again.id));
    await recorded('a', 'tax_return.created', 'tax_return', plain);
    expect(await engine.scanRule(firms.a, again.id)).toMatchObject({ started: 1 });
    expect(await stepOfRecord(again.id, plain)).toMatchObject({
      status: 'SUCCESS',
      detail: 'Already pending with this reviewer',
    });
    expect(await steps(plain)).toHaveLength(1);
    for (const id of [live.id, again.id]) ok(await call('post', `/rules/${id}/pause`, ownerA, {}));
  });

  it('a record’s action fits only that kind’s events', async () => {
    const res = await call('post', '/rules', ownerA, {
      name: mark('Wrong record'),
      category: 'CLIENTS',
      definition: clientCreated([
        {
          id: 'approve',
          type: 'REQUEST_APPROVAL',
          config: { step: 'Review', reviewerUserId: adminA.id },
        },
      ]),
    });
    expect(res.status).toBe(400);
    const catalog = AutomationCatalog.parse(ok(await call('get', '/catalog', ownerA)));
    expect(
      Object.fromEntries(
        catalog.actions.filter((a) => a.recordKind).map((a) => [a.type, a.recordKind]),
      ),
    ).toEqual({ SCHEDULE_LEAD_FOLLOW_UP: 'lead', REQUEST_APPROVAL: 'tax_return' });
  });
});

describe('Create task from a template, text messages, deadlines and services (AU-F26)', () => {
  const newClient = (name: string, data: object = {}) =>
    inFirm(
      'a',
      async (tx) =>
        (
          await tx.client.create({
            data: { businessId: firms.a, displayName: `${name} ${run} (fake)`, ...data },
            select: { id: true },
          })
        ).id,
    );
  const stepFor = async (ruleId: string, clientId: string) => {
    const page = await runs(`?ruleId=${ruleId}`);
    return (await runDetail(page.items.find((r) => r.client?.id === clientId)!.id)).actions[0]!;
  };
  const pause = (id: string) => call('post', `/rules/${id}/pause`, ownerA, {});

  it('creates a task from the firm’s template, visible to the client; another firm’s template is refused', async () => {
    const ours = await inFirm(
      'a',
      async (tx) =>
        (
          await tx.taskTemplate.create({
            data: { businessId: firms.a, name: `Onboarding ${run}` },
            select: { id: true },
          })
        ).id,
    );
    const theirs = await inFirm(
      'b',
      async (tx) =>
        (
          await tx.taskTemplate.create({
            data: { businessId: firms.b, name: `Theirs ${run}` },
            select: { id: true },
          })
        ).id,
    );
    const task = (taskTemplateId: string) => ({
      id: 'task',
      type: 'CREATE_TASK',
      config: { title: 'Welcome {{client.name}}', taskTemplateId, clientVisible: true },
    });
    const foreign = await createRule(clientCreated([task(theirs)]), { name: mark('Their tpl') });
    expectError(await activate(foreign.id), 409, 'NOT_READY');
    const catalog = AutomationCatalog.parse(ok(await call('get', '/catalog', ownerA)));
    const choices = catalog.actions
      .find((a) => a.type === 'CREATE_TASK')
      ?.fields.find((f) => f.key === 'taskTemplateId')
      ?.choices.map((c) => c.value);
    expect(choices).toContain(ours);
    expect(choices).not.toContain(theirs);

    const live = await createRule(clientCreated([task(ours)]), { name: mark('Template task') });
    ok(await activate(live.id));
    const id = await newClient('Templated');
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    const made = await stepFor(live.id, id);
    expect(made).toMatchObject({ status: 'SUCCESS', result: { kind: 'task' } });
    expect(
      await inFirm('a', (tx) =>
        tx.task.findFirstOrThrow({
          where: { businessId: firms.a, id: made.result!.id },
          select: { templateId: true, clientVisible: true, title: true },
        }),
      ),
    ).toEqual({
      templateId: ours,
      clientVisible: true,
      title: `Welcome Templated ${run} (fake)`,
    });
    ok(await pause(live.id));
  });

  it('texts only through Messages: with texting off, nothing is sent and the step says why', async () => {
    const live = await createRule(
      clientCreated([
        { id: 'sms', type: 'SEND_CLIENT_SMS', config: { body: 'Hi {{client.firstName}}' } },
      ]),
      { name: mark('Text') },
    );
    ok(await activate(live.id));
    const id = await newClient('Texty', { phone: '+15555550123' });
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 1 });
    const step = await stepFor(live.id, id);
    expect(step).toMatchObject({ status: 'FAILED', retryable: false });
    expect(step.errorCode).toMatch(/^[A-Z_]+$/);
    // Nothing went out: no sent or queued text for this client.
    expect(
      await inFirm('a', (tx) =>
        tx.outboundMessageRecipient.count({
          where: {
            businessId: firms.a,
            clientId: id,
            outbound: { status: { in: ['SENT', 'PARTIAL', 'SENDING', 'SCHEDULED'] } },
          },
        }),
      ),
    ).toBe(0);
    ok(await pause(live.id));
  });

  it('creates a deadline through Compliance & Deadlines, once', async () => {
    const deadline = {
      id: 'deadline',
      type: 'CREATE_DEADLINE',
      config: {
        name: 'Annual report for {{client.name}}',
        deadlineType: 'ANNUAL_REPORT',
        dueInDays: 30,
        priority: 'HIGH',
      },
    };
    const first = await createRule(clientCreated([deadline]), { name: mark('Deadline') });
    ok(await activate(first.id));
    const again = await createRule(clientCreated([deadline]), { name: mark('Deadline again') });
    ok(await activate(again.id));
    const id = await newClient('Deadlined');
    expect(await engine.scanRule(firms.a, first.id)).toMatchObject({ started: 1 });
    expect(await engine.scanRule(firms.a, again.id)).toMatchObject({ started: 1 });
    const rows = await inFirm('a', (tx) =>
      tx.complianceDeadline.findMany({
        where: { businessId: firms.a, clientId: id },
        select: { name: true, type: true, priority: true, dueOn: true, status: true },
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: `Annual report for Deadlined ${run} (fake)`,
      type: 'ANNUAL_REPORT',
      priority: 'HIGH',
      status: 'UPCOMING',
    });
    const days = (rows[0]!.dueOn.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(28);
    expect(days).toBeLessThan(31);
    expect(await stepFor(again.id, id)).toMatchObject({
      status: 'SUCCESS',
      detail: 'The client already has this deadline',
    });
    for (const r of [first, again]) ok(await pause(r.id));
  });

  it('adds the firm’s service through Engagements without billing, never twice; another firm’s is refused', async () => {
    const service = (firm: 'a' | 'b', name: string) =>
      inFirm(
        firm,
        async (tx) =>
          (
            await tx.service.create({
              data: { businessId: firms[firm], kind: 'BOOKKEEPING', name: `${name} ${run}` },
              select: { id: true },
            })
          ).id,
      );
    const ours = await service('a', 'Monthly books');
    const theirs = await service('b', 'Their books');
    const add = (serviceId: string) => ({ id: 'svc', type: 'ADD_SERVICE', config: { serviceId } });
    const foreign = await createRule(clientCreated([add(theirs)]), { name: mark('Their svc') });
    expectError(await activate(foreign.id), 409, 'NOT_READY');
    const catalog = AutomationCatalog.parse(ok(await call('get', '/catalog', ownerA)));
    const choices = catalog.actions
      .find((a) => a.type === 'ADD_SERVICE')
      ?.fields.find((f) => f.key === 'serviceId')
      ?.choices.map((c) => c.value);
    expect(choices).toContain(ours);
    expect(choices).not.toContain(theirs);

    const first = await createRule(clientCreated([add(ours)]), { name: mark('Add svc') });
    ok(await activate(first.id));
    const again = await createRule(clientCreated([add(ours)]), { name: mark('Add svc again') });
    ok(await activate(again.id));
    const id = await newClient('Serviced');
    expect(await engine.scanRule(firms.a, first.id)).toMatchObject({ started: 1 });
    expect(await engine.scanRule(firms.a, again.id)).toMatchObject({ started: 1 });
    const engagements = await inFirm('a', (tx) =>
      tx.engagement.findMany({
        where: { businessId: firms.a, clientId: id },
        select: { serviceId: true, title: true, nextBillingOn: true },
      }),
    );
    // One service, named for the service, with no billing started.
    expect(engagements).toEqual([
      { serviceId: ours, title: `Monthly books ${run}`, nextBillingOn: null },
    ]);
    expect(await stepFor(again.id, id)).toMatchObject({
      status: 'SUCCESS',
      detail: 'The client already has this service open',
    });
    for (const r of [first, again]) ok(await pause(r.id));
  });
});

describe('Only if on an action, and Send resource (AU-F26)', () => {
  const newClient = (name: string, data: object = {}) =>
    inFirm(
      'a',
      async (tx) =>
        (
          await tx.client.create({
            data: {
              businessId: firms.a,
              displayName: `${name} ${run} (fake)`,
              email: `${name.toLowerCase()}-${run}@client.test`,
              ...data,
            },
            select: { id: true },
          })
        ).id,
    );
  const stepsFor = async (ruleId: string, clientId: string) => {
    const page = await runs(`?ruleId=${ruleId}`);
    return runDetail(page.items.find((r) => r.client?.id === clientId)!.id);
  };
  const pause = (id: string) => call('post', `/rules/${id}/pause`, ownerA, {});

  it('runs an action only if its condition holds, and skips the actions that depend on it', async () => {
    const live = await createRule(
      clientCreated([
        {
          id: 'note',
          type: 'ADD_CLIENT_NOTE',
          config: { body: 'Business welcome' },
          onlyIf: [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }],
        },
        {
          id: 'task',
          type: 'CREATE_TASK',
          config: { title: 'Business setup' },
          dependsOn: 'note',
        },
      ]),
      { name: mark('Only if') },
    );
    ok(await activate(live.id));
    const business = await newClient('Biz', { accountType: 'BUSINESS' });
    const person = await newClient('Solo', { accountType: 'INDIVIDUAL' });
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 2 });

    const met = await stepsFor(live.id, business);
    expect(met.actions.map((a) => a.status)).toEqual(['SUCCESS', 'SUCCESS']);
    const skipped = await stepsFor(live.id, person);
    expect(skipped.actions.map((a) => a.status)).toEqual(['SKIPPED', 'SKIPPED']);
    expect(skipped.actions[0]!.detail).toBe('Its condition was not met, so it was skipped');
    // Nothing was made for the individual client.
    expect(
      await inFirm('a', (tx) =>
        tx.note.count({ where: { businessId: firms.a, clientId: person } }),
      ),
    ).toBe(0);
    expect(
      await inFirm('a', (tx) =>
        tx.task.count({ where: { businessId: firms.a, clientId: person } }),
      ),
    ).toBe(0);
    ok(await pause(live.id));

    // Checked against the event's fields, as the rule's own conditions are.
    const bad = await call('post', '/rules', ownerA, {
      name: mark('Bad only if'),
      category: 'CLIENTS',
      definition: clientCreated([
        {
          id: 'note',
          type: 'ADD_CLIENT_NOTE',
          config: { body: 'x' },
          onlyIf: [{ field: 'shoeSize', operator: 'IS', value: '9' }],
        },
      ]),
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('actions.0.onlyIf.0.field');
    // The rule's detail gives it back as saved.
    const saved = await rule(live.id);
    expect(saved.definition?.actions[0]?.onlyIf).toEqual([
      { field: 'clientType', operator: 'IS', value: 'BUSINESS' },
    ]);
  });

  it('links a published portal resource of the firm, for a business client only', async () => {
    const item = (firm: 'a' | 'b', title: string) =>
      inFirm(
        firm,
        async (tx) =>
          (
            await tx.contentItem.create({
              data: {
                businessId: firms[firm],
                kind: 'RESOURCE',
                category: 'payroll',
                title: `${title} ${run}`,
                body: 'Fake guide',
                publishedAt: new Date(),
              },
              select: { id: true },
            })
          ).id,
      );
    const ours = await item('a', 'Payroll checklist');
    const theirs = await item('b', 'Their checklist');
    const send = (resourceId: string) => ({
      id: 'res',
      type: 'SEND_RESOURCE',
      config: { resourceId, message: 'Hello {{client.firstName}}' },
    });
    const foreign = await createRule(clientCreated([send(theirs)]), { name: mark('Their res') });
    expectError(await activate(foreign.id), 409, 'NOT_READY');
    const catalog = AutomationCatalog.parse(ok(await call('get', '/catalog', ownerA)));
    const choices = catalog.actions
      .find((a) => a.type === 'SEND_RESOURCE')
      ?.fields.find((f) => f.key === 'resourceId')
      ?.choices.map((c) => c.value);
    expect(choices).toContain(ours);
    expect(choices).not.toContain(theirs);

    const live = await createRule(clientCreated([send(ours)]), { name: mark('Send res') });
    ok(await activate(live.id));
    const business = await newClient('Shop', { accountType: 'BUSINESS' });
    const person = await newClient('Single', { accountType: 'INDIVIDUAL' });
    expect(await engine.scanRule(firms.a, live.id)).toMatchObject({ started: 2 });

    expect((await stepsFor(live.id, business)).actions[0]).toMatchObject({
      status: 'SUCCESS',
      result: { kind: 'message_thread' },
    });
    const sent = await inFirm('a', (tx) =>
      tx.message.findFirstOrThrow({
        where: { businessId: firms.a, thread: { clientId: business } },
        select: { body: true, thread: { select: { subject: true } } },
      }),
    );
    expect(sent.thread.subject).toBe(`Payroll checklist ${run}`);
    expect(sent.body).toMatch(/\/resources\/payroll$/);
    // Portal resources are for business clients: the individual gets nothing.
    expect((await stepsFor(live.id, person)).actions[0]).toMatchObject({
      status: 'FAILED',
      errorCode: 'BUSINESS_ONLY',
    });
    expect(
      await inFirm('a', (tx) =>
        tx.messageThread.count({ where: { businessId: firms.a, clientId: person } }),
      ),
    ).toBe(0);
    ok(await pause(live.id));
  });
});
