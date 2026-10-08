import { z } from 'zod';
import { DeliveryChannel, NotificationCategory } from '../db-enums.js';

// Notifications (R6): the bell and the Notification Center (Fahad's F07 on the firm site, Nahid's
// N10 in the portal) and each person's email and SMS preferences (N05's My Profile).
// Firm routes: /api/v1/business/me/... (the signed-in member's own, in the firm the request acts
// in; Owner, Admin and Staff alike). Portal routes: /api/v1/portal/{firmSlug}/me/... (the
// signed-in client's own). Never another person's, even in the same firm (404).
// The API writes a notification when something happens for the person (NOTIFICATION_EVENTS). It
// makes the title and body from safe values only: names, titles, dates and invoice numbers; never
// an SSN or EIN, a bank number, an amount, a file name, a file's content or a message's text.
// Each item names its record (`target`); the site builds the link (notificationLink), so the
// server never sends a URL. The bell is always on; preferences choose only the email and SMS
// copies. Responses are plain objects (a field the API adds later is dropped, so an open page
// keeps working); requests are strict (unknown fields such as businessId are refused).

const DateTime = z.iso.datetime({ offset: true });

/**
 * What each category is called on screens (the Notification Center, My Profile > Notification
 * Preferences). Octavia confirms the wording; until then a change is one line here.
 */
export const NOTIFICATION_CATEGORY_LABELS = {
  ACCOUNT: 'Account and security',
  DOCUMENTS: 'Documents',
  INTAKE: 'Intake forms',
  SERVICES: 'Services',
  MESSAGES: 'Messages and notes',
  APPOINTMENTS: 'Appointments',
  BILLING: 'Invoices and payments',
} as const satisfies Record<NotificationCategory, string>;

/**
 * Categories nobody can switch off: sign-in and security notices always reach the person (as the
 * API's ALWAYS_SENT messages do). `locked` in the preferences.
 */
export const LOCKED_NOTIFICATION_CATEGORIES = [
  'ACCOUNT',
] as const satisfies readonly NotificationCategory[];
const isLocked = (value: unknown) =>
  (LOCKED_NOTIFICATION_CATEGORIES as readonly unknown[]).includes(value);

/**
 * The kinds of record a notification opens: the table's name in the singular, as the API stores
 * it (`notifications.entity_type`).
 */
export const NotificationTargetKind = z.enum([
  'document',
  'document_request',
  'intake',
  'engagement',
  'tax_return',
  'message_thread',
  'client_note_reminder',
  'appointment',
  'invoice',
  'client_account',
  'user',
]);
export type NotificationTargetKind = z.infer<typeof NotificationTargetKind>;

/**
 * Who gets each event's bell item, its category and the kind of record it opens. Names match the
 * NotifyService templates (apps/api/src/notify/notify.types.ts) where an email goes out for the
 * same event, so one event writes the bell item and its email. `to`: `client` (the portal),
 * `staff` (the firm site) or `both`. The API's helper takes only these names.
 */
export const NOTIFICATION_EVENTS = {
  // ----- Documents (R5) -----
  /** The firm asks for a document (with the email of the same name). */
  'document.requested': { category: 'DOCUMENTS', kind: 'document_request', to: 'client' },
  /** The firm marked an upload missing: the client is asked again. */
  'document-request.rejected': { category: 'DOCUMENTS', kind: 'document_request', to: 'client' },
  /** The client uploaded for a request. */
  'document-request.submitted': { category: 'DOCUMENTS', kind: 'document_request', to: 'staff' },
  /** The client said "I don't have this". */
  'document-request.not-available': {
    category: 'DOCUMENTS',
    kind: 'document_request',
    to: 'staff',
  },
  /** The firm shared a document with the client. */
  'document.shared': { category: 'DOCUMENTS', kind: 'document', to: 'client' },
  /** The client uploaded a document that answers no request. */
  'document.uploaded': { category: 'DOCUMENTS', kind: 'document', to: 'staff' },
  // ----- Intake (R10) -----
  'intake.sent': { category: 'INTAKE', kind: 'intake', to: 'client' },
  'intake.submitted': { category: 'INTAKE', kind: 'intake', to: 'staff' },
  // ----- Services and tax returns (R10, R12) -----
  'engagement.status-changed': { category: 'SERVICES', kind: 'engagement', to: 'both' },
  'tax-return.status-changed': { category: 'SERVICES', kind: 'tax_return', to: 'client' },
  /** A client finished signing up and waits for the firm (R3's queue; Owner and Admin). */
  'client.signup-submitted': { category: 'SERVICES', kind: 'client_account', to: 'staff' },
  // ----- Messages and notes (R11) -----
  'message.received': { category: 'MESSAGES', kind: 'message_thread', to: 'both' },
  /** The client's own reminder on a private note (never the firm's). */
  'client-note.reminder': { category: 'MESSAGES', kind: 'client_note_reminder', to: 'client' },
  // ----- Appointments (R12) -----
  'appointment.booked': { category: 'APPOINTMENTS', kind: 'appointment', to: 'both' },
  'appointment.changed': { category: 'APPOINTMENTS', kind: 'appointment', to: 'both' },
  'appointment.reminder': { category: 'APPOINTMENTS', kind: 'appointment', to: 'both' },
  // ----- Invoices (R7; never an amount) -----
  'invoice.sent': { category: 'BILLING', kind: 'invoice', to: 'client' },
  'payment.received': { category: 'BILLING', kind: 'invoice', to: 'both' },
  // ----- Account (locked) -----
  'account.password-changed': { category: 'ACCOUNT', kind: 'user', to: 'both' },
} as const satisfies Record<
  string,
  {
    category: NotificationCategory;
    kind: NotificationTargetKind;
    to: 'client' | 'staff' | 'both';
  }
