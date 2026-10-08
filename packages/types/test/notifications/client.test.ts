import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createMyNotificationsClient,
  createNotificationsClient,
  createRequest,
  ListNotificationsQuery,
  LOCKED_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_EVENTS,
  NotificationCategory,
  NotificationItem,
  notificationLink,
  NotificationPreferences,
  type NotificationsClient,
  NotificationTargetKind,
  UpdateNotificationPreferencesRequest,
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

const id = '0199b6e0-0000-7000-8000-000000000001';
const clientId = '0199b6a1-0000-7000-8000-000000000001';
const at = '2026-10-08T09:00:00.000Z';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const item = {
  id,
  category: 'DOCUMENTS',
  title: 'New document request',
  body: '1099-INT from your bank, due Oct 31',
  target: { kind: 'document_request', id, clientId: null },
  readAt: null,
  createdAt: at,
};
const prefs = {
  channels: ['EMAIL'],
  items: [{ category: 'ACCOUNT', email: true, sms: false, locked: true }],
};

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

/** Every call, in route order, with what it sends. */
const everyCall = (api: NotificationsClient) => [
  () => api.list(),
  () => api.list({ unreadOnly: true, cursor: 'next-page', limit: 10 }),
  () => api.unreadCount(),
  () => api.markRead(id),
  () => api.markAllRead(),
  () => api.preferences(),
  () => api.updatePreferences({ items: [{ category: 'DOCUMENTS', sms: true }] }),
];
const expectedCalls = (me: string) => [
  [`GET ${me}/notifications?unreadOnly=false&limit=20`, undefined],
  [`GET ${me}/notifications?unreadOnly=true&cursor=next-page&limit=10`, undefined],
  [`GET ${me}/notifications/unread-count`, undefined],
  [`POST ${me}/notifications/${id}/read`, {}],
  [`POST ${me}/notifications/read-all`, {}],
  [`GET ${me}/notification-preferences`, undefined],
  [`PATCH ${me}/notification-preferences`, { items: [{ category: 'DOCUMENTS', sms: true }] }],
];

const sides = [
  ['api.notifications (firm)', '/api/v1/business/me', createNotificationsClient],
  [
    'api.myNotifications(slug) (portal)',
    '/api/v1/portal/lvp/me',
    (r: ReturnType<typeof request>) => createMyNotificationsClient(r, 'LVP'),
  ],
] as const;

