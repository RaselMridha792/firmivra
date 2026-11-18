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
  // Client Portal Review One CP-3d: the firm's general announcements.
  ANNOUNCEMENTS: 'Announcements',
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
  /**
   * A bookkeeping client (Client Portal BK-CP3): the firm site only, the client's Terms page. Its
   * id is the bookkeeping client's (BookkeepingClientRow.id).
   */
  'bookkeeping_client',
  'tax_return',
  'message_thread',
  'client_note_reminder',
  'appointment',
  'invoice',
  'client_account',
  'membership',
  'user',
  /** An automation's run (Automations > Logs): the firm site only. */
  'automation_run',
  /** A member's own project deadline (Tax Planning > Project Deadlines): the firm site only. */
  'project_deadline',
  /** A task (T-D12): the firm site only, the task itself. */
  'task',
  /** A recurring task series (T-D15): the firm site only, its overview. */
  'task_series',
  /** A tax plan (P4-8): the firm site only, the plan itself. */
  'tax_plan',
  /** A business plan (Business Advisory B10): the firm site only, the plan's review step. */
  'advisory_plan',
  /** CP-3d: a general announcement the firm published (Communications): the portal only. */
  'announcement',
]);
export type NotificationTargetKind = z.infer<typeof NotificationTargetKind>;

/**
 * Who gets each event's bell item, its category and the kind of record it opens. Names match the
 * NotifyService templates (apps/api/src/notify/notify.types.ts) where an email goes out for the
 * same event, so one event writes the bell item and its email. `to`: `client` (the portal),
 * `staff` (the firm site) or `both`. The API's helper takes only these names. Recipients: a
 * client event goes to the client's ACTIVE PRIMARY portal login only, until member permissions
 * exist (a spouse's or an authorized login gets none); `client-note.reminder` only to the note's
 * owner (ClientNoteReminder.userId). Email-only notices (codes, decisions, welcome, new-device
 * alert, suspension) are NotifyService templates, not bell items.
 */
