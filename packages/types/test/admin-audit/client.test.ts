// Super Admin Audit & Security contract (R55): schemas and the paths `api.adminAudit` calls.
import { describe, expect, it } from 'vitest';
import {
  ADMIN_SECURITY_DEFAULTS,
  AdminAuditEventQuery,
  AdminAuditExportRequest,
  AdminResolveAlertRequest,
  AdminSecuritySettings,
  ApiRequestError,
  createAdminAuditClient,
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
  createAdminAuditClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
const settings = (patch: (s: typeof ADMIN_SECURITY_DEFAULTS) => void) => {
  const s = structuredClone(ADMIN_SECURITY_DEFAULTS);
  patch(s);
  return s;
};

describe('admin audit schemas', () => {
  it('defaults the log to the audit view, newest first, 25 a page', () => {
    expect(AdminAuditEventQuery.parse({})).toEqual({
      view: 'audit',
      sort: 'at',
      descending: true,
      page: 1,
      pageSize: 25,
    });
    expect(AdminAuditEventQuery.parse({ descending: 'false', firm: 'platform' })).toMatchObject({
      descending: false,
      firm: 'platform',
    });
    expect(AdminAuditEventQuery.safeParse({ outcome: 'BLOCKED' }).success).toBe(false);
  });

  it("keeps the recommended defaults valid, and the database's floors", () => {
    expect(AdminSecuritySettings.parse(ADMIN_SECURITY_DEFAULTS)).toEqual(ADMIN_SECURITY_DEFAULTS);
    for (const bad of [
      settings((s) => (s.retention.retentionDays = 90)),
      settings((s) => (s.retention.archiveAfterDays = 3000)),
      settings((s) => (s.password.minLength = 6)),
      settings((s) => (s.ip.mode = 'ALLOW_LIST')),
      settings((s) => (s.methods.authenticatorApp = false)),
      settings((s) => (s.notifications.minimumSeverity = 'INFO' as never)),
    ])
      expect(AdminSecuritySettings.safeParse(bad).success).toBe(false);
    expect(
      AdminSecuritySettings.safeParse(settings((s) => (s.mfa.scope = 'OPTIONAL' as never))).success,
    ).toBe(false);
  });

  it('needs a note to resolve an alert, and an export format', () => {
    expect(AdminResolveAlertRequest.safeParse({ note: ' ' }).success).toBe(false);
    expect(AdminAuditExportRequest.safeParse({}).success).toBe(false);
    expect(AdminAuditExportRequest.parse({ format: 'CSV' })).toEqual({ format: 'CSV' });
  });
});

describe('api.adminAudit', () => {
  it('calls the /admin/audit paths', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = client(fn);
    await Promise.allSettled([
      api.facets(),
      api.summary({ from: '2026-10-01T00:00:00.000Z' }),
      api.events({ view: 'login', severity: 'HIGH' }),
      api.exportEvents({ format: 'JSON' }),
      api.event(ID),
      api.respond(ID, { action: 'MARK_REVIEWED' }),
      api.addNote(ID, { text: 'Checked with the firm' }),
      api.editNote(ID, { text: 'Checked with the firm owner' }),
      api.retractNote(ID),
      api.alerts({ status: 'OPEN' }),
      api.acknowledgeAlert(ID),
      api.resolveAlert(ID, { note: 'Password reset' }),
      api.dismissAlert(ID),
      api.assignAlert(ID, { userId: null }),
      api.settings(),
      api.saveSettings({ version: 3, settings: ADMIN_SECURITY_DEFAULTS }),
    ]);
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/v1/admin/audit/facets',
      'GET /api/v1/admin/audit/summary?from=2026-10-01T00%3A00%3A00.000Z',
      'GET /api/v1/admin/audit/events?view=login&severity=HIGH&sort=at&descending=true&page=1&pageSize=25',
      'POST /api/v1/admin/audit/exports',
      `GET /api/v1/admin/audit/events/${ID}`,
      `POST /api/v1/admin/audit/events/${ID}/respond`,
      `POST /api/v1/admin/audit/events/${ID}/notes`,
      `POST /api/v1/admin/audit/notes/${ID}/edit`,
      `POST /api/v1/admin/audit/notes/${ID}/retract`,
      'GET /api/v1/admin/audit/alerts?status=OPEN&page=1&pageSize=25',
      `POST /api/v1/admin/audit/alerts/${ID}/acknowledge`,
      `POST /api/v1/admin/audit/alerts/${ID}/resolve`,
      `POST /api/v1/admin/audit/alerts/${ID}/dismiss`,
      `POST /api/v1/admin/audit/alerts/${ID}/assign`,
      'GET /api/v1/admin/audit/policy',
      'PUT /api/v1/admin/audit/policy',
    ]);
  });

  it('refuses a bad id before anything is sent', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(client(fn).event('EVT-1')).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });
});
