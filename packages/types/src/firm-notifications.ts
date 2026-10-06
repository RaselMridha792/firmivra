import { z } from 'zod';

// Shared contract for docs/api/firm/notifications.yaml; policy validation also runs in the service.
export const FirmNotification = z.strictObject({
  id: z.uuid(),
  category: z.enum([
    'APPOINTMENT',
    'DOCUMENT',
    'SERVICE',
    'BILLING',
    'SECURITY',
    'LEGAL',
    'MARKETING',
  ]),
  title: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(160),
  message: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(1000),
  target: z
    .strictObject({
      entityType: z.enum(['appointment', 'document', 'engagement', 'invoice', 'externalLink']),
      entityId: z.uuid(),
    })
    .nullable(),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type FirmNotification = z.infer<typeof FirmNotification>;

export const FirmPreference = z.strictObject({
  category: z.enum([
    'APPOINTMENT',
    'DOCUMENT',
    'SERVICE',
    'BILLING',
    'SECURITY',
    'LEGAL',
    'MARKETING',
  ]),
  inApp: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
});
export type FirmPreference = z.infer<typeof FirmPreference>;

export const FirmPreferenceResponse = z.strictObject({
  preferences: z.array(z.lazy(() => FirmPreference)).max(7),
  supportedChannels: z.array(z.enum(['IN_APP', 'EMAIL', 'SMS'])).max(3),
  mandatoryCategories: z
    .array(
      z.enum(['APPOINTMENT', 'DOCUMENT', 'SERVICE', 'BILLING', 'SECURITY', 'LEGAL', 'MARKETING']),
    )
    .max(7),
});
export type FirmPreferenceResponse = z.infer<typeof FirmPreferenceResponse>;

export const ListFirmNotificationsQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  read: z
    .preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean(),
    )
    .optional(),
  category: z
    .enum(['APPOINTMENT', 'DOCUMENT', 'SERVICE', 'BILLING', 'SECURITY', 'LEGAL', 'MARKETING'])
    .optional(),
});
export type ListFirmNotificationsQuery = z.infer<typeof ListFirmNotificationsQuery>;

export const ListFirmNotificationsResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmNotification)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListFirmNotificationsResponse = z.infer<typeof ListFirmNotificationsResponse>;

export const CountFirmUnreadNotificationsResponse = z.strictObject({
  count: z.number().int().min(0),
});
export type CountFirmUnreadNotificationsResponse = z.infer<
  typeof CountFirmUnreadNotificationsResponse
>;

export const ReadFirmNotificationResponse = z.lazy(() => FirmNotification);
export type ReadFirmNotificationResponse = z.infer<typeof ReadFirmNotificationResponse>;

export const GetFirmNotificationPreferencesResponse = z.lazy(() => FirmPreferenceResponse);
export type GetFirmNotificationPreferencesResponse = z.infer<
  typeof GetFirmNotificationPreferencesResponse
>;

export const SaveFirmNotificationPreferencesRequest = z.strictObject({
  preferences: z
    .array(z.lazy(() => FirmPreference))
    .min(1)
    .max(7),
});
export type SaveFirmNotificationPreferencesRequest = z.infer<
  typeof SaveFirmNotificationPreferencesRequest
>;

export const SaveFirmNotificationPreferencesResponse = z.lazy(() => FirmPreferenceResponse);
export type SaveFirmNotificationPreferencesResponse = z.infer<
  typeof SaveFirmNotificationPreferencesResponse
>;

export const ListPortalNotificationsQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  read: z
    .preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean(),
    )
    .optional(),
  category: z
    .enum(['APPOINTMENT', 'DOCUMENT', 'SERVICE', 'BILLING', 'SECURITY', 'LEGAL', 'MARKETING'])
    .optional(),
});
export type ListPortalNotificationsQuery = z.infer<typeof ListPortalNotificationsQuery>;

export const ListPortalNotificationsResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmNotification)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListPortalNotificationsResponse = z.infer<typeof ListPortalNotificationsResponse>;

export const CountPortalUnreadNotificationsResponse = z.strictObject({
  count: z.number().int().min(0),
});
export type CountPortalUnreadNotificationsResponse = z.infer<
  typeof CountPortalUnreadNotificationsResponse
>;

export const ReadPortalNotificationResponse = z.lazy(() => FirmNotification);
export type ReadPortalNotificationResponse = z.infer<typeof ReadPortalNotificationResponse>;

export const GetPortalNotificationPreferencesResponse = z.lazy(() => FirmPreferenceResponse);
export type GetPortalNotificationPreferencesResponse = z.infer<
  typeof GetPortalNotificationPreferencesResponse
>;

export const SavePortalNotificationPreferencesRequest = z.strictObject({
  preferences: z
    .array(z.lazy(() => FirmPreference))
    .min(1)
    .max(7),
});
export type SavePortalNotificationPreferencesRequest = z.infer<
  typeof SavePortalNotificationPreferencesRequest
>;

export const SavePortalNotificationPreferencesResponse = z.lazy(() => FirmPreferenceResponse);
export type SavePortalNotificationPreferencesResponse = z.infer<
  typeof SavePortalNotificationPreferencesResponse
>;