export const NOTIFICATION_EVENTS = {
  // ----- Documents (R5) -----
  /** The firm asks for a document (with the email of the same name). */
  'document.requested': { category: 'DOCUMENTS', kind: 'document_request', to: 'client' },
  /** The firm accepted the client's upload for a request. */
  'document-request.accepted': { category: 'DOCUMENTS', kind: 'document_request', to: 'client' },
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
  /** Intake Forms Review Two: the form's first or final reminder (with its email for an Email form). */
  'intake.reminder': { category: 'INTAKE', kind: 'intake', to: 'client' },
  /** The expiration alert: the form expires soon (to its assigned member, else Owners and Admins). */
  'intake.expiring': { category: 'INTAKE', kind: 'intake', to: 'staff' },
  'intake.submitted': { category: 'INTAKE', kind: 'intake', to: 'staff' },
  // ----- Services and tax returns (R10, R12) -----
  'engagement.status-changed': { category: 'SERVICES', kind: 'engagement', to: 'both' },
  /**
   * BK-CP2 (Client Portal Review One): the firm published a Bookkeeping report for the first time.
   * A bell item, and an email when the client's Report Delivery allows email; it names the service,
   * never the report's figures or file. It opens the portal's My Services, where the report is.
   */
  'report.published': { category: 'SERVICES', kind: 'engagement', to: 'client' },
  /**
   * BK-CP3 (Client Portal Review One): the firm sent bookkeeping terms for the client's answer. A
   * bell item naming the service; it opens My Services, where the terms wait.
   */
  'bookkeeping-terms.sent': { category: 'SERVICES', kind: 'engagement', to: 'client' },
  /**
   * BK-CP3: the client accepted (the terms are in force) or declined (back to draft) the terms in
   * the portal. To the client's assigned member and the Owners and Admins; it opens the Terms page.
   */
  'bookkeeping-terms.client-accepted': {
    category: 'SERVICES',
    kind: 'bookkeeping_client',
    to: 'staff',
  },
  'bookkeeping-terms.client-declined': {
    category: 'SERVICES',
    kind: 'bookkeeping_client',
    to: 'staff',
  },
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
  /**
   * Appointments Review 2 (P3): the firm cancelled the client's appointment. A bell item and an
   * email to the client's primary login, with the reason staff gave (never internal notes).
   */
  'appointment.cancelled': { category: 'APPOINTMENTS', kind: 'appointment', to: 'client' },
  /**
   * Appointments A3 (R55): an earlier time opened for the client's appointment on the waitlist. A
   * bell item and an email (through the outbox) to the client's primary login: the offered time
   * and how long it is held, never notes or other details. It opens the portal's appointments.
   */
  'appointment.waitlist-offer': { category: 'APPOINTMENTS', kind: 'appointment', to: 'client' },
  /**
   * Appointments A3 (R55): a client asked for an offered earlier time (STAFF_APPROVAL). A bell item
   * for the client's assigned member and the Owners and Admins; it opens the appointment, where
   * staff approve or reject it.
   */
  'appointment.waitlist-requested': { category: 'APPOINTMENTS', kind: 'appointment', to: 'staff' },
  // ----- Invoices (R7; never an amount) -----
  'invoice.sent': { category: 'BILLING', kind: 'invoice', to: 'client' },
  /**
   * Invoices Review 2 (I-C02, I-N04): an open invoice is coming due (the firm's days before), and
   * an unpaid one is overdue (repeated every few days up to the firm's cap). To the client: a bell
   * item and an email with the portal link to pay, as the invoice's own email choice allows.
   */
  'invoice.reminder': { category: 'BILLING', kind: 'invoice', to: 'client' },
  'invoice.overdue': { category: 'BILLING', kind: 'invoice', to: 'client' },
  'payment.received': { category: 'BILLING', kind: 'invoice', to: 'both' },
  // ----- Account and team (locked) -----
  'account.password-changed': { category: 'ACCOUNT', kind: 'user', to: 'both' },
  /** A member accepted their invite (Owner and Admin; R2's invites): who can see client data. */
  'staff.joined': { category: 'ACCOUNT', kind: 'membership', to: 'staff' },
  // ----- Automations (R55; the lead's one-off exception, Nov 6) -----
  /**
   * A rule's Notify staff action: a bell item only (no email or text), to the members the rule
   * names or, by default, the client's assigned member and the Owners and Admins. It opens the
   * run in Automations > Logs.
   */
  'automation.notice': { category: 'SERVICES', kind: 'automation_run', to: 'staff' },

  // ----- Tax Planning (R56, Tax Planning Review 2: Project Deadlines) -----
  /**
   * A project deadline's reminder: a bell item and, when the reminder says so, an email (through
   * the outbox), to the deadline's owner and the coworkers it is shared with, ACTIVE members
   * only. It opens Tax Planning > Project Deadlines.
   */
  'project-deadline.reminder': { category: 'SERVICES', kind: 'project_deadline', to: 'staff' },

  // ----- Tasks (R60, Tasks T-D12) -----
  /**
   * A task's reminder (its own rules: days before at a time, or minutes, hours or days before the
   * due time, in the firm's time zone): a bell item and, when the rule says so, an email (through
   * the outbox), to its assignees, ACTIVE members only. It opens the task.
   */
  'task.reminder': { category: 'SERVICES', kind: 'task', to: 'staff' },
  /**
   * P4-8 (Tax Planning Review 2): the client asked a question, requested a revision or a meeting,
   * or approved the plan in the portal. To the plan's assigned staff (the caller names them).
   */
  'tax-plan.client-request': { category: 'SERVICES', kind: 'tax_plan', to: 'staff' },
  'tax-plan.client-approved': { category: 'SERVICES', kind: 'tax_plan', to: 'staff' },
  /**
   * Business Advisory B10 (Client Portal Review One): the client approved the business plan sent
   * for their approval, in the portal. To the advisory client's advisor and the member who sent
   * it (the caller names them).
   */
  'advisory-plan.client-approved': { category: 'SERVICES', kind: 'advisory_plan', to: 'staff' },
  /**
   * Tasks Review Two T-D15: an occurrence of a recurring series could not be made after its
   * retries (FAILED). Owners and Admins only (the series is the record, not the client's). It
   * opens the series, where the occurrence shows why and can be skipped.
   */
  'task.series-failed': { category: 'SERVICES', kind: 'task_series', to: 'staff' },

  // ----- Announcements (Client Portal Review One CP-3d, the lead's decision 3a) -----
  /**
   * A general announcement went live in the client's portal: a short notice (its title and the
   * portal link, never its text) to each client it was published to, once. The email and text
   * copies follow the firm's policy for each channel (Settings > Client Portal > Announcements)
   * and, where the firm leaves it to them, the client's own choice.
   */
  'announcement.published': { category: 'ANNOUNCEMENTS', kind: 'announcement', to: 'client' },
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
 * one) and for records of no client (a sign-up waiting, a team member, the person's own account).
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
  /**
   * The person can't change the email box: show it disabled with `email` as it is. Notices about
   * the person's own account or services always go by email (`email: true`): for the firm's staff
   * (Octavia's Notifications review of Oct 18) and clients (Client Portal guide 9.2). The one
   * exception is a client's ANNOUNCEMENTS (CP-3d): the firm's policy decides: the client's choice
   * (not locked), always sent (locked, true) or never sent (locked, false).
   */
  emailLocked: z.boolean(),
  /**
   * CP-3d: the firm never sends texts for this category (a client's ANNOUNCEMENTS when the firm's
   * text policy is OFF): show the text box disabled and off. Absent from an older answer: false.
   */
  smsLocked: z.boolean().default(false),
});
export type NotificationPreference = z.infer<typeof NotificationPreference>;

