import {
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_EVENTS,
  type NotificationCategory,
  type NotificationEvent,
} from '@firmivra/types';

/**
 * How a notification reads (R6 step 7). The helper stores a small payload of safe values taken
 * from the record (names, titles, dates, invoice numbers); the title and body are made from it
 * when read, per event and side. Never a file name, an amount, a message's or a note's text.
 */

export type Side = 'client' | 'staff';
/** The stored payload: short strings and numbers only. */
export type Payload = Record<string, string | number | null>;

/**
 * `notifications.type` allows lower-case words joined by dots and underscores only
 * (`notifications_type_key`), so an event's hyphens are stored as underscores:
 * `document-request.accepted` is `document_request.accepted`.
 */
export const storedType = (event: NotificationEvent): string => event.replaceAll('-', '_');

const EVENT_OF_TYPE = new Map(
  (Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[]).map((e) => [storedType(e), e]),
);

/** The event a stored type names, or null for one this API does not know (yet). */
export const eventOfType = (type: string): NotificationEvent | null =>
  EVENT_OF_TYPE.get(type) ?? null;

const text = (p: Payload, key: string): string | null => {
  const value = p[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

/** `Oct 31, 2026` from `2026-10-31`. */
function calendarDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `Oct 20, 2026, 9:30 AM` in the firm's time zone. */
function dateTime(value: string | null, timeZone: string | null): string | null {
  const at = value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return at.toLocaleString('en-US', { ...options, timeZone: timeZone ?? 'America/New_York' });
  } catch {
    return at.toLocaleString('en-US', { ...options, timeZone: 'America/New_York' });
  }
}

/** `IN_PROGRESS` reads `In progress`. */
const statusText = (value: string | null) =>
  value ? value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ') : null;

/** `title, due Oct 31, 2026`, `title`, or the fallback. */
function withDue(p: Payload, fallback: string): string {
  const title = text(p, 'title') ?? fallback;
  const due = calendarDay(text(p, 'dueOn'));
  return due ? `${title}, due ${due}` : title;
}

/** Staff items start with the client's name when the record has one. */
const forClient = (p: Payload, line: string) => {
  const client = text(p, 'client');
  return client ? `${client}: ${line}` : line;
};
/** The client's name to start a sentence with. */
const who = (p: Payload) => text(p, 'client') ?? 'A client';

type Text = { title: string; body: string };
type Writer = (p: Payload, side: Side) => Text;

const appointment =
  (title: string): Writer =>
  (p, side) => {
    const when = dateTime(text(p, 'startsAt'), text(p, 'timeZone'));
    const line = [text(p, 'title') ?? 'Appointment', when].filter(Boolean).join(', ');
    return { title, body: side === 'staff' ? forClient(p, line) : line };
  };

const TEXT: Record<NotificationEvent, Writer> = {
  'document.requested': (p) => ({
    title: 'New document request',
    body: withDue(p, 'A document'),
  }),
  'document-request.accepted': (p) => ({
    title: 'Document accepted',
    body: text(p, 'title') ?? 'Your document was accepted.',
  }),
  'document-request.rejected': (p) => ({
    title: 'Please upload again',
    body: withDue(p, 'A requested document'),
  }),
  'document-request.submitted': (p) => ({
    title: 'Document received',
    body: forClient(p, text(p, 'title') ?? 'A requested document was uploaded.'),
  }),
  'document-request.not-available': (p) => ({
    title: 'Document not available',
    body: forClient(p, text(p, 'title') ?? 'The client does not have a requested document.'),
  }),
  'document.shared': () => ({
    title: 'New document',
    body: 'Your firm shared a document with you.',
  }),
  'document.uploaded': (p) => ({
    title: 'New document',
    body: `${who(p)} uploaded a document.`,
  }),
  'intake.sent': (p) => ({ title: 'New intake form', body: withDue(p, 'An intake form') }),
  'intake.submitted': (p) => ({
    title: 'Intake form submitted',
    body: forClient(p, text(p, 'title') ?? 'An intake form'),
  }),
  'engagement.status-changed': (p, side) => {
    const status = statusText(text(p, 'status'));
    const line = [text(p, 'title') ?? 'A service', status].filter(Boolean).join(': ');
    return { title: 'Service updated', body: side === 'staff' ? forClient(p, line) : line };
  },
  'tax-return.status-changed': (p) => {
    const year = p['taxYear'];
    const form = text(p, 'formType');
    const what = [typeof year === 'number' ? String(year) : null, form, 'tax return']
      .filter(Boolean)
      .join(' ');
    const status = statusText(text(p, 'status'));
    return { title: 'Tax return updated', body: status ? `${what}: ${status}` : what };
  },
  'client.signup-submitted': (p) => ({
    title: 'New client sign-up',
    body: `${text(p, 'name') ?? 'A new client'} is waiting for approval.`,
  }),
  'message.received': (p, side) => ({
    title: 'New message',
    body: side === 'staff' ? `${who(p)} sent a message.` : 'You have a new message.',
  }),
  'client-note.reminder': () => ({
    title: 'Note reminder',
    body: 'You asked to be reminded about one of your notes.',
  }),
  'appointment.booked': appointment('Appointment booked'),
  'appointment.changed': appointment('Appointment changed'),
  'appointment.reminder': appointment('Appointment reminder'),
  'invoice.sent': (p) => ({
    title: 'New invoice',
    body: text(p, 'number') ? `Invoice ${text(p, 'number')}` : 'You have a new invoice.',
  }),
  'payment.received': (p, side) => {
    const invoice = text(p, 'number') ? `invoice ${text(p, 'number')}` : 'an invoice';
    return {
      title: 'Payment received',
      body:
        side === 'staff'
          ? `${who(p)} paid ${invoice}.`
          : `Thank you. Your payment for ${invoice} was received.`,
    };
  },
  'account.password-changed': () => ({
    title: 'Password changed',
    body: "Your password was changed. If this wasn't you, contact your firm right away.",
  }),
  'staff.joined': (p) => ({
    title: 'New team member',
    body: `${text(p, 'name') ?? 'A new member'} joined the team.`,
  }),
};

/**
 * The title and body of a stored notification. An event this API does not know gets a plain line
 * for its category, never the raw payload.
 */
export function notificationText(
  type: string,
  category: NotificationCategory,
  payload: unknown,
  side: Side,
): Text {
  const event = eventOfType(type);
  const p =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Payload)
      : {};
  if (event) return TEXT[event](p, side);
  return { title: NOTIFICATION_CATEGORY_LABELS[category], body: 'You have a new notification.' };
}
