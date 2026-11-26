import { LIVE_DOCUMENT } from '../storage/document-records.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  AnnouncementPlace,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationTargetKind,
  notificationLink,
} from '@firmivra/types';
import { announcementSettingsIn } from '../client-portal/announcement-policy.js';
import { mergeValues } from '../communications/merge-values.js';
import { fill } from '../templates/merge-fields.js';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { minutesOf, timeOfDayFromDb, zonedInstant } from '../appointments/calendar.js';
import { leadNotice, noticeWords, portalNoticeWords } from '../appointments/notice-words.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import {
  NOTIFY_SERVICE,
  type NotifyMessage,
  type NotifyService,
  type NotifyTemplate,
} from '../notify/notify.types.js';
import { lockClient } from '../workspaces/common.js';
import { eventOfType, type Payload, type Side, storedType } from './notification-text.js';

/**
 * What another feature passes to `Notifier.notify`: the event and the record it is about. The
 * helper reads everything else from that record in the firm's own scope: the client it belongs
 * to, the safe values the text is made of, the recipients and the email's data. Never a URL,
 * never text from the caller.
 */
export interface NotifyEventInput {
  /** The firm, from the caller's server-side tenant context. */
  businessId: string;
  event: NotificationEvent;
  /** The record's id; its kind is `NOTIFICATION_EVENTS[event].kind`. */
  recordId: string;
  /**
   * For an event that goes to `both` sides, the side this occurrence is for. Defaults to the
   * event's own `to`, except for a DIRECTIONAL event (one message goes one way): there it is
   * required and must be 'client' or 'staff' (the client's message reaches the firm, the firm's
   * reaches the client).
   */
  audience?: Side | 'both';
  /**
   * Who caused it: never gets a bell item for their own action. A client who acted still gets the
   * event's email copy (their confirmation of a booking or a payment).
   */
  actorUserId?: string | null;
  /** The producer's stable key: a retried job never writes a second item for the same person. */
  eventKey?: string;
  /**
   * Appointments Review 2 (B7): the time the notice is for (a reminder job's run): which
   * configured reminder is due then, for its note on the client's bell item. Now by default.
   */
  at?: Date;
  /**
   * The sender's choices for this occurrence (a document request's switches). Left out: the bell
   * item and the email copy, as always, and no text. `inApp: false` writes no bell item (the email
   * copy then goes once, outside the outbox); `email: false` sends no email copy; `sms: true` adds
   * the event's text copy (SMS_EVENTS) for a client whose login has a phone, when the firm sends
   * texts (its message settings) and NotifyService finds the client agreed to texts in the
   * category (their preference, off unless chosen).
   */
  channels?: { inApp: boolean; email: boolean; sms: boolean };
  /**
   * Only for an event in CHOSEN_RECIPIENT_EVENTS (an automation's notice): the members the rule
   * names, instead of the record's usual recipients. Only ACTIVE members of this firm are reached;
   * on a record of a client, a member other than an Owner or Admin only if assigned to the client
   * (q27). Up to 20 user ids.
   */
  toUserIds?: readonly string[];
  /**
   * Only for an event in CLIENT_NAMED_EVENTS (an announcement's notice, CP-3d), and required
   * there: the client the occurrence is for, among the record's own recipients. The record's
   * loader checks it (a client the announcement wasn't published to reaches nobody).
   */
  clientId?: string;
  /**
   * Members this occurrence skips on every channel (no bell item, no email copy), for any event:
   * those who muted the conversation a message is in (MSG-F22). It never adds anyone. Up to 50
   * user ids; none is the same as leaving it out.
   */
  excludeUserIds?: readonly string[];
}

/** What `notify` did: the bell items written, and `failed` when the database step failed. */
export interface NotifyResult {
  written: number;
  /**
   * The bell items could not be written (the database failed). A job retries the same call with
   * the same `eventKey`; nobody to notify is `{ written: 0 }` without it.
   */
  failed?: true;
}

/**
 * Events whose occurrences go one way, so the caller names the side (`audience`): a message is
 * either the client's (to the firm) or the firm's (to the client), never both.
 */
export const DIRECTIONAL_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>([
  'message.received',
]);

/** Events whose caller may name the members to reach (`toUserIds`): a rule's Notify staff. */
export const CHOSEN_RECIPIENT_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>([
  'automation.notice',
  // Tax Planning Review 2: a project deadline's owner and the coworkers it is shared with.
  'project-deadline.reminder',
  // Tasks T-D12: a task's assignees.
  'task.reminder',
  // Q36: an acknowledgment reminder (assignee and assigner), an acknowledgment (the assigner) and
  // a comment (assignees and mentioned staff).
  'task.acknowledgement-reminder',
  'task.acknowledged',
  'task.comment',
  // P4-8: a tax plan's assigned staff, when the client asks or approves in the portal.
  'tax-plan.client-request',
  'tax-plan.client-approved',
  // B10: a business plan's advisor and sender, when the client approves it in the portal.
  'advisory-plan.client-approved',
]);

/**
 * Events about a record of many clients (a general announcement, CP-3d): the caller names the
 * client of each occurrence (`clientId`), and the record's loader checks the record reached them.
 */
export const CLIENT_NAMED_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>([
  'announcement.published',
]);

/**
 * Staff events with an email copy through the outbox (a member's own address, as NotifyService
 * finds it): the deadline reminder only. Every other email copy is the client's.
 */
export const STAFF_EMAIL_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>([
  'project-deadline.reminder',
  'task.reminder',
]);

/** A programming error in the call (unknown event, bad id, a side the event never reaches). */
export class NotificationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationInputError';
  }
}

