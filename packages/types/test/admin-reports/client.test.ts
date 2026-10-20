// Super Admin Reports & Analytics contract (R55): request rules and every path.
import { describe, expect, it } from 'vitest';
import {
  AdminFirmsReportQuery,
  AdminReportRunRequest,
  ApiRequestError,
  SaveAdminReportRequest,
  createAdminReportsClient,
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
  createAdminReportsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('admin reports schemas', () => {
  it('defaults the builder to the last 30 days, the first page', () => {
    expect(AdminReportRunRequest.parse({ type: 'FIRMS', fields: ['firm.name'] })).toEqual({
      type: 'FIRMS',
      fields: ['firm.name'],
      filters: {},
      dateRange: { preset: 'LAST_30_DAYS' },
      sort: [],
      page: 1,
      pageSize: 25,
    });
    expect(AdminReportRunRequest.safeParse({ type: 'FIRMS', fields: [] }).success).toBe(false);
    expect(
      AdminReportRunRequest.safeParse({
        type: 'FIRMS',
        fields: ['firm.name'],
        dateRange: { from: '2026-10-14', to: '2026-10-01' },
      }).success,
    ).toBe(false);
  });

  it('pages the firms report, and names a saved report', () => {
    expect(AdminFirmsReportQuery.parse({ descending: 'true' })).toMatchObject({
      sort: 'name',
      descending: true,
      page: 1,
    });
    expect(
      SaveAdminReportRequest.safeParse({ name: ' ', type: 'FIRMS', fields: ['firm.name'] }).success,
    ).toBe(false);
  });
});

describe('api.adminReports', () => {
  it('calls the /admin/reports paths', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = client(fn);
    await Promise.allSettled([
      api.overview({ from: '2026-10-01', to: '2026-10-14' }),
      api.revenue(),
      api.users(),
      api.featureUsage({ feature: 'esign.send' }),
      api.support(),
      api.firms({ status: 'ACTIVE' }),
      api.firm(ID),
      api.fields('FIRMS'),
      api.run({ type: 'FIRMS', fields: ['firm.name'] }),
      api.export({ type: 'FIRMS', fields: ['firm.name'], format: 'CSV' }),
      api.saved(),
      api.save({ name: 'Fake', type: 'FIRMS', fields: ['firm.name'] }),
      api.updateSaved(ID, { shared: true }),
      api.deleteSaved(ID),
      api.runSaved(ID),
      api.duplicateSaved(ID),
    ]);
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/v1/admin/reports/overview?from=2026-10-01&to=2026-10-14',
      'GET /api/v1/admin/reports/revenue',
      'GET /api/v1/admin/reports/users',
      'GET /api/v1/admin/reports/feature-usage?feature=esign.send',
      'GET /api/v1/admin/reports/support',
      'GET /api/v1/admin/reports/firms?status=ACTIVE&sort=name&descending=false&page=1&pageSize=25',
      `GET /api/v1/admin/reports/firms/${ID}`,
      'GET /api/v1/admin/reports/builder/fields?type=FIRMS',
      'POST /api/v1/admin/reports/builder/run',
      'POST /api/v1/admin/reports/builder/export',
      'GET /api/v1/admin/reports/saved',
      'POST /api/v1/admin/reports/saved',
      `PATCH /api/v1/admin/reports/saved/${ID}`,
      `DELETE /api/v1/admin/reports/saved/${ID}`,
      `POST /api/v1/admin/reports/saved/${ID}/run?page=1&pageSize=25`,
      `POST /api/v1/admin/reports/saved/${ID}/duplicate`,
    ]);
  });

  it('refuses a bad id before anything is sent', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(client(fn).firm('lvp')).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });
});
