// R55: the Super Admin System Settings writes for admin-scope.test.ts, each against a record of
// its own (a feature, an override, a run, a hold, maintenance windows, a job, a secret, a brand
// image) so every write meets something it can change. Images go to the sweep's in-memory store.
import { createHash, randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { UploadTicket } from '@firmivra/types';
import { supportStorage, type SupportWrite, type WriteHelpers } from './admin-support-writes.js';

type Fixtures = { users: { admin: { id: string; email: string } }; firmA: { id: string } };
const S = '/api/v1/admin/system-settings';
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
/** The PNG signature and a few bytes: what the confirm checks. */
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-scope-image'),
]);

const ids: Record<string, string> = {};
const tag = randomUUID().slice(0, 8);

/** The records the writes act on. */
export async function prepareSettings(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      for (const k of ['edit', 'emergency', 'override', 'unset'] as const) {
        ids[`feature.${k}`] = `scope.${k}_${tag}`;
        await tx.platformFeature.create({
          data: { key: ids[`feature.${k}`]!, name: `Fake scope ${k}`, defaultState: 'OFF' },
        });
      }
      await tx.platformFeatureOverride.create({
        data: { featureKey: ids['feature.unset']!, businessId: fx.firmA.id, state: 'ON' },
      });
      const policy = await tx.platformRetentionPolicy.findFirstOrThrow({
        select: { category: true, version: true },
      });
      ids.run = (
        await tx.platformRetentionRun.create({
          data: { category: policy.category, policyVersion: policy.version },
          select: { id: true },
        })
      ).id;
      ids.hold = (
        await tx.platformLegalHold.create({
          data: { name: 'Fake scope hold', reason: 'Fake', category: policy.category },
          select: { id: true },
        })
      ).id;
      const later = (days: number) => new Date(Date.now() + days * 86_400_000);
      for (const k of ['edit', 'start', 'complete', 'cancel'] as const)
        ids[`window.${k}`] = (
          await tx.platformMaintenanceWindow.create({
            data: {
              title: `Fake scope ${k}`,
              message: 'Fake',
              startsAt: later(10),
              endsAt: later(11),
            },
            select: { id: true },
          })
        ).id;
      await tx.platformMaintenanceWindow.update({
        where: { id: ids['window.complete']! },
        data: { status: 'ACTIVE' },
      });
      for (const k of ['pause', 'resume'] as const) {
        ids[`job.${k}`] = `scope_${k}_${tag}`;
        await tx.platformJobControl.create({
          data: { jobKey: ids[`job.${k}`]!, name: `Fake scope ${k}`, enabled: k === 'pause' },
        });
      }
      const assetId = randomUUID();
      await tx.platformBrandAsset.create({
        data: {
          id: assetId,
          kind: 'LOGO',
          fileName: 'scope.png',
          contentType: 'image/png',
          sizeBytes: PNG.length,
          sha256: sha256(PNG),
          s3Key: `platform/branding/${assetId}/scope.png`,
        },
      });
      await tx.platformBrandAsset.update({
        where: { id: assetId },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
      ids.asset = assetId;
    });
    // Secrets are the Super Admin's alone (admin scope).
    await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, async (tx) => {
      ids.secret = `scope_${tag}`;
      await tx.platformSecretRef.create({ data: { key: ids.secret, reference: 'local:scope' } });
    });
  } finally {
    await owner.$disconnect();
  }
}

/** A section's version now (a save names the version it started from). */
async function versionOf(read: (tx: never) => Promise<number>): Promise<number> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'platform' }, (tx) => read(tx as never));
  } finally {
    await owner.$disconnect();
  }
}
const sectionVersion = (key: string) =>
  versionOf(
    (tx: { platformSetting: { findUniqueOrThrow: (a: object) => Promise<{ version: number }> } }) =>
      tx.platformSetting.findUniqueOrThrow({ where: { key } }).then((r) => r.version),
  );
