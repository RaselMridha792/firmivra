// End-to-end: R55, Super Admin System Settings (contract in packages/types/src/admin-settings):
// the landing, the versioned sections, brand images, secret references, features and firm
// overrides, retention policies, runs and holds, maintenance windows and jobs, and defaults.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdminBrandAsset,
  AdminBrandingSection,
  AdminEmailSection,
  AdminEmailStatus,
  AdminFeature,
  AdminFeatureList,
  AdminFeatureOverride,
  AdminFirmDefaultSet,
  AdminGeneralSection,
  AdminLegalHold,
  AdminMaintenanceWindow,
  AdminRetentionPolicyList,
  AdminRetentionRun,
  AdminSecretRef,
  AdminSettingsOverview,
  AdminSystemHealth,
  AdminTestEmailResult,
  type UploadTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE } from '../../src/storage/document-storage.js';
import { MemoryStorage } from '../isolation/admin-support-writes.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const people = {
  super1: { id: randomUUID(), email: `r55s-super1-${run}@r55.test`, pool: 'ADMIN' as const },
  ownerA: { id: randomUUID(), email: `r55s-owner-${run}@r55.test`, pool: 'STAFF' as const },
};
const storage = new MemoryStorage();
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake'),
]);
let firm = '';
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
async function tokenFor(email: string) {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  tokens.set(email, (res.body as { token: string }).token);
  return tokens.get(email)!;
}
async function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  body?: object,
  email = people.super1.email,
) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/admin/system-settings${path}`)
    .set('authorization', `Bearer ${await tokenFor(email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: p.pool,
          email: p.email,
          name: `Fake R55s ${p.pool}`,
        },
      });
    await tx.platformAdmin.create({ data: { userId: people.super1.id } });
    firm = (
      await tx.business.create({
        data: { slug: `r55s-${run}`, name: `Firm r55s ${run}`, status: 'ACTIVE' },
        select: { id: true },
      })
    ).id;
    await tx.platformJobControl.create({ data: { jobKey: `r55s_job_${run}`, name: 'Fake job' } });
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    // Files are scanned at once (SCAN_MODE=local), as on a developer's machine.
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue({ bucket: 'unused', region: 'us-east-1', forcePathStyle: true, scanMode: 'local' })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('sections', () => {
  it('saves General with its version, refuses a stale one, and shows it on the landing', async () => {
    const before = AdminGeneralSection.parse(ok(await call('get', '/general')));
    const value = { ...before.value, tagline: `Fake tagline ${run}`, timeFormat: '24H' as const };
    const saved = AdminGeneralSection.parse(
      ok(await call('put', '/general', { version: before.version, value })),
    );
    expect(saved).toMatchObject({
      version: before.version + 1,
      value: { tagline: `Fake tagline ${run}`, timeFormat: '24H' },
    });
    expect(saved.updatedBy).toBe('Fake R55s ADMIN');
    expectError(
      await call('put', '/general', { version: before.version, value }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('put', '/general', {
        version: saved.version,
        value: { ...value, defaultTimeZone: 'Mars/Base' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    const landing = AdminSettingsOverview.parse(ok(await call('get', '')));
    expect(landing.categories.find((c) => c.key === 'GENERAL')?.lastChangedBy).toBe(
      'Fake R55s ADMIN',
    );
    expect(landing.recentChanges[0]).toMatchObject({ label: 'Section saved' });
    expect(landing.system.totalFirms).toBeGreaterThan(0);
    ok(await call('put', '/general', { version: saved.version, value: before.value }));
  });

  it('saves Branding colours and Email, and answers a test send without a sender', async () => {
    const b = AdminBrandingSection.parse(ok(await call('get', '/branding')));
    const saved = AdminBrandingSection.parse(
      ok(
        await call('put', '/branding', {
          version: b.version,
          value: {
            ...b.value,
            colors: { ...b.value.colors, primary: '#0066FF', sidebar: '#0B2A52' },
          },
        }),
      ),
    );
    expect(saved.value.colors).toMatchObject({ primary: '#0066FF', sidebar: '#0B2A52' });
    const e = AdminEmailSection.parse(ok(await call('get', '/email')));
    expect(e.smtpConfigured).toBe(false);
    ok(await call('put', '/email', { version: e.version, value: { ...e.value, digest: true } }));
    // Sent through the configured sender (Mailpit locally), or answered without one (CI): never a save.
    const test = AdminTestEmailResult.parse(
      ok(await call('post', '/email/test', { to: 'admin@firmivra.test' })),
    );
    expect(typeof test.accepted).toBe('boolean');
    const sent = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.count({
        where: { action: 'system_settings.email_test_sent', actorUserId: people.super1.id },
      }),
    );
    expect(sent).toBe(1);
  });

  it('reports the email status (the last test from its audit row) and the system health', async () => {
    const status = AdminEmailStatus.parse(ok(await call('get', '/email/status')));
    expect(['SES', 'SMTP', 'LOG']).toContain(status.sender);
    expect(status).toMatchObject({ customSmtp: false, deliveryRate24h: null, bounced24h: null });
    // The test above wrote its audit row unless no sender is configured (log mode answers first).
    if (status.sender !== 'LOG') {
      expect(status.lastTest).not.toBeNull();
      expect(Date.now() - Date.parse(status.lastTest!.at)).toBeLessThan(5 * 60_000);
    }
    const health = AdminSystemHealth.parse(ok(await call('get', '/health')));
    const by = Object.fromEntries(health.services.map((x) => [x.key, x.status]));
    expect(by).toMatchObject({ api: 'ONLINE', database: 'ONLINE', storage: 'ONLINE' });
    for (const key of ['email', 'sms', 'payments'])
      expect(['CONFIGURED', 'NOT_CONFIGURED']).toContain(by[key]);
    const firm = await request(app.getHttpServer())
      .get('/api/v1/admin/system-settings/health')
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`);
    expect([401, 403]).toContain(firm.status);
  });

  it('is for Super Admins only', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/system-settings/general')
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`);
    expect([401, 403]).toContain(res.status);
  });
});

describe('brand images and secrets', () => {
  it('uploads, checks, puts in use and resets a logo', async () => {
    const ticket = ok(
      await call('post', '/branding/assets/uploads', {
        kind: 'LOGO',
        fileName: 'logo.png',
        contentType: 'image/png',
        sizeBytes: PNG.length,
        sha256: sha256(PNG),
      }),
      201,
    ) as UploadTicket;
    storage.put(ticket, PNG);
    const asset = AdminBrandAsset.parse(
      ok(
        await call('post', '/branding/assets/uploads/confirm', { uploadToken: ticket.uploadToken }),
        201,
      ),
    );
    expect(asset).toMatchObject({ kind: 'LOGO', scanStatus: 'CLEAN' });
    expectError(
      await call('post', '/branding/assets/uploads/confirm', { uploadToken: ticket.uploadToken }),
      410,
      'UPLOAD_EXPIRED',
    );
    const used = AdminBrandingSection.parse(
      ok(await call('put', '/branding/current/LOGO', { assetId: asset.id })),
    );
    expect(used.assets.LOGO?.id).toBe(asset.id);
    expectError(
      await call('put', '/branding/current/FAVICON', { assetId: asset.id }),
      409,
      'UPLOAD_MISMATCH',
    );
    expect(
      AdminBrandingSection.parse(ok(await call('delete', '/branding/current/LOGO'))).assets.LOGO,
    ).toBeNull();
    const bad = ok(
      await call('post', '/branding/assets/uploads', {
        kind: 'LOGO',
        fileName: 'x.png',
        contentType: 'image/png',
        sizeBytes: 4,
        sha256: sha256(Buffer.from('nope')),
      }),
      201,
    ) as UploadTicket;
    storage.put(bad, Buffer.from('nope'));
    expectError(
      await call('post', '/branding/assets/uploads/confirm', { uploadToken: bad.uploadToken }),
      409,
      'UPLOAD_MISMATCH',
    );
  });

  it('keeps a secret reference, never a secret', async () => {
    const key = `smtp_${run}`;
    const saved = AdminSecretRef.parse(
      ok(await call('put', `/secrets/${key}`, { reference: 'local:fake_smtp', hint: '4f2a' })),
    );
    expect(saved).toMatchObject({ key, hint: '4f2a', configured: true });
    expect(JSON.stringify(ok(await call('get', '/secrets')))).not.toContain('local:fake_smtp');
    expectError(
      await call('put', `/secrets/${key}`, { reference: 'hunter2' }),
      400,
      'VALIDATION_FAILED',
    );
    expect(ok(await call('delete', `/secrets/${key}`))).toEqual({ ok: true });
    expectError(await call('delete', `/secrets/${key}`), 404, 'NOT_FOUND');
  });
});

describe('features', () => {
  it('creates with dependencies, refuses a cycle, switches off in an emergency, and overrides per firm', async () => {
    const base = `r55s_${run}`;
    AdminFeature.parse(
      ok(
        await call('post', '/features', {
          key: `${base}.core`,
          name: 'Fake core',
          defaultState: 'ON',
        }),
        201,
      ),
    );
    const extra = AdminFeature.parse(
      ok(
        await call('post', '/features', {
          key: `${base}.extra`,
          name: 'Fake extra',
          defaultState: 'ON',
          dependsOn: [`${base}.core`],
        }),
        201,
      ),
    );
    expect(extra.dependsOn).toEqual([`${base}.core`]);
    expectError(
      await call('post', '/features', { key: `${base}.core`, name: 'Again', defaultState: 'ON' }),
      409,
      'CONFLICT',
    );
    expectError(
      await call('patch', `/features/${base}.core`, { dependsOn: [`${base}.extra`] }),
      409,
      'FEATURE_DEPENDENCY',
    );
    expectError(
      await call('post', '/features', {
        key: `${base}.x`,
        name: 'X',
        defaultState: 'ON',
        dependsOn: ['nope.none'],
      }),
      409,
      'FEATURE_DEPENDENCY',
    );
    const over = AdminFeatureOverride.parse(
      ok(
        await call('put', `/features/${base}.extra/firms/${firm}`, {
          state: 'ON',
          reason: 'Pilot',
        }),
      ),
    );
    expect(over).toMatchObject({ state: 'ON', effective: 'ON', firmName: `Firm r55s ${run}` });
    const off = AdminFeature.parse(
      ok(
        await call('post', `/features/${base}.core/emergency`, {
          disabled: true,
          reason: 'Fake outage',
        }),
      ),
    );
    expect(off.emergencyDisabled).toBe(true);
    const list = ok(await call('get', `/features/${base}.extra/firms`)) as {
      items: { effective: string }[];
    };
    // The core it needs is off: the firm's own ON does not win.
    expect(list.items[0]!.effective).toBe('OFF');
    const filtered = AdminFeatureList.parse(
      ok(await call('get', `/features?search=${base}&state=EMERGENCY_OFF`)),
    );
    expect(filtered.items.map((f) => f.key)).toEqual([`${base}.core`]);
    expect(ok(await call('delete', `/features/${base}.extra/firms/${firm}`))).toEqual({ ok: true });
  });
});

describe('retention, holds, maintenance and jobs', () => {
  it('changes a policy above its floor with its version, and queues and cancels a dry run', async () => {
    const list = AdminRetentionPolicyList.parse(ok(await call('get', '/retention')));
    const p = list.items.find((i) => i.category === 'declined_firm_applications')!;
    expectError(
      await call('patch', `/retention/${p.category}`, {
        version: p.version,
        retentionDays: p.minimumDays - 1,
        disposition: p.disposition,
        archiveAfterDays: null,
      }),
      400,
      'VALIDATION_FAILED',
    );
    ok(
      await call('patch', `/retention/${p.category}`, {
        version: p.version,
        retentionDays: p.retentionDays + 1,
        disposition: p.disposition,
        archiveAfterDays: null,
      }),
    );
    expectError(
      await call('patch', `/retention/${p.category}`, {
        version: p.version,
        retentionDays: p.retentionDays,
        disposition: p.disposition,
        archiveAfterDays: null,
      }),
      409,
      'SAVE_CONFLICT',
    );
    const runRow = AdminRetentionRun.parse(
      ok(await call('post', `/retention/${p.category}/runs`, {}), 201),
    );
    expect(runRow).toMatchObject({ dryRun: true, status: 'QUEUED' });
    expect(
      AdminRetentionRun.parse(ok(await call('post', `/retention/runs/${runRow.id}/cancel`))).status,
    ).toBe('CANCELLED');
    expectError(await call('post', `/retention/runs/${runRow.id}/cancel`), 409, 'STATE');
  });

  it('holds a firm and releases it once', async () => {
    const hold = AdminLegalHold.parse(
      ok(
        await call('post', '/holds', {
          name: 'Fake matter',
          reason: 'Fake litigation',
          businessId: firm,
        }),
        201,
      ),
    );
    expect(hold.firm?.id).toBe(firm);
    expect(
      AdminLegalHold.parse(
        ok(await call('post', `/holds/${hold.id}/release`, { reason: 'Closed' })),
      ).releasedAt,
    ).toBeTruthy();
    expectError(await call('post', `/holds/${hold.id}/release`, { reason: 'Again' }), 409, 'STATE');
  });

  it('schedules, edits, starts and completes maintenance, and refuses wrong moves', async () => {
    const at = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    const w = AdminMaintenanceWindow.parse(
      ok(
        await call('post', '/maintenance', {
          title: 'Fake upgrade',
          message: 'Back soon',
          startsAt: at(48),
          endsAt: at(50),
        }),
        201,
      ),
    );
    expect(w.status).toBe('SCHEDULED');
    ok(await call('patch', `/maintenance/${w.id}`, { title: 'Fake upgrade 2' }));
    expectError(await call('post', `/maintenance/${w.id}/complete`), 409, 'STATE');
    expect(
      AdminMaintenanceWindow.parse(ok(await call('post', `/maintenance/${w.id}/start`))).status,
    ).toBe('ACTIVE');
    expectError(await call('patch', `/maintenance/${w.id}`, { title: 'No' }), 409, 'STATE');
    expect(
      AdminMaintenanceWindow.parse(ok(await call('post', `/maintenance/${w.id}/complete`))).status,
    ).toBe('COMPLETED');
    const landing = AdminSettingsOverview.parse(ok(await call('get', '')));
    expect(landing.recentChanges.map((c) => c.label)).toContain('Maintenance completed');
  });

  it('pauses and resumes a job', async () => {
    const key = `r55s_job_${run}`;
    expect(ok(await call('post', `/jobs/${key}/pause`, { reason: 'Fake' }))).toMatchObject({
      enabled: false,
      pausedReason: 'Fake',
    });
    expect(ok(await call('post', `/jobs/${key}/resume`))).toMatchObject({
      enabled: true,
      pausedReason: null,
    });
  });
});

describe('defaults', () => {
  it('saves a new version, refuses a stale base or a feature switched off', async () => {
    const now = AdminFirmDefaultSet.parse(ok(await call('get', '/defaults/firm')));
    const saved = AdminFirmDefaultSet.parse(
      ok(
        await call('post', '/defaults/firm', {
          basedOnVersion: now.version,
          values: { ...now.values, trialDays: 30 },
          note: 'Fake longer trial',
        }),
        201,
      ),
    );
    expect(saved).toMatchObject({ version: now.version + 1, values: { trialDays: 30 } });
    expectError(
      await call('post', '/defaults/firm', { basedOnVersion: now.version, values: now.values }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('post', '/defaults/firm', {
        basedOnVersion: saved.version,
        values: { ...saved.values, features: ['nope.none'] },
      }),
      409,
      'FEATURE_DEPENDENCY',
    );
    const versions = ok(await call('get', '/defaults/firm/versions')) as {
      items: { version: number }[];
    };
    expect(versions.items[0]!.version).toBe(saved.version);
    const user = ok(await call('get', '/defaults/user')) as { values: { role: string } };
    expect(user.values.role).toBe('STAFF');
  });
});