describe.each(sides)('%s', (_, me, create) => {
  it("calls the person's own routes with their method and body", async () => {
    const { fn, calls } = fakeFetch(500, {});
    for (const call of everyCall(create(request(fn)))) await call().catch(() => undefined);
    expect(calls.map((c) => [`${c.method} ${c.url}`, c.body])).toEqual(expectedCalls(me));
  });

  it('parses every answer', async () => {
    const page = { items: [item], nextCursor: null, unreadCount: 3 };
    const answer = (body: unknown) => create(request(fakeFetch(200, body).fn));
    expect(await answer(page).list()).toEqual(page);
    expect(await answer({ count: 3 }).unreadCount()).toBe(3);
    expect(await answer({ ...item, readAt: at }).markRead(id)).toEqual({ ...item, readAt: at });
    expect(await answer({ marked: 2 }).markAllRead()).toEqual({ marked: 2 });
    expect(await answer(prefs).preferences()).toEqual(prefs);
    const update = answer(prefs).updatePreferences({ items: [{ category: 'BILLING', sms: true }] });
    expect(await update).toEqual(prefs);
    // A notification without its record, or a free link in place of one, is not a notification.
    const { target: _target, ...noTarget } = item;
    await expect(
      answer({ items: [{ ...noTarget, href: '/lvp' }], nextCursor: null, unreadCount: 1 }).list(),
    ).rejects.toThrow();
  });

  it.each([
    ['a bad id', (api: NotificationsClient) => api.markRead('../preferences')],
    ['a limit of 0', (api: NotificationsClient) => api.list({ limit: 0 })],
    ['a limit over 50', (api: NotificationsClient) => api.list({ limit: 51 })],
    [
      'a cursor over 200 characters',
      (api: NotificationsClient) => api.list({ cursor: 'c'.repeat(201) }),
    ],
    [
      'an unknown query field',
      (api: NotificationsClient) =>
        api.list({ businessId: id } as Parameters<NotificationsClient['list']>[0]),
    ],
    ['no categories', (api: NotificationsClient) => api.updatePreferences({ items: [] })],
    [
      'a category with neither channel',
      (api: NotificationsClient) => api.updatePreferences({ items: [{ category: 'BILLING' }] }),
    ],
    [
      'a category twice',
      (api: NotificationsClient) =>
        api.updatePreferences({
          items: [
            { category: 'BILLING', email: false },
            { category: 'BILLING', sms: true },
          ],
        }),
    ],
    [
      'an unknown category',
      (api: NotificationsClient) =>
        api.updatePreferences({
          items: [{ category: 'MARKETING' as 'BILLING', email: false }],
        }),
    ],
    [
      'an unknown field',
      (api: NotificationsClient) => {
        const change = { category: 'BILLING' as const, email: false, push: true };
        return api.updatePreferences({ items: [change] });
      },
    ],
    [
      'the firm in the body',
      (api: NotificationsClient) => {
        const body = { items: [{ category: 'BILLING' as const, email: false }], businessId: id };
        return api.updatePreferences(body);
      },
    ],
  ])('refuses %s before sending', async (_name, call) => {
    const { fn, calls } = fakeFetch(200, {});
    const error = await rejection(call(create(request(fn))));
    expect([error.status, error.code]).toEqual([400, 'VALIDATION_FAILED']);
    expect(calls).toHaveLength(0);
  });

  it('never lets anyone switch off account and security notices', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const error = await rejection(
      create(request(fn)).updatePreferences({
        // @ts-expect-error ACCOUNT is locked, so it is not a category that can be changed.
        items: [{ category: 'ACCOUNT', email: false }],
      }),
    );
    expect([error.code, error.message]).toEqual([
      'VALIDATION_FAILED',
      'Account and security notices are always on',
    ]);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [403, 'BUSINESS_INACTIVE'],
    [403, 'ORIGIN_NOT_ALLOWED'],
    [400, 'VALIDATION_FAILED'],
    [404, 'NOT_FOUND'],
  ])('passes the API error %i %s through', async (status, code) => {
    const { fn } = fakeFetch(status, { error: { code, message: 'No' } });
    const error = await rejection(create(request(fn)).markRead(id));
    expect([error.status, error.code]).toEqual([status, code]);
  });
});

describe('api.myNotifications(slug) (portal)', () => {
  it('refuses a bad firm address on every call before building a path', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createMyNotificationsClient(request(fn), '../lvp');
    for (const call of everyCall(api)) {
      expect((await rejection(call())).code).toBe('VALIDATION_FAILED');
    }
    expect(calls).toHaveLength(0);
  });
});