>;
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

export const NotificationId = z.uuid();

/**
 * The record a notification opens. `clientId` is the firm's client the record belongs to, on the
 * firm site (its pages sit under /clients/{id}); null in the portal (the client is the signed-in
 * one) and for records of no client (a sign-up waiting, the person's own account).
 */
export const NotificationTarget = z.object({
  kind: NotificationTargetKind,
  id: z.uuid(),
  clientId: z.uuid().nullable(),
});
export type NotificationTarget = z.infer<typeof NotificationTarget>;

/** One notification, in the bell and the Notification Center. */
export const NotificationItem = z.object({
  id: z.uuid(),
  category: NotificationCategory,
  /** One short line, e.g. "New document request". Plain text. */
  title: z.string(),
  /** One or two short lines, e.g. "1099-INT from your bank, due Oct 31". Never sensitive content. */
  body: z.string(),
  /**
   * What opening it shows: `notificationLink(target, site)`. The page itself still checks access;
   * a record the person can no longer see shows its not-found state.
   */
  target: NotificationTarget,
  /** Null while unread. */
  readAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type NotificationItem = z.infer<typeof NotificationItem>;

/** GET .../notifications: newest first. `unreadOnly` is the "Unread" filter. */
export const ListNotificationsQuery = z.strictObject({
  unreadOnly: z
    .preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean(),
    )
    .optional()
    .default(false),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
export type ListNotificationsQuery = { unreadOnly?: boolean; cursor?: string; limit?: number };

export const NotificationList = z.object({
  items: z.array(NotificationItem).max(50),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
  /** How many of the person's notifications at this firm are unread, on every page (the badge). */
  unreadCount: z.number().int().min(0),
});
export type NotificationList = z.infer<typeof NotificationList>;

/** GET .../notifications/unread-count: the bell's badge. */
export const UnreadNotificationCount = z.object({ count: z.number().int().min(0) });
export type UnreadNotificationCount = z.infer<typeof UnreadNotificationCount>;

/** POST .../notifications/read-all: every unread one is now read; `marked` says how many. */
export const MarkAllNotificationsReadResponse = z.object({ marked: z.number().int().min(0) });
export type MarkAllNotificationsReadResponse = z.infer<typeof MarkAllNotificationsReadResponse>;

/** One category's choice. Nothing saved yet: email on, SMS off. */
export const NotificationPreference = z.object({
  category: NotificationCategory,
  email: z.boolean(),
  sms: z.boolean(),
  /** Always sent, whatever the switches say (ACCOUNT): show the row with its switches disabled. */
  locked: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreference>;

/** GET .../notification-preferences, and the answer to an update. */
export const NotificationPreferences = z.object({
  /**
   * The channels that can reach this person now, in display order: show a switch only for these.
   * EMAIL always; SMS once texts can be sent (R6) and the person has a phone number. A choice for
   * a channel that is not listed is kept and counts once it is.
   */
  channels: z.array(DeliveryChannel),
  /** Every category, in the order of NotificationCategory. */
  items: z.array(NotificationPreference),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

/**
 * PATCH .../notification-preferences: only the categories and channels given change (one switch,
 * or the whole form). A locked category is refused like any bad input (400).
 */
export const UpdateNotificationPreferencesRequest = z.strictObject({
  items: z
    .array(
      z
        .strictObject({
          category: NotificationCategory.exclude([...LOCKED_NOTIFICATION_CATEGORIES], {
            error: (issue) =>
              isLocked(issue.input) ? 'Account and security notices are always on' : undefined,
          }),
          email: z.boolean().optional(),
          sms: z.boolean().optional(),
        })
        .refine((item) => item.email !== undefined || item.sms !== undefined, {
          message: 'Set email, sms or both',
        }),
    )
    .min(1, 'Change at least one category')
    .max(NotificationCategory.options.length)
    .refine((items) => new Set(items.map((i) => i.category)).size === items.length, {
      message: 'Each category only once',
    }),
});
export type UpdateNotificationPreferencesRequest = z.input<
  typeof UpdateNotificationPreferencesRequest
>;
