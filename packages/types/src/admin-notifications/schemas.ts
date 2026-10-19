import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { SearchText } from '../clients/text.js';
import {
  PlatformNotificationAttention,
  PlatformNotificationCategory,
  PlatformNotificationPriority,
} from '../db-enums.js';

// Super Admin notifications (R0 stage B1, `platform_notifications`; contract note
// docs/work/R0-stage-b1-notifications.md). The Super Admin console's notification center and bell.
// One row per recipient: a team member sees only their own items. The content never changes; only
// the read state and the attention do. Resolved and dismissed are final. Nothing is deleted.
// Routes: /api/v1/admin/notifications/... (the Super Admin site's session only).
// Responses are plain objects (a field the API adds later is dropped); requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const AdminNotificationId = z.uuid();

/**
 * The page's five statuses, from two columns: UNREAD and READ are the read state; ACTION_REQUIRED,
 * RESOLVED and DISMISSED are the attention.
 */
export const AdminNotificationStatus = z.enum([
  'UNREAD',
  'READ',
  'ACTION_REQUIRED',
  'RESOLVED',
  'DISMISSED',
]);
export type AdminNotificationStatus = z.infer<typeof AdminNotificationStatus>;

export const ADMIN_NOTIFICATION_CATEGORY_LABELS: Readonly<
  Record<PlatformNotificationCategory, string>
> = {
  FIRMS: 'Firms',
  FIRM_APPLICATIONS: 'Firm Applications',
  SALES_LEADS: 'Sales & Leads',
  BILLING_SUBSCRIPTIONS: 'Billing & Subscriptions',
  SUPPORT: 'Support',
  INTEGRATIONS: 'Integrations',
  SECURITY: 'Security',
  SYSTEM: 'System',
};

export const ADMIN_NOTIFICATION_PRIORITY_LABELS: Readonly<
  Record<PlatformNotificationPriority, string>
> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  NORMAL: 'Normal',
  INFORMATIONAL: 'Informational',
};

/** One item, as its recipient sees it. */
export const AdminNotification = z.object({
  id: AdminNotificationId,
  category: PlatformNotificationCategory,
  /** The producer's event key, `module.event` (e.g. `billing.payment_failed`). */
  type: z.string(),
  priority: PlatformNotificationPriority,
  /** Safe display text only: never secrets, card or bank data, or document contents. */
  title: z.string(),
  body: z.string().nullable(),
  /** The record the item opens (the deep link): e.g. `firm_application` and its id. */
  source: z.object({
    type: z.string(),
    id: z.string().nullable(),
    label: z.string().nullable(),
  }),
  /** The firm it is about; null for platform items, or once that firm is gone. */
  business: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** True for items that ask for work; only those can be resolved. */
  requiresAction: z.boolean(),
  attention: PlatformNotificationAttention,
  /** Null: unread. */
  readAt: DateTime.nullable(),
  resolvedAt: DateTime.nullable(),
  resolvedBy: MemberRef.nullable(),
  dismissedAt: DateTime.nullable(),
  /** When the event happened. Lists are newest first by this. */
  occurredAt: DateTime,
  createdAt: DateTime,
});
export type AdminNotification = z.infer<typeof AdminNotification>;

/** The filters the list, mark-all-read and the bulk "select all matching" share. */
const Filters = {
  category: PlatformNotificationCategory.optional(),
  status: AdminNotificationStatus.optional(),
  priority: PlatformNotificationPriority.optional(),
  /** `occurredAt` from (inclusive) and to (exclusive). */
  from: DateTime.optional(),
  to: DateTime.optional(),
  /** Matches the title, the body and the source label. */
  search: SearchText.optional(),
};
const rangeOk = (q: { from?: string | undefined; to?: string | undefined }) =>
  !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to);

