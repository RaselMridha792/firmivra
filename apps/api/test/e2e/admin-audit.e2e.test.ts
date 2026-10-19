// End-to-end: R55, Super Admin Audit & Security (contract in packages/types/src/admin-audit): the
// cross-firm event log with its filters and the classification of rows written before the
// normalized fields, Event Details, response actions, investigation notes, security alerts,
// exports and the platform security policy. Super Admins only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  ADMIN_SECURITY_DEFAULTS,
  AdminAuditEventDetail,
  AdminAuditEventPage,
  AdminAuditExport,
  AdminAuditFacets,
  AdminAuditNote,
  AdminAuditRespondResult,
  AdminAuditSummary,
  AdminSecurityAlert,
  AdminSecurityAlertPage,
  AdminSecuritySettingsRecord,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string, pool: 'STAFF' | 'ADMIN') => ({
  id: randomUUID(),
  email: `r55a-${key}-${run}@r55.test`,
  pool,
});
const people = {
  super1: person('super1', 'ADMIN'),
  super2: person('super2', 'ADMIN'),
  ownerA: person('owner-a', 'STAFF'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const events = {} as Record<
  | 'signedIn'
  | 'failed1'
  | 'failed2'
  | 'roleChanged'
  | 'locked'
  | 'classified'
  | 'exported'
  | 'other',
  string
>;

let app: INestApplication;
const tokens = new Map<string, string>();

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
  method: 'get' | 'post' | 'put',
  path: string,
  who: Who = people.super1,
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/admin/audit${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const page = async (q: string) =>
  AdminAuditEventPage.parse(ok(await call('get', `/events?firm=${firms.a}&${q}`)));

beforeAll(async () => {
  // The B4 migration's own row; a local test database reused from before it was kept may lack it.
  await asOwner({ kind: 'platform' }, (tx) =>
    tx.$executeRawUnsafe(`INSERT INTO platform_security_policy (id, version, mfa, password, session,
      login_protection, admin_access, api_integrations, audit_retention, export_controls,
      alert_routing, updated_at)
    VALUES (1, 1, '{"requiredFor": "PLATFORM_ADMINS", "roleKeys": [], "methods": ["TOTP"]}',
      '{"minLength": 12, "requireUppercase": true, "requireLowercase": true, "requireNumber": true, "requireSymbol": false, "preventReuseCount": 5, "rotationDays": null}',
      '{"idleTimeoutMinutes": 30, "maxLifetimeHours": 12, "concurrentSessions": "ALLOW", "adminsCanRevokeAll": true}',
      '{"maxFailedAttempts": 5, "lockoutMinutes": 15, "suspiciousLoginAlerts": true, "ipAllowList": [], "ipBlockList": []}',
      '{"reauthForHighRiskChanges": true, "reauthWindowMinutes": 10}',
      '{"maskSecrets": true, "tokenLifetimeDays": 90, "rotationReminderDays": 14, "requireWebhookSignatures": true, "disableAfterAuthFailures": 5}',
      '{"retentionDays": 2555, "archiveAfterDays": 365, "editable": false}',
      '{"exportRoleKeys": [], "requireReauth": true, "linkExpiryHours": 24}',
      '{"inApp": true, "email": true, "sms": false, "webhook": false, "minimumSeverity": "HIGH", "recipientRoleKeys": []}',
      now()) ON CONFLICT (id) DO NOTHING`),
  );
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: p.pool,
          email: p.email,
          name: `Fake R55a ${key}`,
        },
      });
    await tx.platformAdmin.create({ data: { userId: people.super1.id } });
    await tx.platformAdmin.create({ data: { userId: people.super2.id } });
    for (const key of ['a', 'b'] as const) {
      const slug = `r55a-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  await asOwner({ kind: 'business', businessId: firms.a }, async (tx) => {
    await tx.membership.create({
      data: { businessId: firms.a, userId: people.ownerA.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
    const add = async (
      key: keyof typeof events,
      action: string,
      minutesAgo: number,
      extra: Record<string, unknown> = {},
    ) => {
      events[key] = (
        await tx.auditLog.create({
          data: {
            businessId: firms.a,
            actorUserId: people.ownerA.id,
            action,
            entityType: 'membership',
            entityId: `m-${key}`,
            ip: '203.0.113.7',
            userAgent:
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            targetLabel: `Fake target ${key} ${run}`,
            createdAt: at(minutesAgo),
            ...extra,
          },
          select: { id: true },
        })
      ).id;
    };
    await add('signedIn', 'auth.signed_in', 60);
    await add('failed1', 'auth.sign_in_failed', 50);
    await add('failed2', 'auth.sign_in_failed', 49);
    await add('roleChanged', 'membership.role_changed', 40, {
      metadata: { role: { from: 'STAFF', to: 'ADMIN' }, email: 'someone@example.test' },
    });
    await add('locked', 'staff.locked', 30);
    await add('exported', 'clients.exported', 20);
    await add('other', 'clients.updated', 10);
    await add('classified', 'custom.check', 5, {
      category: 'SECURITY',
      severity: 'CRITICAL',
      outcome: 'DENIED',
      actorType: 'STAFF',
      actorName: 'Fake Snapshot Name',
      actorRole: 'OWNER',
    });
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

describe('the log', () => {
  it("lists a firm's events newest first, classifying the rows written before the fields", async () => {
    const all = await page('pageSize=100');
    expect(all.total).toBe(8);
    expect(all.items[0]!.id).toBe(events.classified);
    expect(all.items[0]).toMatchObject({
      category: 'SECURITY',
      severity: 'CRITICAL',
      outcome: 'DENIED',
      classified: true,
      actor: { name: 'Fake Snapshot Name', role: 'OWNER' },
      firm: { id: firms.a, name: `Firm r55a-a-${run}` },
    });
    const failed = all.items.find((e) => e.id === events.failed1)!;
    expect(failed).toMatchObject({
      type: 'auth.sign_in_failed',
      action: 'Sign In Failed',
      category: 'AUTHENTICATION',
      severity: 'MEDIUM',
      outcome: 'FAILURE',
      classified: false,
      actor: { name: 'Fake R55a ownerA' },
      device: { ip: '203.0.113.7', browser: 'Chrome', os: 'Windows', label: 'Chrome / Windows' },
    });
    expect(failed.reference).toMatch(/^EVT-\d{8}-[0-9A-F]{6}$/);
  });

  it('filters by view, severity, outcome, action and search alike for both kinds of rows', async () => {
    const ids = async (q: string) =>
      (await page(`${q}&pageSize=100`)).items.map((e) => e.id).sort();
    expect(await ids('view=login')).toEqual(
      [events.signedIn, events.failed1, events.failed2].sort(),
    );
    expect(await ids('view=permissions')).toEqual([events.roleChanged]);
    expect(await ids('view=security')).toEqual(
      [events.roleChanged, events.locked, events.classified].sort(),
    );
    expect(await ids('severity=HIGH')).toEqual([events.roleChanged, events.locked].sort());
    expect(await ids('outcome=FAILURE')).toEqual([events.failed1, events.failed2].sort());
    expect(await ids('view=data')).toEqual([events.exported, events.other].sort());
    expect(await ids('action=auth.sign_in_failed')).toEqual(
      [events.failed1, events.failed2].sort(),
    );
    expect(await ids(`search=target%20locked%20${run}`)).toEqual([events.locked]);
    const two = await page('pageSize=3&page=2');
    expect([two.total, two.items.length, two.page]).toEqual([8, 3, 2]);
  });

  it('gives the filters their choices and the cards their counts', async () => {
    const facets = AdminAuditFacets.parse(ok(await call('get', '/facets')));
    expect(facets.firms.map((f) => f.id)).toContain(firms.a);
    expect(facets.actions).toEqual(expect.arrayContaining(['auth.sign_in_failed', 'staff.locked']));
    expect(facets.users.map((u) => u.id)).toContain(people.ownerA.id);
    const summary = AdminAuditSummary.parse(ok(await call('get', '/summary')));
    expect(summary.failedLogins.value).toBeGreaterThanOrEqual(2);
    expect(summary.criticalEvents.value).toBeGreaterThanOrEqual(1);
    expect(summary.activeSessions).toBeNull();
  });

  it('is for Super Admins only', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/audit/events')
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`);
    // A firm login is not a Super Admin: refused at the guard (401 for the wrong pool, or 403).
    expect([401, 403]).toContain(res.status);
  });
});