/** Appointments Review 2 (B7, B9): the notices whose client bell item carries the firm's words. */
const PORTAL_WORD_EVENTS: ReadonlySet<string> = new Set([
  'appointment.booked',
  'appointment.changed',
  'appointment.reminder',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- control and format characters never reach a bell
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * One line of at most 120 characters (a title or a name), cut between code points: a lone
 * surrogate would make jsonb refuse the payload and the bell item would never be written.
 */
export const short = (value: string | null | undefined): string | null => {
  const line = value?.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  return line ? Array.from(line).slice(0, 120).join('') : null;
};
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/**
 * CP-3d: an announcement live in the portal now: published (SENT), not expired (archived), and
 * inside its window. The portal's own list (portal-announcements.ts) uses the same rule.
 */
export const liveAnnouncement = (now: Date) => ({
  channel: 'ANNOUNCEMENT' as const,
  status: 'SENT' as const,
  archivedAt: null,
  AND: [
    { OR: [{ publishStartsAt: null }, { publishStartsAt: { lte: now } }] },
    { OR: [{ publishEndsAt: null }, { publishEndsAt: { gt: now } }] },
  ],
});
/** An error's class name for the log (never its message, which may quote values). */
export const errorName = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error';
};

interface RecordInfo {
  clientId: string | null;
  /**
   * A1: the other clients who attend an appointment. Their PRIMARY logins are reached on the
   * client side as the client's is, with the same values (never a name); the staff side stays the
   * client's.
   */
  alsoClientIds?: string[];
  /** Safe values for the text: names, titles, dates, numbers. */
  values: Payload;
  /** A note reminder's owner, or the `user` record itself: the only person it may reach. */
  personUserId?: string;
  /**
   * A private note's reminder: its owner's own login, whatever its portal role (the one exception
   * to "PRIMARY only", q27 (5)).
   */
  noteOwner?: true;
  /**
   * P4-1: a lead's own appointment (no client yet). Its staff side is the lead's, as a client's
   * is the client's: the lead's assigned member and every Owner and Admin, with the lead's name.
   */
  lead?: { name: string; assignedUserId: string | null };
}

type Loader = (
  tx: TxClient,
  businessId: string,
  id: string,
  /** CLIENT_NAMED_EVENTS only: the client the caller named. */
  clientId?: string,
) => Promise<RecordInfo | null>;

/** Each kind of record: its client and its safe values. No file name, amount or text body. */
const RECORDS: Record<NotificationTargetKind, Loader> = {
  // CP-3d: a general announcement live in this client's portal (as the portal lists it: the
  // firm's announcements on, published to them, inside its window, not expired, and not a
  // dashboard one while the firm keeps those off the dashboard). Its title as the client sees it,
  // merge fields filled for them; never its text.
  announcement: async (tx, businessId, id, clientId) => {
    if (!clientId) return null;
    const settings = await announcementSettingsIn(tx, businessId);
    if (!settings.enabled) return null;
    const now = new Date();
    const a = await tx.communication.findFirst({
      where: {
        businessId,
        id,
        ...liveAnnouncement(now),
        recipients: { some: { clientId, status: { not: 'NOT_SENT' } } },
      },
      select: { subject: true, visibility: true },
    });
    if (!a) return null;
    const place = AnnouncementPlace.safeParse(a.visibility).data ?? 'dashboard';
    if (!settings.onDashboard && place === 'dashboard') return null;
    const [client, firm, custom] = await Promise.all([
      tx.client.findFirst({
        where: { businessId, id: clientId },
        select: { displayName: true, email: true, phone: true },
      }),
      tx.business.findUnique({ where: { id: businessId }, select: { name: true } }),
      tx.customMergeField.findMany({
        where: { businessId },
        select: { label: true, fallback: true },
      }),
    ]);
    const values = mergeValues(
      client ? { name: client.displayName, email: client.email, phone: client.phone } : null,
      firm?.name ?? '',
      custom,
    );
    const title = short(a.subject ? fill(a.subject, values, 'text').text : null);
    const payload: Payload = title ? { title } : {};
    return { clientId, values: payload };
  },
  document_request: async (tx, businessId, id) => {
    const r = await tx.documentRequest.findFirst({
      where: { businessId, id },
      select: { clientId: true, title: true, dueOn: true },
    });
    return r && { clientId: r.clientId, values: { title: short(r.title), dueOn: day(r.dueOn) } };
  },
  document: async (tx, businessId, id) => {
    // CP-PT-03: never about a file the firm trashed, archived or replaced.
    const r = await tx.document.findFirst({
      where: { businessId, id, ...LIVE_DOCUMENT },
      select: { clientId: true },
    });
    return r && { clientId: r.clientId, values: {} };
  },
  intake: async (tx, businessId, id) => {
    const r = await tx.intake.findFirst({
      where: { businessId, id },
      select: {
        dueOn: true,
        form: { select: { title: true } },
        engagement: { select: { clientId: true } },
      },
    });
    return (
      r && {
        clientId: r.engagement?.clientId ?? null,
        values: { title: short(r.form.title), dueOn: day(r.dueOn) },
      }
    );
  },
  engagement: async (tx, businessId, id) => {
    const r = await tx.engagement.findFirst({
      where: { businessId, id },
      select: { clientId: true, title: true, status: true },
    });
    return r && { clientId: r.clientId, values: { title: short(r.title), status: r.status } };
  },
  // BK-CP3: a bookkeeping client whose terms the client answered; the text names the service.
  bookkeeping_client: async (tx, businessId, id) => {
    const r = await tx.bookkeepingProfile.findFirst({
      where: { businessId, id },
      select: { engagement: { select: { clientId: true, title: true } } },
    });
    return r && { clientId: r.engagement.clientId, values: { title: short(r.engagement.title) } };
  },
  tax_return: async (tx, businessId, id) => {
    const r = await tx.taxReturn.findFirst({
      where: { businessId, id },
      select: { clientId: true, taxYear: true, formType: true, status: true },
    });
    return (
      r && {
        clientId: r.clientId,
        values: { taxYear: r.taxYear, formType: short(r.formType), status: r.status },
      }
    );
  },
  message_thread: async (tx, businessId, id) => {
    const r = await tx.messageThread.findFirst({
      where: { businessId, id },
      select: { clientId: true },
    });
    return r && { clientId: r.clientId, values: {} };
  },
  // Business scope sees only due reminders, never the note: the reminder job's view.
  client_note_reminder: async (tx, businessId, id) => {
    const r = await tx.clientNoteReminder.findFirst({
      where: { businessId, id },
      select: { userId: true },
    });
    return r && { clientId: null, values: {}, personUserId: r.userId, noteOwner: true as const };
  },
  appointment: async (tx, businessId, id) => {
    const r = await tx.appointment.findFirst({
      where: { businessId, id },
      select: {
        clientId: true,
        startsAt: true,
        type: { select: { name: true } },
        attendees: { select: { clientId: true } },
        lead: { select: { firstName: true, lastName: true, assignedUserId: true } },
      },
    });
    if (!r) return null;
    return {
      clientId: r.clientId,
      ...(!r.clientId && r.lead
        ? {
            lead: {
              name: `${r.lead.firstName} ${r.lead.lastName}`.trim(),
              assignedUserId: r.lead.assignedUserId,
            },
          }
        : {}),
      alsoClientIds: r.attendees.map((a) => a.clientId),
      values: {
        title: short(r.type?.name) ?? 'Appointment',
        startsAt: r.startsAt.toISOString(),
        timeZone: await firmTimeZone(tx, businessId),
      },
    };
  },
  invoice: async (tx, businessId, id) => {
    const r = await tx.invoice.findFirst({
      where: { businessId, id },
      select: { clientId: true, number: true, dueOn: true },
    });
    return r && { clientId: r.clientId, values: { number: short(r.number), dueOn: day(r.dueOn) } };
  },
  // A sign-up waiting: the firm's sign-ups page, no client record yet.
  client_account: async (tx, businessId, id) => {
    const r = await tx.clientAccount.findFirst({
      where: { businessId, id },
      select: { user: { select: { name: true } } },
    });
    return r && { clientId: null, values: { name: short(r.user.name) } };
  },
  membership: async (tx, businessId, id) => {
    const r = await tx.membership.findFirst({
      where: { businessId, id },
      select: { user: { select: { name: true } } },
    });
    return r && { clientId: null, values: { name: short(r.user.name) } };
  },
  // An automation's run: the rule's name (the firm's own words) and the run's client, if any.
  automation_run: async (tx, businessId, id) => {
    const r = await tx.automationRun.findFirst({
      where: { businessId, id },
      select: { clientId: true, rule: { select: { name: true } } },
    });
    return r && { clientId: r.clientId, values: { title: short(r.rule.name) } };
  },
  // Tax Planning Review 2: a project deadline still to do (not completed, not archived). Its
  // client is not the record's: who it reaches is the caller's choice (the owner and its
  // coworkers), and the text never names the client.
  project_deadline: async (tx, businessId, id) => {
    const d = await tx.projectDeadline.findFirst({
      where: { businessId, id, completedAt: null, archivedAt: null },
      select: { name: true, dueAt: true },
    });
    return (
      d && {
        clientId: null,
        values: {
          title: short(d.name),
          dueAt: d.dueAt.toISOString(),
          timeZone: await firmTimeZone(tx, businessId),
        },
      }
    );
  },
  // Tasks T-D15: a recurring series. No client: it reaches Owners and Admins only, and the text
  // names the series, never the client.
  task_series: async (tx, businessId, id) => {
    const s = await tx.taskSeries.findFirst({ where: { businessId, id }, select: { title: true } });
    return s && { clientId: null, values: { title: short(s.title) } };
  },
  // Tasks T-D12: a task still to do (OPEN, not archived). Who it reaches is the caller's choice
  // (its assignees), and the text names the task, never the client.
  task: async (tx, businessId, id) => {
    const t = await tx.task.findFirst({
      where: { businessId, id, status: 'OPEN', archivedAt: null },
      select: { title: true, dueOn: true, dueTime: true, allDay: true },
    });
    if (!t) return null;
    const timeZone = await firmTimeZone(tx, businessId);
    const dueOn = day(t.dueOn);
    const timed = dueOn && t.dueTime && !t.allDay;
    return {
      clientId: null,
      values: {
        title: short(t.title),
        dueOn,
        ...(timed
          ? {
              dueAt: new Date(
                zonedInstant(timeZone, dueOn, minutesOf(timeOfDayFromDb(t.dueTime!))),
              ).toISOString(),
            }
          : {}),
        timeZone,
      },
    };
  },
  // P4-8: a tax plan the client asked about or approved; the text names the plan (the firm's own
  // words) and the client, never the request's text.
  tax_plan: async (tx, businessId, id) => {
    const p = await tx.taxPlan.findFirst({
      where: { businessId, id },
      select: { name: true, clientId: true },
    });
    return p && { clientId: p.clientId, values: { title: short(p.name) } };
  },
  // B10: a business plan the client approved in the portal; the text names the plan (the firm's
  // own words) and the client.
  advisory_plan: async (tx, businessId, id) => {
    const p = await tx.advisoryPlan.findFirst({
      where: { businessId, id },
      select: { name: true, advisoryClient: { select: { clientId: true } } },
    });
    return p && { clientId: p.advisoryClient.clientId, values: { title: short(p.name) } };
  },
  // The person's own account: reaches only them, and only if they have a place in this firm.
  user: (_tx, _businessId, id) =>
    Promise.resolve({ clientId: null, values: {}, personUserId: id.toLowerCase() }),
};

interface Recipient {
  userId: string;
  side: Side;
  name: string;
  /** The client login's email, for the event's email copy. */
  email?: string;
  /** A1: the login of a client who attends the appointment, not its own client's. */
  attendee?: true;
}

/**
 * Events whose email copy is the NotifyService template of the same name: the client's, and the
 * member's for STAFF_EMAIL_EVENTS.
 */
const EMAIL_EVENTS = new Set<NotificationEvent>([
  'document.requested',
  // BK-CP2: a Bookkeeping report published (the sender passes `email: false` when its Report
  // Delivery is the portal only).
  'report.published',
  'appointment.booked',
  'appointment.changed',
  'appointment.reminder',
  'appointment.cancelled',
  // Appointments A3 (R55).
  'appointment.waitlist-offer',
  'project-deadline.reminder',
  'task.reminder',
  'invoice.sent',
  'payment.received',
  // Q23 (IP-041): a bank payment that did not go through.
  'payment.failed',
  // Invoices Review 2 (I-C02, I-N04): the reminders before the due date and the overdue notices.
  'invoice.reminder',
  'invoice.overdue',
  // Intake Forms Review Two 19b: a form sent by Email (the sender passes `email: false` otherwise).
  'intake.sent',
  // Its first and final reminders, the same way.
  'intake.reminder',
  // CP-3d: the firm's policy and the client's choice apply in NotifyService (ANNOUNCEMENTS).
  'announcement.published',
] satisfies (NotificationEvent & NotifyTemplate)[]);

/** Whether a recipient gets the event's email copy: a client, or a member for a staff email event. */
const emailable = (event: NotificationEvent, r: Recipient) =>
  !!r.email && (r.side === 'client' || STAFF_EMAIL_EVENTS.has(event));

/** Events with a text copy, and its NotifyService template (client side only, on request). */
const SMS_EVENTS: Partial<Record<NotificationEvent, NotifyTemplate>> = {
  'document.requested': 'document.requested-sms',
  // A7: an appointment's configured Text reminder.
  'appointment.reminder': 'appointment.reminder-sms',
  // CP-3d: when the firm's text policy leaves it to the client and they agreed.
  'announcement.published': 'announcement.published-sms',
};

/**
 * Whether the record an outbox email is about still stands when the copy is retried (up to ~25
 * minutes later): an appointment still SCHEDULED at the time the email names (a later change sends
 * its own email), an invoice not CANCELED (any status for payment.received, which happened). The
 * record is re-read through the firm's scope by the bell item's entity id. Other events have no
 * state that would make the email wrong and send as before.
 */
async function stillLive(
  db: ReturnType<Database['forBusiness']>,
  businessId: string,
  event: NotificationEvent,
  id: string,
  payload: Payload,
): Promise<boolean> {
  // Appointments Review 2 (P3): a cancellation stands while the appointment is still cancelled
  // and its time has not come.
  // Appointments A3 (R55): an offer stands while it is still open and the appointment scheduled.
  if (event === 'appointment.waitlist-offer') {
    const offer = await db.appointmentWaitlistEntry.findFirst({
      where: {
        businessId,
        appointmentId: id,
        status: 'OFFERED',
        offerExpiresAt: { gt: new Date() },
        appointment: { status: 'SCHEDULED' },
      },
      select: { id: true },
    });
    return offer !== null;
  }
  if (event === 'appointment.cancelled') {
    const a = await db.appointment.findFirst({
      where: { businessId, id },
      select: { status: true, startsAt: true },
    });
    return a?.status === 'CANCELLED' && a.startsAt.getTime() > Date.now();
  }
  if (event.startsWith('appointment.')) {
    const a = await db.appointment.findFirst({
      where: { businessId, id },
      select: { status: true, startsAt: true },
    });
    // Not once it has started: a late copy of a booking or a reminder helps nobody.
    return (
      a?.status === 'SCHEDULED' &&
      a.startsAt.getTime() > Date.now() &&
      (typeof payload.startsAt !== 'string' || a.startsAt.toISOString() === payload.startsAt)
    );
  }
  // I-C02, I-N04: still open (not paid or canceled) and still due when the copy says.
  if (event === 'invoice.reminder' || event === 'invoice.overdue') {
    const i = await db.invoice.findFirst({
      where: { businessId, id },
      select: { status: true, dueOn: true },
    });
    return (
      !!i &&
      i.status === 'OPEN' &&
      (typeof payload.dueOn !== 'string' || day(i.dueOn) === payload.dueOn)
    );
  }
  if (event === 'invoice.sent' || event === 'payment.received' || event === 'payment.failed') {
    const i = await db.invoice.findFirst({ where: { businessId, id }, select: { status: true } });
    // Q23: a failed bank payment is worth telling only while the invoice is still open.
    if (event === 'payment.failed') return i?.status === 'OPEN';
    return !!i && (event === 'payment.received' || i.status !== 'CANCELED');
  }
  // A project deadline still to do, still due when the copy says, and not past by more than an
  // hour (reminder-jobs' PROJECT_DEADLINE_LATE_MS: a reminder at the due time retries too).
  if (event === 'project-deadline.reminder') {
    const d = await db.projectDeadline.findFirst({
      where: { businessId, id, completedAt: null, archivedAt: null },
      select: { dueAt: true },
    });
    return (
      !!d &&
      d.dueAt.getTime() > Date.now() - 60 * 60_000 &&
      (typeof payload.dueAt !== 'string' || d.dueAt.toISOString() === payload.dueAt)
    );
  }
  // Tasks T-D12: a task still to do, still due when the copy says.
  if (event === 'task.reminder') {
    const t = await db.task.findFirst({
      where: { businessId, id, status: 'OPEN', archivedAt: null },
      select: { dueOn: true },
    });
    return (
      !!t &&
      (typeof payload.dueOn !== 'string' || t.dueOn?.toISOString().slice(0, 10) === payload.dueOn)
    );
  }
  // CP-3d: still live in the portal (published, inside its window, not expired) and the firm's
  // announcements still on.
  if (event === 'announcement.published') {
    const [a, settings] = await Promise.all([
      db.communication.findFirst({
        where: { businessId, id, ...liveAnnouncement(new Date()) },
        select: { id: true },
      }),
      db.clientPortalSettings.findUnique({
        where: { businessId },
        select: { announcementsEnabled: true },
      }),
    ]);
    return a !== null && (settings?.announcementsEnabled ?? true);
  }
  if (event === 'intake.sent' || event === 'intake.reminder') {
    // Not once the form is submitted, completed, expired or archived: nothing left to fill in.
    const i = await db.intake.findFirst({ where: { businessId, id }, select: { status: true } });
    return !!i && OPEN_INTAKE.includes(i.status);
  }
  return true;
}

/** An intake form the client can still fill in. */
const OPEN_INTAKE: readonly string[] = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'];

/**
 * 19b: the words of a form's email, read when it is sent (never kept in the outbox): the form's
 * title, the member's subject and message, the due date and the expiry.
 */
async function intakeWords(tx: TxClient, businessId: string, id: string) {
  const row = await tx.intake.findFirst({
    where: { businessId, id },
    select: {
      messageSubject: true,
      messageBody: true,
      dueOn: true,
      expiresAt: true,
      form: { select: { title: true } },
    },
  });
  if (!row) throw new Error('IntakeGone');
  return {
    formTitle: row.form.title,
    subject: row.messageSubject,
    message: row.messageBody,
    dueOn: row.dueOn ? row.dueOn.toISOString().slice(0, 10) : null,
    expiresAt: row.expiresAt,
  };
}

const accountSelect = {
  userId: true,
  email: true,
  clientId: true,
  user: { select: { name: true } },
} as const;
const memberSelect = { userId: true, user: { select: { name: true, email: true } } } as const;

/**
 * Who gets an event, in beta (R6 Decisions, Oct 8; the lead's binding rule from #106 and q27):
 * - client side: the client's ACTIVE PRIMARY portal login only; a note reminder only its owner;
 * - staff side (q27): the client's assigned member when that member is ACTIVE, and always the
 *   firm's ACTIVE Owners and Admins (also when the record has no client, such as a sign-up
 *   waiting or a new team member). A Staff member not assigned to the client never.
 * The client's row is locked FOR SHARE first (as task assignment does), so a reassignment that
 * commits meanwhile is either seen or waits.
 */
async function recipientsOf(
  tx: TxClient,
  businessId: string,
  sides: Side[],
  record: RecordInfo,
  chosen?: readonly string[],
  /** A STAFF_EMAIL_EVENTS event: each member's address comes along for the email copy. */
  staffEmail = false,
): Promise<{ recipients: Recipient[]; clientName: string | null }> {
  const out: Recipient[] = [];
  let clientName: string | null = null;
  const also = new Set(record.alsoClientIds?.map((id) => id.toLowerCase()));
  const asClient = (a: {
    userId: string;
    email: string;
    clientId: string | null;
    user: { name: string };
  }) =>
    out.push({
      userId: a.userId,
      side: 'client',
      name: a.user.name,
      email: a.email,
      ...(a.clientId && also.has(a.clientId.toLowerCase()) ? { attendee: true as const } : {}),
    });
  const asStaff = (m: { userId: string; user: { name: string; email: string } }) =>
    out.push({
      userId: m.userId,
      side: 'staff',
      name: m.user.name,
      ...(staffEmail ? { email: m.user.email } : {}),
    });

  if (sides.includes('client')) {
    // q27 (5): only the PRIMARY login gets portal bell items, also for a personal event (a
    // password change); a note reminder goes to the note's own owner.
    const where = record.personUserId
      ? {
          businessId,
          userId: record.personUserId,
          status: 'ACTIVE' as const,
          ...(record.noteOwner ? {} : { portalRole: 'PRIMARY' as const }),
        }
      : record.clientId
        ? {
            businessId,
            clientId: record.alsoClientIds?.length
              ? { in: [record.clientId, ...record.alsoClientIds] }
              : record.clientId,
            portalRole: 'PRIMARY' as const,
            status: 'ACTIVE' as const,
          }
        : null;
    if (where) (await tx.clientAccount.findMany({ where, select: accountSelect })).map(asClient);
  }
  if (sides.includes('staff')) {
    const active = { businessId, status: 'ACTIVE' as const };
    let assigned: string | null = null;
    if (record.clientId) {
      assigned = (await lockClient(tx, businessId, record.clientId))?.assignedUserId ?? null;
      clientName = short(
        (
          await tx.client.findFirst({
            where: { businessId, id: record.clientId },
            select: { displayName: true },
          })
        )?.displayName,
      );
    } else if (record.lead) {
      // P4-1: a lead's own appointment: the lead's member, as a client's (q27).
      assigned = record.lead.assignedUserId;
      clientName = short(record.lead.name);
    }
    // q27 (Rasel, Oct 8): news about a client goes to its assigned member AND every Owner and
    // Admin; a record without a client to the Owners and Admins; a personal one to that person.
    // A rule's chosen members (CHOSEN_RECIPIENT_EVENTS): this firm's ACTIVE members only, and for
    // a client's record only those who may see the client (its assignee, an Owner or an Admin).
    const managers = { role: { in: ['OWNER' as const, 'ADMIN' as const] } };
    const members = chosen
      ? await tx.membership.findMany({
          where: {
            ...active,
            userId: { in: [...chosen] },
            ...(record.clientId || record.lead
              ? { OR: [managers, ...(assigned ? [{ userId: assigned }] : [])] }
              : {}),
          },
          select: memberSelect,
          orderBy: { createdAt: 'asc' },
        })
      : record.personUserId
        ? await tx.membership.findMany({
            where: { ...active, userId: record.personUserId },
            select: memberSelect,
          })
        : await tx.membership.findMany({
            where: {
              ...active,
              OR: [
                { role: { in: ['OWNER', 'ADMIN'] } },
                ...(assigned ? [{ userId: assigned }] : []),
              ],
            },
            select: memberSelect,
            orderBy: { createdAt: 'asc' },
          });
    members.map(asStaff);
  }
  return { recipients: out, clientName };
}

/** The provider id of the attempt being made, handed from the send back to its outbox row. */
const attemptSink = new AsyncLocalStorage<{ providerMessageId?: string }>();

/**
 * The helper other features call (R6 step 7): `notifier.notify({ businessId, event, recordId })`
 * after their change commits. It writes the bell item for each recipient and sends the event's
 * email copy (NOTIFICATION_EVENTS names that match a NotifyService template) through
 * NotifyService, where the recipient's preferences apply. It rejects only for a programming error
 * (NotificationInputError); a database or delivery failure is logged with ids only and resolves,
 * so the caller's change stands: `{ written: 0, failed: true }` when the bell items could not be
 * written (a job retries with the same eventKey). The bell item never depends on preferences.
 */
@Injectable()
export class Notifier {
  private readonly logger = new Logger('Notifier');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly sender: NotifyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async notify(input: NotifyEventInput): Promise<NotifyResult> {
    const { businessId, event, recordId } = input;
    const def = Object.hasOwn(NOTIFICATION_EVENTS, event) ? NOTIFICATION_EVENTS[event] : null;
    if (!def) throw new NotificationInputError(`Unknown notification event ${String(event)}`);
    for (const id of [businessId, recordId, input.actorUserId ?? null]) {
      if (id !== null && (typeof id !== 'string' || !UUID.test(id))) {
        throw new NotificationInputError(`${event}: ids must be UUIDs`);
      }
    }
    if (
      DIRECTIONAL_EVENTS.has(event) &&
      input.audience !== 'client' &&
      input.audience !== 'staff'
    ) {
      throw new NotificationInputError(`${event} goes one way: audience must be client or staff`);
    }
    const audience = input.audience ?? def.to;
    if (def.to !== 'both' && audience !== def.to) {
      throw new NotificationInputError(`${event} only reaches the ${def.to} side`);
    }
    const sides: Side[] = audience === 'both' ? ['client', 'staff'] : [audience];
    const chosen = input.toUserIds;
    if (chosen !== undefined) {
      if (!CHOSEN_RECIPIENT_EVENTS.has(event))
        throw new NotificationInputError(`${event}: the recipients are not the caller's to choose`);
      if (chosen.length === 0 || chosen.length > 20)
        throw new NotificationInputError(`${event}: name 1 to 20 members`);
      if (chosen.some((id) => typeof id !== 'string' || !UUID.test(id)))
        throw new NotificationInputError(`${event}: ids must be UUIDs`);
    }
    const named = input.clientId;
    if (CLIENT_NAMED_EVENTS.has(event)) {
      if (typeof named !== 'string' || !UUID.test(named))
        throw new NotificationInputError(`${event}: name the client (a UUID)`);
    } else if (named !== undefined) {
      throw new NotificationInputError(`${event}: the client is the record's, not the caller's`);
    }
    const skipped = input.excludeUserIds;
    if (skipped !== undefined) {
      if (skipped.length > 50)
        throw new NotificationInputError(`${event}: exclude at most 50 members`);
      if (skipped.some((id) => typeof id !== 'string' || !UUID.test(id)))
        throw new NotificationInputError(`${event}: ids must be UUIDs`);
    }
    const excluded = new Set(skipped?.map((id) => id.toLowerCase()));
    const what = `${event} for ${def.kind} ${recordId.toLowerCase()}`;
    const bell = input.channels?.inApp ?? true;
    const mail = EMAIL_EVENTS.has(event) && (input.channels?.email ?? true);
    const text = input.channels?.sms === true ? SMS_EVENTS[event] : undefined;

    type Copy = {
      id: string | null;
      recipient: Recipient;
      values: Payload;
      /** The email copy's row in the outbox (notification_deliveries). */
      deliveryId?: string;
    };
    let written: Copy[];
    const actor: { copy: Copy | null } = { copy: null };
    /** The people reached without a bell item (`inApp: false`), and every client for a text. */
    const reached: { direct: Copy[]; clients: Copy[] } = { direct: [], clients: [] };
    try {
      written = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const loaded = await RECORDS[def.kind](
          tx,
          businessId,
          recordId.toLowerCase(),
          named?.toLowerCase(),
        );
        if (!loaded) return [];
        // A3: a waitlist offer is the appointment's own client's, never its attendees'.
        const record =
          event === 'appointment.waitlist-offer' ? { ...loaded, alsoClientIds: [] } : loaded;
        const { recipients, clientName } = await recipientsOf(
          tx,
          businessId,
          sides,
          record,
          chosen?.map((id) => id.toLowerCase()),
          STAFF_EMAIL_EVENTS.has(event),
        );
        const actorId = input.actorUserId?.toLowerCase();
        // The client who acted gets no bell item but keeps the email copy (a confirmation), once:
        // a retried call with the same eventKey sends it again only if nothing was written before.
        const acting = recipients.find((r) => r.userId === actorId && r.side === 'client');
        if (acting && mail) {
          const before = input.eventKey
            ? await tx.notification.findFirst({
                where: { businessId, eventKey: input.eventKey },
                select: { id: true },
              })
            : null;
          if (!before) actor.copy = { id: null, recipient: acting, values: record.values };
        }
        const seen = new Set<string>();
        const to = recipients.filter(
          (r) =>
            r.userId !== actorId &&
            !excluded.has(r.userId) &&
            !seen.has(r.userId) &&
            seen.add(r.userId),
        );
        if (to.length === 0) return [];
        reached.clients = to
          .filter((r) => r.side === 'client')
          .map((r) => ({ id: null, recipient: r, values: record.values }));
        if (!bell) {
          reached.direct = to.map((r) => ({ id: null, recipient: r, values: record.values }));
          return [];
        }
        // Appointments Review 2 (B7, B9): a client's bell item of an appointment notice carries
        // the firm's words for the portal (the note, the instructions shown in the portal).
        const portalWords = PORTAL_WORD_EVENTS.has(event)
          ? await portalNoticeWords(tx, businessId, recordId.toLowerCase(), event, input.at)
          : {};
        const rows = await tx.notification.createManyAndReturn({
          data: to.map((r) => ({
            businessId,
            recipientUserId: r.userId,
            category: def.category,
            type: storedType(event),
            entityType: def.kind,
            entityId: recordId.toLowerCase(),
            payload:
              r.side === 'staff'
                ? { ...record.values, client: clientName }
                : { ...record.values, ...portalWords },
            ...(input.eventKey ? { eventKey: input.eventKey } : {}),
          })),
          skipDuplicates: true,
          select: { id: true, recipientUserId: true },
        });
        const items: Copy[] = rows.map((row) => ({
          id: row.id,
          recipient: to.find((r) => r.userId === row.recipientUserId)!,
          values: record.values,
        }));
        // The outbox: one EMAIL delivery per email copy, committed with its bell item, so a copy
        // that fails (or a task that stops before sending) is retried by the job.
        const mailed = mail ? items.filter((i) => emailable(event, i.recipient)) : [];
        if (mailed.length > 0) {
          const deliveries = await tx.notificationDelivery.createManyAndReturn({
            data: mailed.map((i) => ({ businessId, notificationId: i.id!, channel: 'EMAIL' })),
            select: { id: true, notificationId: true },
          });
          for (const d of deliveries) {
            const item = mailed.find((i) => i.id === d.notificationId);
            if (item) item.deliveryId = d.id;
          }
        }
        return items;
      });
    } catch (error) {
      this.logger.warn(`${what}: not written (${errorName(error)})`);
      return { written: 0, failed: true };
    }
    if (written.length === 0 && reached.clients.length === 0 && reached.direct.length === 0)
      this.logger.log(`${what}: nobody to notify`);

    const target = { kind: def.kind, id: recordId.toLowerCase() };
    if (mail) {
      // The actor's confirmation has no bell item, so no outbox row: one attempt.
      if (actor.copy?.recipient.email) {
        await this.sendCopy(event as NotifyTemplate, businessId, null, actor.copy.recipient, {
          ...target,
          values: actor.copy.values,
        });
      }
      for (const item of written) {
        if (!item.deliveryId) continue;
        await this.deliver(businessId, item.deliveryId, 0, () =>
          this.sendCopy(event as NotifyTemplate, businessId, item.id, item.recipient, {
            ...target,
            values: item.values,
          }),
        );
      }
      // No bell item, so no outbox row: one attempt each, as the actor's confirmation.
      for (const item of reached.direct) {
        if (!emailable(event, item.recipient)) continue;
        await this.sendCopy(event as NotifyTemplate, businessId, null, item.recipient, {
          ...target,
          values: item.values,
        });
      }
      // P4-1: a lead's own appointment has no login to reach: its reminder goes to the lead's
      // email, without the portal link and never as a text (`leadNotice`).
      if (event === 'appointment.reminder' && sides.includes('client')) {
        await this.sendLeadReminder(businessId, target.id);
      }
    }
    if (text && reached.clients.length > 0) {
      await this.sendTexts(text, businessId, reached.clients, target);
    }
    return { written: written.length };
  }

  /** P4-1: the lead's reminder of its own appointment, when it has one to get; ids-only log. */
  private async sendLeadReminder(businessId: string, appointmentId: string): Promise<void> {
    try {
      const message = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
        leadNotice(tx, businessId, appointmentId, 'appointment.reminder'),
      );
      if (message) await this.sender.send(message);
    } catch (error) {
      this.logger.warn(
        `appointment.reminder for appointment ${appointmentId}: the lead's copy failed (${errorName(error)})`,
      );
    }
  }

  /**
   * The text copy, once for each client: only when the firm sends texts and the login has a
   * phone; NotifyService then skips anyone who has not agreed to texts in the category. Ids only
   * in the log, never a number.
   */
  private async sendTexts(
    template: NotifyTemplate,
    businessId: string,
    clients: { recipient: Recipient; values: Payload }[],
    target: { kind: NotificationTargetKind; id: string },
  ): Promise<void> {
    try {
      const db = this.database.forBusiness(businessId);
      const settings = await db.messageSettings.findUnique({
        where: { businessId },
        select: { smsEnabled: true },
      });
      if (!settings?.smsEnabled) {
        this.logger.log(`${template} for ${target.kind} ${target.id}: the firm sends no texts`);
        return;
      }
      const phones = await db.user.findMany({
        where: { id: { in: clients.map((c) => c.recipient.userId) } },
        select: { id: true, phone: true },
      });
      const link = await this.portalLink(businessId, target);
      // A7: an appointment text carries its Text reminder's note and the instructions shown in
      // texts (B9), read when it is sent.
      const words =
        template === 'appointment.reminder-sms'
          ? await this.database.withScope({ kind: 'business', businessId }, (tx) =>
              noticeWords(tx, businessId, target.id, 'appointment.reminder', new Date(), 'SMS'),
            )
          : null;
      for (const c of clients) {
        const to = phones.find((p) => p.id === c.recipient.userId)?.phone;
        if (!to) continue;
        const v = c.values;
        const str = (key: string) => (typeof v[key] === 'string' ? v[key] : '');
        try {
          await this.sender.send({
            template,
            to,
            businessId,
            recipient: { userId: c.recipient.userId },
            data:
              template === 'announcement.published-sms'
                ? { title: str('title'), link }
                : words
                  ? {
                      title: str('title'),
                      startsAt: new Date(str('startsAt')),
                      timeZone: str('timeZone'),
                      link,
                      message: words.message,
                      instructions: words.instructions,
                    }
                  : { title: str('title'), dueOn: str('dueOn') || null, link },
          } as NotifyMessage);
        } catch (error) {
          this.logger.warn(
            `${template} for user ${c.recipient.userId} not sent (${errorName(error)})`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `${template} for ${target.kind} ${target.id} not sent (${errorName(error)})`,
      );
    }
  }

  /** The record's page on the firm's portal, from config (never from the caller). */
  /** The firm app's page for a staff email copy (APP_BASE_URL, from config). */
  private appLink(target: { kind: NotificationTargetKind; id: string }): string {
    const page = notificationLink(
      { kind: target.kind, id: target.id, clientId: null },
      { site: 'firm' },
    );
    if (!page) throw new Error('NoFirmPage');
    return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}${page}`;
  }

  private async portalLink(
    businessId: string,
    target: { kind: NotificationTargetKind; id: string },
  ): Promise<string> {
    const firm = await this.database
      .forBusiness(businessId)
      .business.findUnique({ where: { id: businessId }, select: { slug: true } });
    const page = firm
      ? notificationLink(
          { kind: target.kind, id: target.id, clientId: null },
          { site: 'portal', firmSlug: firm.slug },
        )
      : null;
    if (!page) throw new Error('NoPortalPage');
    return `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}${page}`;
  }

  /**
   * Retries one email copy from the outbox (the job calls it for a QUEUED or FAILED delivery):
   * rebuilt from its bell item (the record's safe values) and the recipient's login as it is now.
   * SKIPPED when the login is no longer the ACTIVE PRIMARY one, or the record no longer stands (`stillLive`).
   * `busy`: another task claimed it first.
   */
  async retryDelivery(
    businessId: string,
    deliveryId: string,
    attempts: number,
  ): Promise<'sent' | 'failed' | 'skipped' | 'busy'> {
    return this.deliver(businessId, deliveryId, attempts, async () => {
      const db = this.database.forBusiness(businessId);
      const d = await db.notificationDelivery.findFirst({
        where: { businessId, id: deliveryId, channel: 'EMAIL' },
        select: {
          notification: {
            select: { id: true, recipientUserId: true, type: true, entityId: true, payload: true },
          },
        },
      });
      const n = d?.notification;
      const event = n ? eventOfType(n.type) : null;
      if (!n || !event || !EMAIL_EVENTS.has(event)) return 'skip';
      if (!(await stillLive(db, businessId, event, n.entityId, (n.payload ?? {}) as Payload))) {
        return 'skip';
      }
      const target = {
        kind: NOTIFICATION_EVENTS[event].kind,
        id: n.entityId,
        values: (n.payload ?? {}) as Payload,
      };
      if (STAFF_EMAIL_EVENTS.has(event)) {
        const member = await db.membership.findFirst({
          where: { businessId, userId: n.recipientUserId, status: 'ACTIVE' },
          select: memberSelect,
        });
        if (!member) return 'skip';
        return this.sendCopy(
          event as NotifyTemplate,
          businessId,
          n.id,
          {
            userId: member.userId,
            side: 'staff',
            name: member.user.name,
            email: member.user.email,
          },
          target,
        );
      }
      // Only the PRIMARY login gets client copies (q27), as when the copy was first written.
      const login = await db.clientAccount.findFirst({
        where: { businessId, userId: n.recipientUserId, status: 'ACTIVE', portalRole: 'PRIMARY' },
        select: accountSelect,
      });
      if (!login) return 'skip';
      return this.sendCopy(
        event as NotifyTemplate,
        businessId,
        n.id,
        { userId: login.userId, side: 'client', name: login.user.name, email: login.email },
        {
          kind: NOTIFICATION_EVENTS[event].kind,
          id: n.entityId,
          values: (n.payload ?? {}) as Payload,
        },
      );
    });
  }

  /**
   * One attempt at an outbox delivery: claims it (attempts goes up only if nobody else did it
   * first), sends, and records SENT, SKIPPED or FAILED with the error's name only.
   */
  private async deliver(
    businessId: string,
    deliveryId: string,
    attempts: number,
    send: () => Promise<string | null | 'skip'>,
  ): Promise<'sent' | 'failed' | 'skipped' | 'busy'> {
    try {
      const db = this.database.forBusiness(businessId);
      const claimed = await db.notificationDelivery.updateMany({
        where: { businessId, id: deliveryId, attempts, status: { in: ['QUEUED', 'FAILED'] } },
        data: { attempts: attempts + 1 },
      });
      if (claimed.count !== 1) return 'busy';
      const sink: { providerMessageId?: string } = {};
      const error = await attemptSink.run(sink, send);
      const status = error === null ? 'SENT' : error === 'skip' ? 'SKIPPED' : 'FAILED';
      // Only while this claim is the latest: a later claim's outcome is never overwritten.
      await db.notificationDelivery.updateMany({
        where: { businessId, id: deliveryId, attempts: attempts + 1 },
        data: {
          status,
          sentAt: status === 'SENT' ? new Date() : null,
          // The provider's own id for the accepted email (never the address or the text).
          ...(status === 'SENT' && sink.providerMessageId
            ? { providerMessageId: sink.providerMessageId }
            : {}),
          lastError: status === 'FAILED' ? error : null,
        },
      });
      return status === 'SENT' ? 'sent' : status === 'SKIPPED' ? 'skipped' : 'failed';
    } catch (error) {
      this.logger.warn(`delivery ${deliveryId}: not recorded (${errorName(error)})`);
      return 'failed';
    }
  }

  /**
   * A person's phone number changed or was removed: every SMS choice they made in this firm is
   * off again, so texts start only after they opt in for the new number (the contract's rule).
   * Called by whoever owns the phone change.
   */
  async phoneChanged(
    businessId: string,
    userId: string,
    /** The caller's transaction in this firm, so the clearing commits with the number's change. */
    tx?: TxClient,
  ): Promise<{ cleared: number }> {
    if (!UUID.test(businessId) || !UUID.test(userId)) {
      throw new NotificationInputError('phoneChanged: ids must be UUIDs');
    }
    const { count } = await (
      tx ?? this.database.forBusiness(businessId)
    ).notificationPreference.updateMany({
      where: { businessId, userId: userId.toLowerCase(), sms: true },
      data: { sms: false },
    });
    return { cleared: count };
  }

  /**
   * The email copy, to the client login's own address. Ids only in the log. Resolves null when
   * sent, or the error's name.
   */
  private async sendCopy(
    template: NotifyTemplate,
    businessId: string,
    notificationId: string | null,
    recipient: Recipient,
    target: { kind: NotificationTargetKind; id: string; values: Payload },
  ): Promise<string | null> {
    try {
      const link =
        recipient.side === 'staff'
          ? this.appLink(target)
          : await this.portalLink(businessId, target);
      const v = target.values;
      const str = (key: string) => (typeof v[key] === 'string' ? v[key] : '');
      const data =
        template === 'task.reminder'
          ? {
              name: recipient.name,
              title: str('title'),
              dueOn: str('dueOn'),
              ...(str('dueAt') ? { dueAt: new Date(str('dueAt')) } : {}),
              timeZone: str('timeZone'),
              link,
            }
          : template === 'project-deadline.reminder'
            ? {
                name: recipient.name,
                title: str('title'),
                dueAt: new Date(str('dueAt')),
                timeZone: str('timeZone'),
                link,
              }
            : template === 'appointment.waitlist-offer'
              ? {
                  name: recipient.name,
                  link,
                  // The open offer, read when the email is sent: its times only.
                  ...(await this.database.withScope(
                    { kind: 'business', businessId },
                    async (tx) => {
                      const e = await tx.appointmentWaitlistEntry.findFirst({
                        where: { businessId, appointmentId: target.id, status: 'OFFERED' },
                        select: {
                          offeredStartsAt: true,
                          offerExpiresAt: true,
                          appointment: { select: { startsAt: true } },
                        },
                      });
                      if (!e?.offeredStartsAt || !e.offerExpiresAt) throw new Error('offer ended');
                      return {
                        offeredStartsAt: e.offeredStartsAt,
                        startsAt: e.appointment.startsAt,
                        expiresAt: e.offerExpiresAt,
                        timeZone: await firmTimeZone(tx, businessId),
                      };
                    },
                  )),
                }
              : template === 'appointment.cancelled'
                ? {
                    name: recipient.name,
                    title: str('title'),
                    startsAt: new Date(str('startsAt')),
                    timeZone: str('timeZone'),
                    link,
                    // Read when the email is sent, never kept in the outbox.
                    reason: await this.database.withScope({ kind: 'business', businessId }, (tx) =>
                      tx.appointment
                        .findFirst({
                          where: { businessId, id: target.id },
                          select: { cancelReason: true },
                        })
                        .then((a) => a?.cancelReason ?? null),
                    ),
                  }
                : template === 'document.requested'
                  ? { name: recipient.name, title: str('title'), dueOn: str('dueOn') || null, link }
                  : template === 'report.published'
                    ? { name: recipient.name, title: str('title') || 'your service', link }
                    : template === 'announcement.published'
                      ? { name: recipient.name, title: str('title'), link }
                      : template === 'intake.sent' || template === 'intake.reminder'
                        ? {
                            name: recipient.name,
                            link,
                            ...(await this.database.withScope(
                              { kind: 'business', businessId },
                              (tx) => intakeWords(tx, businessId, target.id),
                            )),
                          }
                        : template === 'invoice.sent' ||
                            template === 'payment.received' ||
                            template === 'payment.failed'
                          ? { name: recipient.name, invoiceNumber: str('number'), link }
                          : template === 'invoice.reminder' || template === 'invoice.overdue'
                            ? {
                                name: recipient.name,
                                invoiceNumber: str('number'),
                                dueOn: str('dueOn'),
                                link,
                              }
                            : {
                                name: recipient.name,
                                title: str('title'),
                                startsAt: new Date(str('startsAt')),
                                timeZone: str('timeZone'),
                                link,
                                // Review 2 (B7, B9): read when the email is sent, never kept in the outbox.
                                ...(await this.database.withScope(
                                  { kind: 'business', businessId },
                                  (tx) => noticeWords(tx, businessId, target.id, template),
                                )),
                                // A1: only the appointment's own client confirms it.
                                ...(recipient.attendee ? { confirmAsk: false } : {}),
                              };
      const sent = await this.sender.send({
        template,
        to: recipient.email!,
        businessId,
        recipient: { userId: recipient.userId },
        data,
      } as NotifyMessage);
      const store = attemptSink.getStore();
      if (store && sent && sent.providerMessageId) store.providerMessageId = sent.providerMessageId;
      return null;
    } catch (error) {
      this.logger.warn(
        `${template} email for ${notificationId ? `notification ${notificationId}` : `the actor of ${target.kind} ${target.id}`} not sent (${errorName(error)})`,
      );
      return errorName(error);
    }
  }
}