const defaultsVersion = (kind: 'FIRM' | 'USER') =>
  versionOf(
    (tx: {
      platformDefaultSet: { findFirstOrThrow: (a: object) => Promise<{ version: number }> };
    }) =>
      tx.platformDefaultSet
        .findFirstOrThrow({ where: { kind }, orderBy: { version: 'desc' } })
        .then((r) => r.version),
  );

export const GENERAL = {
  platformName: 'Firmivra',
  tagline: null,
  supportEmail: null,
  supportPhone: null,
  defaultTimeZone: 'America/New_York',
  defaultLocale: 'en-US',
  defaultCurrency: 'USD',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12H',
  numberFormat: '1,234.56',
  preferences: {
    darkModeOption: true,
    productUpdates: true,
    helpCenter: true,
    userFeedback: true,
    maintenanceBanner: true,
    betaFeatures: false,
  },
};
export const BRANDING = {
  tagline: null,
  description: null,
  colors: {
    primary: '#0066FF',
    secondary: '#00CCBB',
    accent: null,
    background: null,
    text: null,
    sidebar: null,
  },
  appearance: 'SYSTEM',
  allowUserAppearance: true,
  sidebarStyle: 'EXPANDED',
  borderRadius: 'MEDIUM',
  login: { showLogo: true, showTagline: true },
  portal: { usePlatformBranding: true, allowFirmBranding: true },
};
export const EMAIL = {
  fromName: 'Firmivra',
  fromEmail: null,
  replyTo: null,
  cc: null,
  signature: null,
  includeSignature: false,
  channels: { email: true, inApp: true, sms: true, push: false },
  digest: false,
  recipients: {
    systemAlerts: 'SUPER_ADMINS',
    firmApplications: 'SUPER_ADMINS',
    billing: 'SUPER_ADMINS',
    securityAlerts: 'SUPER_ADMINS',
  },
  maxRetries: 3,
  retryBackoffMinutes: 5,
  dailyCapPerRecipient: 50,
};
const FIRM_DEFAULTS = {
  planCode: null,
  trialDays: 14,
  timeZone: null,
  currency: null,
  dateFormat: null,
  features: [],
  notifications: { email: true, sms: false, inApp: true },
  onboarding: { sendWelcomeEmail: true, assignOnboardingTasks: false },
};
const USER_DEFAULTS = {
  role: 'STAFF',
  requireEmailVerification: true,
  timeZone: null,
  locale: null,
  appearance: null,
  notifications: { email: true, sms: false, inApp: true },
  sendWelcomeEmail: true,
};

type SettingsWrite = SupportWrite & { settingsId?: string; params?: Record<string, string> };