describe('Event Details and responses', () => {
  it('shows masked changes, related events, neighbours and what can be done', async () => {
    const d = AdminAuditEventDetail.parse(ok(await call('get', `/events/${events.roleChanged}`)));
    expect(d.changes).toEqual(
      expect.arrayContaining([
        { field: 'role', before: 'STAFF', after: 'ADMIN', masked: false },
        { field: 'email', before: null, after: '••••', masked: true },
      ]),
    );
    expect(d.related.map((e) => e.id)).toContain(events.failed1);
    expect(d.previousId).toBeTruthy();
    expect(d.nextId).toBeTruthy();
    const byAction = Object.fromEntries(d.actions.map((a) => [a.action, a.enabled]));
    expect(byAction).toMatchObject({
      MARK_REVIEWED: true,
      SEND_ALERT: true,
      RESET_PASSWORD: false,
    });
    expectError(await call('get', `/events/${randomUUID()}`), 404, 'NOT_FOUND');
  });

  it('marks an event reviewed once, as a new row naming it', async () => {
    const first = AdminAuditRespondResult.parse(
      ok(
        await call('post', `/events/${events.locked}/respond`, people.super1, {
          action: 'MARK_REVIEWED',
        }),
      ),
    );
    expect(first.event).toMatchObject({
      type: 'audit.event_reviewed',
      relatedEventId: events.locked,
    });
    const again = AdminAuditRespondResult.parse(
      ok(
        await call('post', `/events/${events.locked}/respond`, people.super2, {
          action: 'MARK_REVIEWED',
        }),
      ),
    );
    expect(again.event.id).toBe(first.event.id);
    const d = AdminAuditEventDetail.parse(ok(await call('get', `/events/${events.locked}`)));
    expect(d.event.reviewedAt).toBeTruthy();
    expect(d.timeline.map((e) => e.id)).toContain(first.event.id);
    // Reviews are their event's timeline, not rows of the log.
    expect((await page('pageSize=100')).total).toBe(8);
  });

  it('raises one alert per event, and refuses what the console cannot do yet', async () => {
    const res = AdminAuditRespondResult.parse(
      ok(
        await call('post', `/events/${events.failed1}/respond`, people.super1, {
          action: 'SEND_ALERT',
          reason: 'Two failures in a minute',
        }),
      ),
    );
    expect(res.alert).toMatchObject({
      status: 'OPEN',
      severity: 'MEDIUM',
      eventId: events.failed1,
    });
    expectError(
      await call('post', `/events/${events.failed1}/respond`, people.super1, {
        action: 'SEND_ALERT',
      }),
      409,
      'ACTION_UNAVAILABLE',
    );
    expectError(
      await call('post', `/events/${events.failed1}/respond`, people.super1, {
        action: 'RESET_PASSWORD',
      }),
      409,
      'ACTION_UNAVAILABLE',
    );
    const withAlert = await page('alert=OPEN&pageSize=100');
    expect(withAlert.items.map((e) => e.id)).toEqual([events.failed1]);
  });
});

