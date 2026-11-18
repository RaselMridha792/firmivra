import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createBrandingClient,
  createDownload,
  createRequest,
  createSettingsOverviewClient,
  createUsersClient,
  UsersQuery,
  InviteUserRequest,
  ResetBrandingRequest,
  UpdateBrandingRequest,
} from '../../src/index.js';

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

const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const download = (fn: typeof fetch) => createDownload({ baseUrl: '/api/v1', fetch: fn });

/** A CSV the export answers, as the API sends it (byte order mark, attachment name). */
function csvFetch(text: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(`\uFEFF${text}`, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="users.csv"',
      },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('api.settingsOverview', () => {
  it('reads a firm overview without the platform fields', async () => {
    const { fn, calls } = fakeFetch(200, {
      staffUsers: { value: 10, addedThisMonth: 2 },
      securityAlerts: 1,
      recentActivity: [],
    });
    const overview = await createSettingsOverviewClient(request(fn)).get();
    expect(calls[0]?.url).toBe('/api/v1/business/settings/overview');
    expect(overview.activeCompanies).toBeUndefined();
  });
});

describe('api.branding', () => {
  it('lower-cases colours, clears with empty text and needs the version', () => {
    const parsed = UpdateBrandingRequest.parse({
      version: 'v2',
      secondaryColor: '#D4AF37',
      loginMessage: '',
    });
    expect(parsed).toMatchObject({ secondaryColor: '#d4af37', loginMessage: null });
    expect(UpdateBrandingRequest.safeParse({ secondaryColor: '#fff' }).success).toBe(false);
  });

  it('removes an asset by kind and resets only with a confirm', async () => {
    const { fn, calls } = fakeFetch(500, {});
    await createBrandingClient(request(fn))
      .removeAsset('FAVICON')
      .catch(() => undefined);
    expect(calls[0]?.url).toBe('/api/v1/business/branding/assets/FAVICON');
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(ResetBrandingRequest.safeParse({ groups: ['EMAIL'] }).success).toBe(false);
    expect(ResetBrandingRequest.safeParse({ groups: ['EMAIL'], confirm: true }).success).toBe(true);
  });
});

describe('api.users', () => {
  it('downloads the export with the session, without paging; a refusal is an error, never a file', async () => {
    const csv = csvFetch('Name,Email\r\nSample User,sample@lvp.test\r\n');
    const client = createUsersClient(request(fakeFetch(200, {}).fn), download(csv.fn));
    const file = await client.export({ role: 'STAFF', page: 3 });
    expect(csv.calls[0]?.url).toBe('/api/v1/business/users/export?role=STAFF&status=all');
    expect(csv.calls[0]?.init.credentials).toBe('include');
    expect(file).toMatchObject({ name: 'users.csv', type: 'text/csv; charset=utf-8' });
    expect(file.text).toContain('Sample User');

    const refused = fakeFetch(401, {
      error: { code: 'UNAUTHENTICATED', message: 'Sign in required', requestId: 'req-1' },
    });
    const error = await createUsersClient(request(refused.fn), download(refused.fn))
      .export()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', requestId: 'req-1' });
  });

  it('sends a selection as one comma-separated ids value, at most 100 member ids', async () => {
    const a = '0199c0a0-0a00-7000-8000-000000000001';
    const b = '0199c0a0-0a00-7000-8000-000000000002';
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 10 });
    const csv = csvFetch('Name\r\n');
    const client = createUsersClient(request(fn), download(csv.fn));
    await client.export({ ids: [a, b] });
    expect(csv.calls[0]?.url).toBe(
      `/api/v1/business/users/export?status=all&ids=${encodeURIComponent(`${a},${b}`)}`,
    );
    await client.list({ ids: `${a},${b}` });
    expect(calls[0]?.url).toContain(`ids=${encodeURIComponent(`${a},${b}`)}`);
    expect(UsersQuery.safeParse({ ids: 'not-an-id' }).success).toBe(false);
    expect(UsersQuery.safeParse({ ids: '' }).success).toBe(false);
    expect(UsersQuery.safeParse({ ids: Array.from({ length: 101 }, () => a) }).success).toBe(false);
  });

  it('filters by one custom role id', async () => {
    const a = '0199c0a0-0a00-7000-8000-000000000001';
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 10 });
    await createUsersClient(request(fn), download(fn)).list({ customRoleId: a });
    expect(calls[0]?.url).toContain(`customRoleId=${a}`);
    expect(UsersQuery.safeParse({ customRoleId: 'BOOKKEEPER' }).success).toBe(false);
  });

  it('never invites an owner', () => {
    expect(
      InviteUserRequest.safeParse({ name: 'A B', email: 'a@b.test', role: 'OWNER' }).success,
    ).toBe(false);
    expect(
      InviteUserRequest.safeParse({ name: 'A B', email: 'a@b.test', role: 'STAFF' }).success,
    ).toBe(true);
  });
});
