// Super Admin System Settings contract (R55): the rules the requests keep, and every path.
import { describe, expect, it } from 'vitest';
import {
  AdminGeneralSettings,
  ApiRequestError,
  CreateAdminLegalHoldRequest,
  CreateAdminMaintenanceRequest,
  SetAdminSecretRefRequest,
  createAdminSettingsClient,
  createRequest,
} from '../../src/index.js';

const ID = '0199b6a0-0000-7000-8000-000000000001';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (fn: typeof fetch) =>
  createAdminSettingsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

const general = {
  platformName: 'Firmivra',
  tagline: '',
  supportEmail: 'Support@Firmivra.test',
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
    maintenanceBanner: false,
    betaFeatures: false,
  },
} as const;

describe('admin settings schemas', () => {
  it('cleans the General fields and keeps their formats', () => {
    expect(AdminGeneralSettings.parse(general)).toMatchObject({
      tagline: null,
      supportEmail: 'support@firmivra.test',
    });
    expect(AdminGeneralSettings.safeParse({ ...general, defaultLocale: 'english' }).success).toBe(
      false,
    );
    expect(AdminGeneralSettings.safeParse({ ...general, defaultCurrency: 'usd' }).success).toBe(
      false,
    );
  });

  it('takes a secret reference, never a secret', () => {
    expect(
      SetAdminSecretRefRequest.safeParse({
        reference: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:firmivra/smtp-AbCd',
      }).success,
    ).toBe(true);
    expect(SetAdminSecretRefRequest.safeParse({ reference: 'hunter2' }).success).toBe(false);
  });

  it('holds exactly one target, and ends a window after it starts', () => {
    expect(
      CreateAdminLegalHoldRequest.safeParse({
        name: 'Fake',
        reason: 'Fake',
        category: 'communications',
        businessId: ID,
      }).success,
    ).toBe(false);
    expect(
      CreateAdminLegalHoldRequest.safeParse({ name: 'Fake', reason: 'Fake', businessId: ID })
        .success,
    ).toBe(true);
    expect(
      CreateAdminMaintenanceRequest.safeParse({
        title: 'Fake',
        message: 'Fake',
        startsAt: '2026-11-01T02:00:00.000Z',
        endsAt: '2026-11-01T01:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('api.adminSettings', () => {
  it('calls the /admin/system-settings paths', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = client(fn);
    await Promise.allSettled([
      api.overview(),
      api.general(),
      api.saveGeneral({ version: 1, value: general }),
      api.branding(),
      api.email(),
      api.testEmail({ to: 'admin@firmivra.test' }),
      api.brandAssets('LOGO'),
      api.setBrandAsset('FAVICON', { assetId: ID }),
      api.resetBrandAsset('LOGO'),
      api.secrets(),
      api.removeSecret('smtp'),
      api.features({ state: 'ON' }),
      api.emergency('reports.advanced', { disabled: true, reason: 'Fake outage' }),
      api.setFeatureOverride('reports.advanced', ID, { state: 'OFF' }),
      api.retention(),
      api.createRetentionRun('communications'),
      api.releaseHold(ID, { reason: 'Matter closed' }),
      api.startMaintenance(ID),
      api.pauseJob('email-queue', { reason: 'Fake' }),
      api.firmDefaults(),
      api.defaultVersions('user'),
    ]);
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/v1/admin/system-settings',
      'GET /api/v1/admin/system-settings/general',
      'PUT /api/v1/admin/system-settings/general',
      'GET /api/v1/admin/system-settings/branding',
      'GET /api/v1/admin/system-settings/email',
      'POST /api/v1/admin/system-settings/email/test',
      'GET /api/v1/admin/system-settings/branding/assets?kind=LOGO',
      'PUT /api/v1/admin/system-settings/branding/current/FAVICON',
      'DELETE /api/v1/admin/system-settings/branding/current/LOGO',
      'GET /api/v1/admin/system-settings/secrets',
      'DELETE /api/v1/admin/system-settings/secrets/smtp',
      'GET /api/v1/admin/system-settings/features?state=ON',
      'POST /api/v1/admin/system-settings/features/reports.advanced/emergency',
      `PUT /api/v1/admin/system-settings/features/reports.advanced/firms/${ID}`,
      'GET /api/v1/admin/system-settings/retention',
      'POST /api/v1/admin/system-settings/retention/communications/runs',
      `POST /api/v1/admin/system-settings/holds/${ID}/release`,
      `POST /api/v1/admin/system-settings/maintenance/${ID}/start`,
      'POST /api/v1/admin/system-settings/jobs/email-queue/pause',
      'GET /api/v1/admin/system-settings/defaults/firm',
      'GET /api/v1/admin/system-settings/defaults/user/versions',
    ]);
  });

  it('refuses a bad key before anything is sent', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(client(fn).updateFeature('Bad Key', {})).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });
});
