import { describe, expect, it } from 'vitest';
import {
  AdminSupportAccessQuery,
  ApiRequestError,
  ApproveSupportAccessRequest,
  createAdminSupportAccessClient,
  createRequest,
  createSupportAccessClient,
  CreateSupportAccessRequest,
  FirmSupportAccess,
  SupportAccessErrorCode,
  SupportAccessQuery,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6e1-0000-7000-8000-000000000001';
const businessId = '0199b6e0-0000-7000-8000-000000000001';
const at = '2026-10-13T14:00:00.000Z';
const firmView = {
  id,
  reason: 'A client upload fails (fake)',
  status: 'PENDING',
  requestedAt: at,
  approvedBy: null,
  expiresAt: null,
  endedAt: null,
};
const adminView = {
  ...firmView,
  firm: { id: businessId, name: 'Mock Firm', slug: 'mock' },
  admin: { userId: '0199b6e0-0000-7000-8000-0000000000a1', name: 'Mock Super Admin' },
};
delete (adminView as Partial<typeof firmView>).approvedBy;

describe('support access schemas', () => {
  it('takes a one-line reason of at most 500 characters, which the firm reads', () => {
    const reason = (value: unknown) => CreateSupportAccessRequest.safeParse({ reason: value });
    expect(reason('  Checking a failed upload  ').data).toEqual({
      reason: 'Checking a failed upload',
    });
    expect(reason('x'.repeat(500)).success).toBe(true);
    for (const bad of ['', '   ', 'x'.repeat(501), 'two\nlines', 'a\u0000b', 42]) {
      expect(reason(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(CreateSupportAccessRequest.safeParse({ reason: 'ok', hours: 2 }).success).toBe(false);
  });

  it('approves for 1 to 72 whole hours, 24 when left out', () => {
    expect(ApproveSupportAccessRequest.parse({})).toEqual({ hours: 24 });
    expect(ApproveSupportAccessRequest.parse({ hours: 72 })).toEqual({ hours: 72 });
    for (const bad of [0, 73, 1.5, -1, '12']) {
      expect(ApproveSupportAccessRequest.safeParse({ hours: bad }).success, String(bad)).toBe(
        false,
      );
    }
  });

  it('shows the firm the reason and status, never who asked', () => {
    expect(FirmSupportAccess.parse(firmView)).toEqual(firmView);
    expect(Object.keys(FirmSupportAccess.shape)).not.toContain('admin');
    expect(SupportAccessQuery.parse({})).toEqual({ limit: 25 });
    expect(AdminSupportAccessQuery.safeParse({ businessId: 'nope' }).success).toBe(false);
    expect(SupportAccessErrorCode.options).toEqual([
      'SUPPORT_REQUEST_OPEN',
      'SUPPORT_REQUEST_DECIDED',
      'SUPPORT_GRANT_NOT_ACTIVE',
      'SUPPORT_GRANT_REQUIRED',
    ]);
  });
});

describe('support access clients', () => {
  it("call the firm's routes with checked bodies", async () => {
    const { fn, calls } = fakeFetch(200, firmView);
    const client = createSupportAccessClient(
      createRequest({ baseUrl: '/api/v1', businessId: 'b1', fetch: fn }),
    );
    await client.approve(id, { hours: 8 });
    await client.approve(id);
    await client.decline(id);
    await client.revoke(id);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', `/api/v1/business/support-access/${id}/approve`, { hours: 8 }],
      ['POST', `/api/v1/business/support-access/${id}/approve`, { hours: 24 }],
      ['POST', `/api/v1/business/support-access/${id}/decline`, {}],
      ['POST', `/api/v1/business/support-access/${id}/revoke`, {}],
    ]);
    const list = fakeFetch(200, { items: [firmView], nextCursor: null });
    await createSupportAccessClient(
      createRequest({ baseUrl: '/api/v1', businessId: 'b1', fetch: list.fn }),
    ).list({ status: 'PENDING', cursor: 'c2' });
    expect(list.calls[0]?.url).toBe(
      '/api/v1/business/support-access?status=PENDING&cursor=c2&limit=25',
    );
  });

  it("call the Super Admin's routes, and refuse bad input before sending", async () => {
    const { fn, calls } = fakeFetch(201, adminView);
    const client = createAdminSupportAccessClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    await client.request(businessId, { reason: 'A client upload fails (fake)' });
    expect(calls[0]).toEqual({
      method: 'POST',
      url: `/api/v1/admin/firms/${businessId}/support-access`,
      body: { reason: 'A client upload fails (fake)' },
    });
    for (const bad of [
      () => client.request('not-a-firm', { reason: 'x' }),
      () => client.request(businessId, { reason: '' }),
      () => client.list({ businessId: 'nope' }),
    ]) {
      const err = await bad().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).status).toBe(400);
    }
    expect(calls).toHaveLength(1);
  });
});
