import { describe, expect, it } from 'vitest';
import {
  ADMIN_NOTIFICATION_ERRORS,
  AdminNotification,
  AdminNotificationErrorCode,
  ApiRequestError,
  BulkAdminNotificationsRequest,
  createAdminNotificationsClient,
  createRequest,
  ListAdminNotificationsQuery,
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

const id = '0199c1a0-0000-7000-8000-000000000001';
const at = '2026-10-19T09:00:00.000Z';
const client = (fn: typeof fetch) =>
  createAdminNotificationsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

/** A synthetic item as the API answers it. */
const item = (): AdminNotification => ({
  id,
  category: 'FIRM_APPLICATIONS',
  type: 'firm_application.submitted',
  priority: 'HIGH',
  title: 'New Firm Application',
  body: 'A new firm application is awaiting review.',
  source: {
    type: 'firm_application',
    id: '0199c1a0-0000-7000-8000-0000000000a1',
    label: 'Sample Tax Partners',
  },
  business: null,
  requiresAction: true,
  attention: 'ACTION_REQUIRED',
  readAt: null,
  resolvedAt: null,
  resolvedBy: null,
  dismissedAt: null,
  occurredAt: at,
  createdAt: at,
});

describe('admin notifications client', () => {
  it('lists with filters as a query string and defaults the paging', async () => {
    const { fn, calls } = fakeFetch(200, { items: [item()], total: 1, page: 1, pageSize: 20 });
    const page = await client(fn).list({ status: 'UNREAD', category: 'SECURITY', search: 'login' });
    expect(page.items[0]?.title).toBe('New Firm Application');
    expect(calls[0]?.url).toContain('/api/v1/admin/notifications?');
    expect(calls[0]?.url).toContain('status=UNREAD');
    expect(calls[0]?.url).toContain('category=SECURITY');
    expect(calls[0]?.url).toContain('page=1');
    expect(calls[0]?.url).toContain('pageSize=20');
  });

  it('refuses a range that ends before it starts, before anything is sent', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(
      client(fn).list({ from: '2026-10-19T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
    expect(ListAdminNotificationsQuery.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it('posts each action to its own route with an empty body', async () => {
    const { fn, calls } = fakeFetch(200, { ...item(), readAt: at });
    const c = client(fn);
    await c.read(id);
    await c.unread(id);
    await c.resolve(id);
    await c.dismiss(id);
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      `POST /api/v1/admin/notifications/${id}/read`,
      `POST /api/v1/admin/notifications/${id}/unread`,
      `POST /api/v1/admin/notifications/${id}/resolve`,
      `POST /api/v1/admin/notifications/${id}/dismiss`,
    ]);
    expect(calls[0]?.body).toEqual({});
  });

  it('refuses an id that is not a uuid before anything is sent', async () => {
    const { fn, calls } = fakeFetch(200, item());
    await expect(client(fn).read('not-an-id')).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });

  it('checks a bulk request: 1 to 100 ids and a known action', () => {
    expect(BulkAdminNotificationsRequest.safeParse({ ids: [], action: 'READ' }).success).toBe(
      false,
    );
    expect(
      BulkAdminNotificationsRequest.safeParse({ ids: Array(101).fill(id), action: 'READ' }).success,
    ).toBe(false);
    expect(BulkAdminNotificationsRequest.safeParse({ ids: [id], action: 'DELETE' }).success).toBe(
      false,
    );
    expect(BulkAdminNotificationsRequest.safeParse({ ids: [id], action: 'DISMISS' }).success).toBe(
      true,
    );
  });

  it('reads the bell and the summary', async () => {
    const recent = fakeFetch(200, { items: [item()], unread: 3 });
    expect((await client(recent.fn).recent()).unread).toBe(3);
    expect(recent.calls[0]?.url).toBe('/api/v1/admin/notifications/recent?limit=5');
    const count = fakeFetch(200, { count: 7 });
    expect((await client(count.fn).unreadCount()).count).toBe(7);
    const summary = fakeFetch(200, {
      total: 9,
      unread: 7,
      actionRequired: 2,
      critical: 1,
      resolvedToday: 0,
    });
    expect((await client(summary.fn).summary()).actionRequired).toBe(2);
  });

  it('marks all read with the filter as the body', async () => {
    const { fn, calls } = fakeFetch(200, { updated: 4 });
    expect((await client(fn).markAllRead({ category: 'BILLING_SUBSCRIPTIONS' })).updated).toBe(4);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/admin/notifications/mark-all-read',
      body: { category: 'BILLING_SUBSCRIPTIONS' },
    });
  });

  it('has a message for every error code', () => {
    for (const code of AdminNotificationErrorCode.options)
      expect(ADMIN_NOTIFICATION_ERRORS[code]).toBeTruthy();
  });
});