/** Each System Settings write with a body that passes validation and a record it can change. */
export function settingsWrites(fx: Fixtures): Record<string, SettingsWrite> {
  const upload = async (h: WriteHelpers) => {
    const res = await h.post(`${S}/branding/assets/uploads`, {
      kind: 'LOGO',
      fileName: 'scope.png',
      contentType: 'image/png',
      sizeBytes: PNG.length,
      sha256: sha256(PNG),
    });
    const ticket = res.body as UploadTicket;
    supportStorage.put(ticket, PNG);
    return ticket.uploadToken;
  };
  return {
    [`PUT ${S}/general`]: {
      body: async () => ({ version: await sectionVersion('general'), value: GENERAL }),
    },
    [`PUT ${S}/branding`]: {
      body: async () => ({ version: await sectionVersion('branding'), value: BRANDING }),
    },
    [`PUT ${S}/email`]: {
      body: async () => ({ version: await sectionVersion('email_notifications'), value: EMAIL }),
    },
    [`POST ${S}/email/test`]: { body: { to: fx.users.admin.email } },
    [`POST ${S}/branding/assets/uploads`]: {
      body: {
        kind: 'FAVICON',
        fileName: 'scope.png',
        contentType: 'image/png',
        sizeBytes: PNG.length,
        sha256: sha256(PNG),
      },
    },
    [`POST ${S}/branding/assets/uploads/confirm`]: {
      body: async (h) => ({ uploadToken: await upload(h) }),
    },
    [`PUT ${S}/branding/current/:kind`]: {
      body: async () => ({ assetId: ids.asset! }),
      params: { kind: 'LOGO' },
    },
    [`DELETE ${S}/branding/current/:kind`]: { body: {}, params: { kind: 'FAVICON' } },
    [`PUT ${S}/secrets/:key`]: {
      body: { reference: 'local:scope_new' },
      params: { key: `scope_new_${tag}` },
    },
    [`DELETE ${S}/secrets/:key`]: { body: {}, settingsId: 'secret', params: {} },
    [`POST ${S}/features`]: {
      body: async () => ({
        key: `scope.new_${randomUUID().slice(0, 8)}`,
        name: 'Fake scope new',
        defaultState: 'OFF',
      }),
    },
    [`PATCH ${S}/features/:key`]: {
      body: { name: 'Fake scope edited' },
      settingsId: 'feature.edit',
    },
    [`POST ${S}/features/:key/emergency`]: {
      body: { disabled: true, reason: 'Fake scope check' },
      settingsId: 'feature.emergency',
    },
    [`PUT ${S}/features/:key/firms/:businessId`]: {
      body: { state: 'ON' },
      settingsId: 'feature.override',
    },
    [`DELETE ${S}/features/:key/firms/:businessId`]: { body: {}, settingsId: 'feature.unset' },
    [`POST ${S}/retention/runs/:id/cancel`]: { body: {}, settingsId: 'run' },
    [`PATCH ${S}/retention/:category`]: {
      body: async () => {
        const v = await versionOf(
          (tx: {
            platformRetentionPolicy: {
              findUniqueOrThrow: (a: object) => Promise<{ version: number }>;
            };
          }) =>
            tx.platformRetentionPolicy
              .findUniqueOrThrow({ where: { category: 'export_files' } })
              .then((r) => r.version),
        );
        return { version: v, retentionDays: 7, disposition: 'DELETE', archiveAfterDays: null };
      },
      params: { category: 'export_files' },
    },
    [`POST ${S}/retention/:category/runs`]: { body: {}, params: { category: 'export_files' } },
    [`POST ${S}/holds`]: {
      body: { name: 'Fake scope hold', reason: 'Fake', category: 'export_files' },
    },
    [`POST ${S}/holds/:id/release`]: { body: { reason: 'Fake' }, settingsId: 'hold' },
    [`POST ${S}/maintenance`]: {
      body: {
        title: 'Fake scope window',
        message: 'Fake',
        startsAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 21 * 86_400_000).toISOString(),
      },
    },
    [`PATCH ${S}/maintenance/:id`]: { body: { message: 'Fake edited' }, settingsId: 'window.edit' },
    [`POST ${S}/maintenance/:id/start`]: { body: {}, settingsId: 'window.start' },
    [`POST ${S}/maintenance/:id/complete`]: { body: {}, settingsId: 'window.complete' },
    [`POST ${S}/maintenance/:id/cancel`]: { body: {}, settingsId: 'window.cancel' },
    [`POST ${S}/jobs/:key/pause`]: { body: { reason: 'Fake' }, settingsId: 'job.pause' },
    [`POST ${S}/jobs/:key/resume`]: { body: {}, settingsId: 'job.resume' },
    [`POST ${S}/defaults/firm`]: {
      body: async () => ({ basedOnVersion: await defaultsVersion('FIRM'), values: FIRM_DEFAULTS }),
    },
    [`POST ${S}/defaults/user`]: {
      body: async () => ({ basedOnVersion: await defaultsVersion('USER'), values: USER_DEFAULTS }),
    },
  };
}

/** The values a case's path params take: its own record under `:id` or `:key`, then `params`. */
export function settingsParams(c: {
  settingsId?: string;
  params?: Record<string, string>;
}): Record<string, string> {
  const own = c.settingsId ? ids[c.settingsId] : undefined;
  return { ...(own ? { id: own, key: own } : {}), ...(c.params ?? {}) };
}