/** GET .../notification-preferences, and the answer to an update. */
export const NotificationPreferences = z.object({
  /**
   * The channels that can reach this person now, in display order: show a switch only for these.
   * EMAIL always. SMS for a client with a phone number (q27: the switch only stores the choice
   * until SMS is switched on in config); for the firm's staff only with a verified mobile number
   * (Rasel, Oct 24: a code by text, StaffPhoneState), and the switch likewise only stores the choice.
   * While SMS is not listed, every item answers `sms: false` and an update with `sms: true` is
   * refused (400). Turning SMS off is always allowed. A change of phone number clears every SMS
   * choice: the person opts in again for the new number.
   */
  channels: z.array(DeliveryChannel),
  /**
   * The client stopped texts from this firm (a STOP reply or an unsubscribe, in the firm's
   * consent records): SMS is not offered and nothing is texted until the firm records a new
   * opt-in (Client Portal guide 7.5). Always false for the firm's staff.
   */
  smsStopped: z.boolean(),
  /**
   * The categories this person gets, in the order of NotificationCategory: every one, except
   * ANNOUNCEMENTS for the firm's staff (announcements are for clients) and for a client while the
   * firm's announcements are off (CP-3c).
   */
  items: z.array(NotificationPreference),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;

/**
 * PATCH .../notification-preferences: only the categories and channels given change (one switch,
 * or the whole form). A locked category is refused like any bad input (400), and so is
 * `sms: true` while SMS is not in the person's `channels` (the API checks that one).
 * `email: false` is 400 EMAIL_ALWAYS_ON, except for a client's ANNOUNCEMENTS while the firm leaves
 * the email copy to the client (CP-3d). A change the firm's announcement policy doesn't allow (an
 * email box it locks, `sms: true` with texts OFF) is 400 CHANNEL_LOCKED; ANNOUNCEMENTS from the
 * firm's staff, or while the firm's announcements are off, is 400 VALIDATION_FAILED.
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