describe('alerts', () => {
  it('acknowledges, assigns, resolves with a note, and never moves a closed alert', async () => {
    const list = AdminSecurityAlertPage.parse(ok(await call('get', `/alerts?firm=${firms.a}`)));
    const alert = list.items[0]!;
    expect(alert.firm.id).toBe(firms.a);
    const acked = AdminSecurityAlert.parse(
      ok(await call('post', `/alerts/${alert.id}/acknowledge`)),
    );
    expect(acked.status).toBe('ACKNOWLEDGED');
    const assigned = AdminSecurityAlert.parse(
      ok(
        await call('post', `/alerts/${alert.id}/assign`, people.super1, {
          userId: people.super2.id,
        }),
      ),
    );
    expect(assigned.assignedTo).toEqual({ id: people.super2.id, name: 'Fake R55a super2' });
    expectError(
      await call('post', `/alerts/${alert.id}/assign`, people.super1, { userId: people.ownerA.id }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/alerts/${alert.id}/resolve`, people.super1, { note: ' ' }),
      400,
      'VALIDATION_FAILED',
    );
    const resolved = AdminSecurityAlert.parse(
      ok(
        await call('post', `/alerts/${alert.id}/resolve`, people.super2, {
          note: 'Owner confirmed it was them',
        }),
      ),
    );
    expect(resolved).toMatchObject({
      status: 'RESOLVED',
      resolutionNote: 'Owner confirmed it was them',
    });
    expect(resolved.closedAt).toBeTruthy();
    expectError(
      await call('post', `/alerts/${alert.id}/dismiss`, people.super1, {}),
      409,
      'ALERT_STATE',
    );
  });
});

describe('investigation notes', () => {
  it('adds, corrects and retracts, by the author only', async () => {
    const note = AdminAuditNote.parse(
      ok(
        await call('post', `/events/${events.classified}/notes`, people.super1, {
          text: 'Called the firm',
        }),
        201,
      ),
    );
    expect(note).toMatchObject({
      text: 'Called the firm',
      isYours: true,
      author: { name: 'Fake R55a super1' },
    });
    expectError(
      await call('post', `/notes/${note.id}/edit`, people.super2, { text: 'Not mine' }),
      409,
      'NOTE_STATE',
    );
    const edited = AdminAuditNote.parse(
      ok(
        await call('post', `/notes/${note.id}/edit`, people.super1, {
          text: 'Called the firm owner',
        }),
        201,
      ),
    );
    expect(edited.supersedesId).toBe(note.id);
    expectError(
      await call('post', `/notes/${note.id}/edit`, people.super1, { text: 'Again' }),
      409,
      'NOTE_STATE',
    );
    const retracted = AdminAuditNote.parse(ok(await call('post', `/notes/${edited.id}/retract`)));
    expect(retracted.retractedAt).toBeTruthy();
    expectError(await call('post', `/notes/${edited.id}/retract`), 409, 'NOTE_STATE');
    const d = AdminAuditEventDetail.parse(ok(await call('get', `/events/${events.classified}`)));
    expect(d.notes.map((n) => n.id)).toEqual([note.id, edited.id]);
  });
});

describe('export', () => {
  it('exports the filtered list as CSV or JSON, and audits it', async () => {
    const csv = AdminAuditExport.parse(
      ok(
        await call('post', '/exports', people.super1, { format: 'CSV', query: { firm: firms.a } }),
      ),
    );
    // The firm's events and the Super Admins' rows about them (alerts, notes) so far.
    const total = (await page('pageSize=1')).total;
    expect(csv.rowCount).toBe(total);
    expect(csv.content.split('\r\n')[0]).toContain('Event ID,Date & Time (UTC),Category');
    const json = AdminAuditExport.parse(
      ok(
        await call('post', '/exports', people.super1, {
          format: 'JSON',
          query: { firm: firms.a, view: 'login' },
        }),
      ),
    );
    expect((JSON.parse(json.content) as unknown[]).length).toBe(3);
    const exported = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.count({ where: { action: 'audit.exported', actorUserId: people.super1.id } }),
    );
    expect(exported).toBe(2);
  });
});

describe('security policy', () => {
  it('saves with the version, records what changed, and refuses a stale save', async () => {
    const before = AdminSecuritySettingsRecord.parse(ok(await call('get', '/policy')));
    expect(before.settings.mfa.scope).toBe('ADMINS');
    const settings = structuredClone(before.settings);
    settings.password.minLength = before.settings.password.minLength === 14 ? 15 : 14;
    settings.ip = { mode: 'ALLOW_LIST', allowList: ['203.0.113.0/24'], blockList: [] };
    const saved = AdminSecuritySettingsRecord.parse(
      ok(await call('put', '/policy', people.super1, { version: before.version, settings })),
    );
    expect(saved.version).toBe(before.version + 1);
    expect(saved.settings.password.minLength).toBe(settings.password.minLength);
    expect(saved.settings.ip).toEqual(settings.ip);
    expect(saved.updatedBy).toBe('Fake R55a super1');
    expectError(
      await call('put', '/policy', people.super2, { version: before.version, settings }),
      409,
      'SAVE_CONFLICT',
    );
    const changed = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'policy.changed', actorUserId: people.super1.id },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(changed).toMatchObject({ category: 'SECURITY', severity: 'HIGH' });
    expect(JSON.stringify(changed.metadata)).toContain('password.minLength');
    // Put the platform back the way it was for other tests.
    ok(
      await call('put', '/policy', people.super1, {
        version: saved.version,
        settings: before.settings,
      }),
    );
  });

  it('keeps audit retention fixed where the policy says so', async () => {
    const now = AdminSecuritySettingsRecord.parse(ok(await call('get', '/policy')));
    expect(now.retentionEditable).toBe(false);
    expectError(
      await call('put', '/policy', people.super1, {
        version: now.version,
        settings: { ...now.settings, retention: { retentionDays: 3650, archiveAfterDays: 365 } },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(ADMIN_SECURITY_DEFAULTS.retention.retentionDays).toBe(2555);
  });
});
