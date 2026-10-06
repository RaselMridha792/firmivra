import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { ListFirmNotificationsResponse, FirmPreferenceResponse } from '@firmivra/types';
import { requestContext } from '../../src/common/request-context.js';
import { NotificationCenterService } from '../../src/notification-center/notification-center.service.js';
import {
  NotificationDelivery,
  NotificationTargets,
} from '../../src/notification-center/notification.ports.js';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { installDraftSchema } from '../helpers/draft-schema.js';
import { notificationSchema } from '../fixtures/notification-schema.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>,
  owner: string,
  staff: string,
  client: string,
  other: string,
  foreign: string,
  foreignClient: string;
let ownerId: string,
  clientId: string,
  otherId: string,
  visible = true;
const delivery = {
  policy: vi.fn(async () => ({
    supportedChannels: ['IN_APP', 'EMAIL'],
    mandatoryCategories: ['SECURITY'],
  })),
  enqueue: vi.fn(async () => {}),
};
const api = () => request(fx.app.getHttpServer());
const create = (
  recipient: 'ownerA' | 'staffA' | 'clientA' | 'otherClientA' | 'ownerB',
  eventKey: string,
) =>
  requestContext.run(
    {
      requestId: randomUUID(),
      auth: { userId: fx.users.ownerA.id, pool: 'STAFF', cognitoSub: fx.users.ownerA.id },
      tenant: { businessId: fx.firmA.id, role: 'OWNER', kind: 'staff' },
    },
    () =>
      fx.app.get(NotificationCenterService).create({
        recipientUserId: fx.users[recipient].id,
        eventKey,
        category: 'DOCUMENT',
        title: 'An item is available',
        message: 'Sign in to review the update.',
        target: { entityType: 'document', entityId: randomUUID() },
      }),
  );
