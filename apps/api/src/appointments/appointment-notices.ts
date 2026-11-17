import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyMessage, type NotifyService } from '../notify/notify.types.js';
import { firmTimeZone } from './calendar-data.js';
import { noticeWords } from './notice-words.js';

export type AppointmentNotice =
  'appointment.booked' | 'appointment.changed' | 'appointment.reminder';

/** Who a notice reaches. */
export interface NoticeTo {
  /** The client's login that acted in the portal: the client's copy goes to it. */
  clientAccountId?: string;
  /** A1: only these of the appointment's people (its client, its attendees); all by default. */
  clientIds?: readonly string[];
}

/**
 * Tells the client about a booking or a new time through R6's NotifyService. A cancel by the
 * firm goes through the Notifier instead (`appointment.cancelled`, Appointments Review 2 P3). The
 * message goes to the login that acted in the portal, otherwise the client's primary login
 * (their notification preferences apply), otherwise the client record's email. Nothing is sent
 * for an appointment that is over or no longer scheduled. A failure never fails the change.
 * A1: each other client who attends gets their own copy the same way (their primary login, else
 * their email), with their own name only: a notice never names who else attends.
 */
@Injectable()
export class AppointmentNotices {
  private readonly logger = new Logger('AppointmentNotices');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(
    template: AppointmentNotice,
    businessId: string,
    appointmentId: string,
    to: NoticeTo = {},
  ): Promise<void> {
    let messages: NotifyMessage<AppointmentNotice>[];
    try {
      messages = await this.messages(template, businessId, appointmentId, to);
    } catch {
      // Ids only (hard rule 4). The change stands; R6 owns delivery and retries.
      this.logger.warn(`Could not send ${template} for appointment ${appointmentId}`);
      return;
    }
    for (const message of messages) {
      try {
        await this.notify.send(message);
      } catch {
        this.logger.warn(`Could not send ${template} for appointment ${appointmentId}`);
      }
    }
  }

  /**
   * A reminder (or any notice) now, for Send Reminder: whether it went out. False when there is
   * nothing to send (over, closed, no address) or it failed; the failure is logged by id only.
   */
  async sendNow(
    template: AppointmentNotice,
    businessId: string,
    appointmentId: string,
  ): Promise<boolean> {
    let sent = false;
    try {
      for (const message of await this.messages(template, businessId, appointmentId, {})) {
        try {
          await this.notify.send(message);
          sent = true;
        } catch {
          this.logger.warn(`Could not send ${template} for appointment ${appointmentId}`);
        }
      }
    } catch {
      this.logger.warn(`Could not send ${template} for appointment ${appointmentId}`);
    }
    // The client's or an attendee's copy went out.
    return sent;
  }

  /** One message for each person reached: the client first, then each attendee. */
  private messages(
    template: AppointmentNotice,
    businessId: string,
    appointmentId: string,
    to: NoticeTo,
  ): Promise<NotifyMessage<AppointmentNotice>[]> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const a = await tx.appointment.findFirst({
        where: { businessId, id: appointmentId },
        select: {
          clientId: true,
          startsAt: true,
          status: true,
          client: { select: { displayName: true, email: true } },
          type: { select: { name: true } },
          attendees: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { clientId: true, client: { select: { displayName: true, email: true } } },
          },
        },
      });
      if (!a || a.status !== 'SCHEDULED' || a.startsAt.getTime() <= Date.now()) return [];
      const only = to.clientIds && new Set(to.clientIds.map((id) => id.toLowerCase()));
      // P4-1: a lead's own appointment has no client to tell here (its lead is told separately).
      const people = [
        ...(a.clientId && a.client
          ? [{ clientId: a.clientId, client: a.client, primary: true }]
          : []),
        ...a.attendees.map((x) => ({ ...x, primary: false })),
      ].filter((p) => !only || only.has(p.clientId.toLowerCase()));
      if (people.length === 0) return [];
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { name: true, slug: true },
      });
      const common = {
        firmName: firm.name,
        title: a.type?.name ?? 'Appointment',
        startsAt: a.startsAt,
        timeZone: await firmTimeZone(tx, businessId),
        link: `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}/appointments`,
        // Review 2 (B7, B9): the firm's own words and the instructions shown in email.
        ...(await noticeWords(tx, businessId, appointmentId, template)),
      };
      const out: NotifyMessage<AppointmentNotice>[] = [];
      for (const p of people) {
        const account = await tx.clientAccount.findFirst({
          where:
            p.primary && to.clientAccountId
              ? { businessId, id: to.clientAccountId }
              : { businessId, clientId: p.clientId, portalRole: 'PRIMARY', status: 'ACTIVE' },
          select: { id: true, email: true, user: { select: { name: true } } },
        });
        const address = account?.email ?? p.client.email;
        if (!address) continue;
        out.push({
          template,
          to: address,
          businessId,
          ...(account ? { recipient: { clientAccountId: account.id } } : {}),
          // Their own name only, never another attendee's; only the client confirms it.
          data: {
            name: account?.user.name ?? p.client.displayName,
            ...common,
            ...(p.primary ? {} : { confirmAsk: false }),
          },
        });
      }
      return out;
    });
  }
}