describe('notification links', () => {
  const firm = { site: 'firm' } as const;
  const portal = { site: 'portal', firmSlug: 'LVP' } as const;
  const target = (kind: string, ofClient: string | null = null) => ({
    kind,
    id,
    clientId: ofClient,
  });

  it("opens the record's page on each site, built only from its kind and ids", () => {
    expect(notificationLink(target('document_request', clientId), firm)).toBe(
      `/clients/${clientId}/documents`,
    );
    expect(notificationLink(target('message_thread', clientId), firm)).toBe(
      `/clients/${clientId}/messages`,
    );
    expect(notificationLink(target('invoice', clientId), firm)).toBe(
      `/clients/${clientId}/invoices`,
    );
    expect(notificationLink(target('engagement', clientId), firm)).toBe(`/clients/${clientId}`);
    expect(notificationLink(target('appointment'), firm)).toBe('/calendar');
    expect(notificationLink(target('client_account'), firm)).toBe('/sign-ups');
    expect(notificationLink(target('document'), portal)).toBe('/lvp/documents');
    expect(notificationLink(target('tax_return'), portal)).toBe('/lvp/taxes');
    expect(notificationLink(target('client_note_reminder'), portal)).toBe('/lvp/messages');
    expect(notificationLink(target('user'), portal)).toBe('/lvp/profile');
  });

  it('gives no link where the site has no page, or the target is not one', () => {
    expect(notificationLink(target('user'), firm)).toBeNull();
    expect(notificationLink(target('client_note_reminder', clientId), firm)).toBeNull();
    expect(notificationLink(target('client_account'), portal)).toBeNull();
    // A firm page under a client needs the client.
    expect(notificationLink(target('document'), firm)).toBeNull();
    for (const bad of [
      target('https://evil.example'),
      { ...target('document'), id: '../../admin' },
      { ...target('document'), clientId: '//evil.example' },
      '/lvp/documents',
      null,
    ]) {
      expect(notificationLink(bad, firm)).toBeNull();
      expect(notificationLink(bad, portal)).toBeNull();
    }
    expect(notificationLink(target('document'), { site: 'portal', firmSlug: '//evil' })).toBeNull();
  });

  it('has a page for every event on the side it goes to', () => {
    for (const [event, { kind, to }] of Object.entries(NOTIFICATION_EVENTS)) {
      if (to !== 'staff')
        expect([event, notificationLink(target(kind), portal)]).not.toContain(null);
      // The member's own account has no page on the firm site yet.
      if (to !== 'client' && kind !== 'user') {
        expect([event, notificationLink(target(kind, clientId), firm)]).not.toContain(null);
      }
    }
  });
});

describe('notification schemas', () => {
  it('drops fields it does not know, and needs a known category and a typed target', () => {
    const parsed = NotificationItem.parse({ ...item, payload: { dueOn: '2026-10-31' }, href: '/' });
    expect(parsed).not.toHaveProperty('payload');
    expect(parsed).not.toHaveProperty('href');
    expect(NotificationItem.safeParse({ ...item, category: 'MARKETING' }).success).toBe(false);
    for (const bad of [
      { kind: 'document' },
      { kind: 'document', id },
      { kind: 'page', id, clientId: null },
      { kind: 'document', id: 'x', clientId: null },
    ]) {
      expect(NotificationItem.safeParse({ ...item, target: bad }).success).toBe(false);
    }
  });

  it('reads the unread filter and the page size from the query string, as the API gets them', () => {
    expect(ListNotificationsQuery.parse({ unreadOnly: 'true', limit: '5' })).toEqual({
      unreadOnly: true,
      limit: 5,
    });
    expect(ListNotificationsQuery.parse({})).toEqual({ unreadOnly: false, limit: 20 });
    expect(ListNotificationsQuery.safeParse({ unreadOnly: 'yes' }).success).toBe(false);
  });

  it('has a label for every category, and shows only the channels the API lists', () => {
    expect(Object.keys(NOTIFICATION_CATEGORY_LABELS)).toEqual(NotificationCategory.options);
    expect(NotificationPreferences.parse(prefs)).toEqual(prefs);
    expect(NotificationPreferences.safeParse({ ...prefs, channels: ['PUSH'] }).success).toBe(false);
  });

  it('locks only account notices, and every locked event is an account one', () => {
    expect(LOCKED_NOTIFICATION_CATEGORIES).toEqual(['ACCOUNT']);
    const accepts = (category: string) =>
      UpdateNotificationPreferencesRequest.safeParse({ items: [{ category, email: false }] })
        .success;
    expect(NotificationCategory.options.filter(accepts)).toEqual(
      NotificationCategory.options.filter((c) => c !== 'ACCOUNT'),
    );
  });

  it('names its events like the email templates, each with a kind of record', () => {
    for (const [event, { kind }] of Object.entries(NOTIFICATION_EVENTS)) {
      expect(event).toMatch(/^[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*$/);
      expect(NotificationTargetKind.options).toContain(kind);
    }
    // The ones that also go out as email keep the template's name.
    for (const template of [
      'document.requested',
      'appointment.booked',
      'appointment.changed',
      'appointment.reminder',
      'invoice.sent',
      'payment.received',
    ]) {
      expect(Object.keys(NOTIFICATION_EVENTS)).toContain(template);
    }
  });
});
