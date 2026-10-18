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
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { AUTOMATION_FILES, type AutomationFiles } from '../../src/automations/automation-files.js';
import { AutomationEngine, quietUntil } from '../../src/automations/engine.service.js';

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
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

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
      'ADD_CLIENT_NOTE',
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
    expect(v2.appliesTo).toBe('Client type is BUSINESS');
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