/** GET /admin/notifications: newest first, numbered pages. */
export const ListAdminNotificationsQuery = z
  .strictObject({
    ...Filters,
    page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .refine(rangeOk, { message: 'The start must be before the end', path: ['to'] });
export type ListAdminNotificationsQuery = z.input<typeof ListAdminNotificationsQuery>;

export const ListAdminNotificationsResponse = z.object({
  items: z.array(AdminNotification).max(100),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type ListAdminNotificationsResponse = z.infer<typeof ListAdminNotificationsResponse>;

/**
 * GET /admin/notifications/summary: the cards, over all of the member's items (no filters).
 * `critical` counts CRITICAL items not yet resolved or dismissed. "Today" is the calendar day in
 * US Eastern time, as on the other Super Admin pages.
 */
export const AdminNotificationSummary = z.object({
  total: z.number().int().min(0),
  unread: z.number().int().min(0),
  actionRequired: z.number().int().min(0),
  critical: z.number().int().min(0),
  resolvedToday: z.number().int().min(0),
});
export type AdminNotificationSummary = z.infer<typeof AdminNotificationSummary>;

/** GET /admin/notifications/unread-count: the bell's badge. */
export const AdminNotificationUnreadCount = z.object({ count: z.number().int().min(0) });
export type AdminNotificationUnreadCount = z.infer<typeof AdminNotificationUnreadCount>;

/** GET /admin/notifications/recent: the bell's drop-down, newest first. */
export const RecentAdminNotificationsQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).optional().default(5),
});
export type RecentAdminNotificationsQuery = z.input<typeof RecentAdminNotificationsQuery>;
export const RecentAdminNotifications = z.object({
  items: z.array(AdminNotification).max(20),
  unread: z.number().int().min(0),
});
export type RecentAdminNotifications = z.infer<typeof RecentAdminNotifications>;

export const AdminNotificationAction = z.enum(['READ', 'UNREAD', 'RESOLVE', 'DISMISS']);
export type AdminNotificationAction = z.infer<typeof AdminNotificationAction>;

/**
 * POST /admin/notifications/bulk: one action on up to 100 of the member's items. Items the action
 * does not apply to (another member's, unknown, an item that asks for no work on RESOLVE, a closed
 * one on RESOLVE or DISMISS) are skipped and listed; the rest change together.
 */
export const BulkAdminNotificationsRequest = z.strictObject({
  ids: z
    .array(AdminNotificationId)
    .min(1, 'Select at least one notification')
    .max(100, 'Select at most 100 notifications'),
  action: AdminNotificationAction,
});
export type BulkAdminNotificationsRequest = z.input<typeof BulkAdminNotificationsRequest>;
export const BulkAdminNotificationsResponse = z.object({
  updated: z.number().int().min(0),
  skipped: z.array(AdminNotificationId),
});
export type BulkAdminNotificationsResponse = z.infer<typeof BulkAdminNotificationsResponse>;

/** POST /admin/notifications/mark-all-read: every unread item matching the current filter. */
export const MarkAllAdminNotificationsReadRequest = z
  .strictObject(Filters)
  .refine(rangeOk, { message: 'The start must be before the end', path: ['to'] });
export type MarkAllAdminNotificationsReadRequest = z.input<
  typeof MarkAllAdminNotificationsReadRequest
>;
export const MarkAllAdminNotificationsReadResponse = z.object({
  updated: z.number().int().min(0),
});
export type MarkAllAdminNotificationsReadResponse = z.infer<
  typeof MarkAllAdminNotificationsReadResponse
>;

export const AdminNotificationErrorCode = z.enum([
  /** Not the member's item, or no such item (another member's is 404 too). */
  'NOT_FOUND',
  /** RESOLVE on an item that asks for no work. */
  'NOT_ACTIONABLE',
  /** RESOLVE or DISMISS on an item already resolved or dismissed (both are final). */
  'ALREADY_CLOSED',
]);
export type AdminNotificationErrorCode = z.infer<typeof AdminNotificationErrorCode>;

export const ADMIN_NOTIFICATION_ERRORS: Readonly<Record<AdminNotificationErrorCode, string>> = {
  NOT_FOUND: 'This notification is no longer available. The list is now up to date.',
  NOT_ACTIONABLE: 'This notification does not ask for any work, so it cannot be resolved.',
  ALREADY_CLOSED: 'This notification was already resolved or dismissed.',
};
