import { it, expect } from 'vitest';
import {
  ListFirmNotificationsQuery,
  SaveFirmNotificationPreferencesRequest,
} from '../src/firm-notifications.js';
it('parses false filters correctly and rejects recipient injection', () => {
  expect(ListFirmNotificationsQuery.parse({ read: 'false' }).read).toBe(false);
  expect(ListFirmNotificationsQuery.safeParse({ recipientUserId: 'forged' }).success).toBe(false);
  expect(SaveFirmNotificationPreferencesRequest.safeParse({ preferences: [] }).success).toBe(false);
});
