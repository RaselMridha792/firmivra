import { it, expect } from 'vitest';
import {
  PendingNotificationDelivery,
  PendingNotificationTargets,
} from '../../src/notification-center/notification.ports.js';
import { InternalNotification } from '../../src/notification-center/notification-center.service.js';
it('fails closed without sending policy or record authorization adapters', async () => {
  await expect(new PendingNotificationDelivery().policy()).rejects.toMatchObject({ status: 503 });
  await expect(new PendingNotificationDelivery().enqueue()).rejects.toMatchObject({ status: 503 });
  expect(await new PendingNotificationTargets().visible()).toBe(false);
  expect(
    InternalNotification.safeParse({
      recipientUserId: 'fake',
      businessId: 'forged',
      target: { url: 'https://example.test' },
    }).success,
  ).toBe(false);
});
