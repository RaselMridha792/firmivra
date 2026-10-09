import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationTargetKind,
  notificationLink,
} from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
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

/** A programming error in the call (unknown event, bad id, a side the event never reaches). */
export class NotificationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationInputError';
  }
}

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
/** An error's class name for the log (never its message, which may quote values). */
export const errorName = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error';
};

interface RecordInfo {
  clientId: string | null;
  /** Safe values for the text: names, titles, dates, numbers. */
  values: Payload;
  /** A note reminder's owner, or the `user` record itself: the only person it may reach. */
  personUserId?: string;
  /**
   * A private note's reminder: its owner's own login, whatever its portal role (the one exception
   * to "PRIMARY only", q27 (5)).
   */
  noteOwner?: true;
}

type Loader = (tx: TxClient, businessId: string, id: string) => Promise<RecordInfo | null>;

/** Each kind of record: its client and its safe values. No file name, amount or text body. */
const RECORDS: Record<NotificationTargetKind, Loader> = {
  document_request: async (tx, businessId, id) => {
    const r = await tx.documentRequest.findFirst({
      where: { businessId, id },
      select: { clientId: true, title: true, dueOn: true },
    });
    return r && { clientId: r.clientId, values: { title: short(r.title), dueOn: day(r.dueOn) } };
  },
  document: async (tx, businessId, id) => {
    const r = await tx.document.findFirst({
      where: { businessId, id },
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
      select: { clientId: true, startsAt: true, type: { select: { name: true } } },
    });
    if (!r) return null;
    return {
      clientId: r.clientId,
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
      select: { clientId: true, number: true },
    });
    return r && { clientId: r.clientId, values: { number: short(r.number) } };
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
}

/** Events whose email copy is the NotifyService template of the same name (client side only). */
const EMAIL_EVENTS = new Set<NotificationEvent>([
  'document.requested',
  'appointment.booked',
  'appointment.changed',
  'appointment.reminder',
  'invoice.sent',
  'payment.received',
] satisfies (NotificationEvent & NotifyTemplate)[]);

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
  if (event.startsWith('appointment.')) {
    const a = await db.appointment.findFirst({
      where: { businessId, id },
      select: { status: true, startsAt: true },
    });
    return (
      a?.status === 'SCHEDULED' &&
      (typeof payload.startsAt !== 'string' || a.startsAt.toISOString() === payload.startsAt)
    );
  }
  if (event === 'invoice.sent' || event === 'payment.received') {
    const i = await db.invoice.findFirst({ where: { businessId, id }, select: { status: true } });
    return !!i && (event === 'payment.received' || i.status !== 'CANCELED');
  }
  return true;
}

const accountSelect = { userId: true, email: true, user: { select: { name: true } } } as const;
const memberSelect = { userId: true, user: { select: { name: true } } } as const;

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
): Promise<{ recipients: Recipient[]; clientName: string | null }> {
  const out: Recipient[] = [];
  let clientName: string | null = null;
  const asClient = (a: { userId: string; email: string; user: { name: string } }) =>
    out.push({ userId: a.userId, side: 'client', name: a.user.name, email: a.email });
  const asStaff = (m: { userId: string; user: { name: string } }) =>
    out.push({ userId: m.userId, side: 'staff', name: m.user.name });

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
            clientId: record.clientId,
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
    }
    // q27 (Rasel, Oct 8): news about a client goes to its assigned member AND every Owner and
    // Admin; a record without a client to the Owners and Admins; a personal one to that person.
    const members = record.personUserId
      ? await tx.membership.findMany({
          where: { ...active, userId: record.personUserId },
          select: memberSelect,
        })
      : await tx.membership.findMany({
          where: {
            ...active,
            OR: [{ role: { in: ['OWNER', 'ADMIN'] } }, ...(assigned ? [{ userId: assigned }] : [])],
          },
          select: memberSelect,
          orderBy: { createdAt: 'asc' },
        });
    members.map(asStaff);
  }
  return { recipients: out, clientName };
}

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
    const what = `${event} for ${def.kind} ${recordId.toLowerCase()}`;

    type Copy = {
      id: string | null;
      recipient: Recipient;
      values: Payload;
      /** The email copy's row in the outbox (notification_deliveries). */
      deliveryId?: string;
    };
    let written: Copy[];
    const actor: { copy: Copy | null } = { copy: null };
    try {
      written = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const record = await RECORDS[def.kind](tx, businessId, recordId.toLowerCase());
        if (!record) return [];
        const { recipients, clientName } = await recipientsOf(tx, businessId, sides, record);
        const actorId = input.actorUserId?.toLowerCase();
        // The client who acted gets no bell item but keeps the email copy (a confirmation), once:
        // a retried call with the same eventKey sends it again only if nothing was written before.
        const acting = recipients.find((r) => r.userId === actorId && r.side === 'client');
        if (acting && EMAIL_EVENTS.has(event)) {
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
          (r) => r.userId !== actorId && !seen.has(r.userId) && seen.add(r.userId),
        );
        if (to.length === 0) return [];
        const rows = await tx.notification.createManyAndReturn({
          data: to.map((r) => ({
            businessId,
            recipientUserId: r.userId,
            category: def.category,
            type: storedType(event),
            entityType: def.kind,
            entityId: recordId.toLowerCase(),
            payload: r.side === 'staff' ? { ...record.values, client: clientName } : record.values,
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
        const mailed = EMAIL_EVENTS.has(event)
          ? items.filter((i) => i.recipient.side === 'client' && i.recipient.email)
          : [];
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
    if (written.length === 0) this.logger.log(`${what}: nobody to notify`);

    if (EMAIL_EVENTS.has(event)) {
      const target = { kind: def.kind, id: recordId.toLowerCase() };
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
    }
    return { written: written.length };
  }

  /**
   * Retries one email copy from the outbox (the job calls it for a QUEUED or FAILED delivery):
   * rebuilt from its bell item (the record's safe values) and the recipient's login as it is now.
   * SKIPPED when the login is no longer ACTIVE, or the record no longer stands (`stillLive`).
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
      const login = await db.clientAccount.findFirst({
        where: { businessId, userId: n.recipientUserId, status: 'ACTIVE' },
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
      const error = await send();
      const status = error === null ? 'SENT' : error === 'skip' ? 'SKIPPED' : 'FAILED';
      await db.notificationDelivery.updateMany({
        where: { businessId, id: deliveryId },
        data: {
          status,
          sentAt: status === 'SENT' ? new Date() : null,
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
      const link = `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}${page}`;
      const v = target.values;
      const str = (key: string) => (typeof v[key] === 'string' ? v[key] : '');
      const data =
        template === 'document.requested'
          ? { name: recipient.name, title: str('title'), dueOn: str('dueOn') || null, link }
          : template === 'invoice.sent' || template === 'payment.received'
            ? { name: recipient.name, invoiceNumber: str('number'), link }
            : {
                name: recipient.name,
                title: str('title'),
                startsAt: new Date(str('startsAt')),
                timeZone: str('timeZone'),
                link,
              };
      await this.sender.send({
        template,
        to: recipient.email!,
        businessId,
        recipient: { userId: recipient.userId },
        data,
      } as NotifyMessage);
      return null;
    } catch (error) {
      this.logger.warn(
        `${template} email for ${notificationId ? `notification ${notificationId}` : `the actor of ${target.kind} ${target.id}`} not sent (${errorName(error)})`,
      );
      return errorName(error);
    }
  }
}
