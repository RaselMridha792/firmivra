import { describe, expect, it } from 'vitest';
import {
  createBrandingClient,
  createRequest,
  createSettingsOverviewClient,
  createUsersClient,
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
  it('builds the export link without paging', () => {
    const client = createUsersClient(request(fakeFetch(200, {}).fn), '/api/v1');
    expect(client.exportUrl({ role: 'STAFF', page: 3 })).toBe(
      '/api/v1/business/users/export?role=STAFF&status=all',
    );
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