beforeAll(async () => {
  fx = await firmFixtures('notifications', (builder) =>
    builder
      .overrideProvider(NotificationDelivery)
      .useValue(delivery)
      .overrideProvider(NotificationTargets)
      .useValue({ visible: vi.fn(async () => visible) }),
  );
  await installDraftSchema(fx.owner, notificationSchema);
  [owner, staff, client, other, foreign, foreignClient] = await Promise.all([
    fx.token('ownerA'),
    fx.token('staffA'),
    fx.token('clientA'),
    fx.token('otherClientA'),
    fx.token('ownerB'),
    fx.token('clientB'),
  ]);
  ownerId = (await create('ownerA', 'owner-first'))!;
  clientId = (await create('clientA', 'client-first'))!;
  otherId = (await create('otherClientA', 'other-first'))!;
});
afterAll(async () => await fx?.close());
describe('notification center', () => {
  it('deduplicates concurrent internal events and rejects a recipient from another firm', async () => {
    const ids = await Promise.all([create('ownerA', 'one-event'), create('ownerA', 'one-event')]);
    expect(ids[0]).toBe(ids[1]);
    await expect(create('ownerB', 'foreign')).rejects.toMatchObject({ status: 404 });
    expect(delivery.enqueue).not.toHaveBeenCalled();
    await api()
      .post('/api/v1/business/notifications')
      .auth(owner, { type: 'bearer' })
      .send({ recipientUserId: fx.users.ownerB.id })
      .expect(404);
  });
  it('pages only own notifications, counts and idempotently marks read', async () => {
    const first = await api()
      .get('/api/v1/business/notifications?limit=1&read=false')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(ListFirmNotificationsResponse.safeParse(first.body).success).toBe(true);
    expect(first.body.nextCursor).toBeTruthy();
    const next = await api()
      .get(`/api/v1/business/notifications?limit=1&read=false&cursor=${first.body.nextCursor}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
    await api()
      .get(`/api/v1/business/notifications?limit=1&read=false&cursor=${first.body.nextCursor}`)
      .auth(staff, { type: 'bearer' })
      .expect(400);
    const before = await api()
      .get('/api/v1/business/notifications/unread-count')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const firstRead = await api()
      .post(`/api/v1/business/notifications/${ownerId}/read`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const secondRead = await api()
      .post(`/api/v1/business/notifications/${ownerId}/read`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(secondRead.body.readAt).toBe(firstRead.body.readAt);
    const after = await api()
      .get('/api/v1/business/notifications/unread-count')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(after.body.count).toBe(before.body.count - 1);
    await api()
      .post(`/api/v1/business/notifications/${clientId}/read`)
      .auth(owner, { type: 'bearer' })
      .expect(404);
  });
  it('reauthorizes record links and removes inaccessible targets', async () => {
    visible = false;
    const list = await api()
      .get('/api/v1/business/notifications')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(list.body.items.every((row: { target: unknown }) => row.target === null)).toBe(true);
    visible = true;
  });
  it('reads and updates per-user preferences, retains other categories and delegates sending', async () => {
    const before = await api()
      .get('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(FirmPreferenceResponse.safeParse(before.body).success).toBe(true);
    const pref = { category: 'DOCUMENT', inApp: true, email: true, sms: false };
    await api()
      .put('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .send({ preferences: [pref] })
      .expect(200);
    await api()
      .put('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .send({ preferences: [{ category: 'MARKETING', inApp: false, email: false, sms: false }] })
      .expect(200);
    const after = await api()
      .get('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(
      after.body.preferences.find((row: { category: string }) => row.category === 'DOCUMENT').email,
    ).toBe(true);
    const id = await create('ownerA', 'email-event');
    expect(delivery.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: fx.firmA.id,
        recipientUserId: fx.users.ownerA.id,
        eventKey: `notification:${id}`,
        channels: ['EMAIL'],
        template: 'notification-available',
      }),
    );
    await api()
      .put('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .send({ preferences: [pref, pref] })
      .expect(400);
    await api()
      .put('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .send({ preferences: [{ ...pref, sms: true }] })
      .expect(400);
    await api()
      .put('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .send({ preferences: [{ category: 'SECURITY', inApp: false, email: false, sms: false }] })
      .expect(400);
    await api()
      .put('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .send({ preferences: [pref], userId: fx.users.staffA.id })
      .expect(400);
  });
  it('supports all five portal endpoints with the canonical current recipient', async () => {
    const base = `/api/v1/portal/${fx.firmA.slug}`;
    const list = await api()
      .get(`${base}/notifications`)
      .auth(client, { type: 'bearer' })
      .expect(200);
    expect(list.body.items.map((row: { id: string }) => row.id)).toEqual([clientId]);
    const count = await api()
      .get(`${base}/notifications/unread-count`)
      .auth(client, { type: 'bearer' })
      .expect(200);
    expect(count.body.count).toBe(1);
    await api()
      .post(`${base}/notifications/${clientId}/read`)
      .auth(client, { type: 'bearer' })
      .expect(200);
    await api()
      .post(`${base}/notifications/${otherId}/read`)
      .auth(client, { type: 'bearer' })
      .expect(404);
    await api()
      .get(`${base}/notification-preferences`)
      .auth(client, { type: 'bearer' })
      .expect(200);
    await api()
      .put(`${base}/notification-preferences`)
      .auth(client, { type: 'bearer' })
      .send({ preferences: [{ category: 'DOCUMENT', inApp: true, email: false, sms: false }] })
      .expect(200);
    const own = await api()
      .get(`${base}/notifications`)
      .auth(other, { type: 'bearer' })
      .expect(200);
    expect(own.body.items.map((row: { id: string }) => row.id)).toEqual([otherId]);
  });
  it('honors disabled in-app delivery without exposing email-only notifications in the bell', async () => {
    const pref = { category: 'DOCUMENT', inApp: false, email: true, sms: false };
    await api()
      .put('/api/v1/business/notification-preferences')
      .auth(owner, { type: 'bearer' })
      .send({ preferences: [pref] })
      .expect(200);
    const id = await create('ownerA', 'email-only');
    const list = await api()
      .get('/api/v1/business/notifications')
      .auth(owner, { type: 'bearer' })
      .expect(200);
    expect(list.body.items.some((row: { id: string }) => row.id === id)).toBe(false);
    await api()
      .post(`/api/v1/business/notifications/${id}/read`)
      .auth(owner, { type: 'bearer' })
      .expect(404);
  });
  it('denies foreign firms on every route and rejects recipient injection', async () => {
    const cases = [
      ['get', 'notifications', undefined],
      ['get', 'notifications/unread-count', undefined],
      ['post', `notifications/${ownerId}/read`, undefined],
      ['get', 'notification-preferences', undefined],
      [
        'put',
        'notification-preferences',
        { preferences: [{ category: 'DOCUMENT', inApp: true, email: false, sms: false }] },
      ],
    ] as const;
    for (const [method, path, body] of cases) {
      await api()
        [method](`/api/v1/business/${path}`)
        .auth(foreign, { type: 'bearer' })
        .set('x-business-id', fx.firmA.id)
        .send(body)
        .expect(404);
      await api()
        [method](`/api/v1/portal/${fx.firmA.slug}/${path}`)
        .auth(foreignClient, { type: 'bearer' })
        .send(body)
        .expect(404);
    }
    await api()
      .get('/api/v1/business/notifications?userId=forged')
      .auth(owner, { type: 'bearer' })
      .expect(400);
  });
});
