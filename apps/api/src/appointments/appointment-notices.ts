import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyMessage, type NotifyService } from '../notify/notify.types.js';
import { firmTimeZone } from './calendar-data.js';

export type AppointmentNotice = 'appointment.booked' | 'appointment.changed';

/**
 * Tells the client about a booking or a new time through R6's NotifyService. R6 has no
 * cancellation template yet, so a cancel sends nothing (docs/work/R12-calendar-content.md). The
 * message goes to the login that acted in the portal, otherwise the client's primary login
 * (their notification preferences apply), otherwise the client record's email. Nothing is sent
 * for an appointment that is over or no longer scheduled. A failure never fails the change.
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
    login?: { clientAccountId: string },
  ): Promise<void> {
    try {
      const message = await this.message(template, businessId, appointmentId, login);
      if (message) await this.notify.send(message);
    } catch {
      // Ids only (hard rule 4). The change stands; R6 owns delivery and retries.
      this.logger.warn(`Could not send ${template} for appointment ${appointmentId}`);
    }
  }

  private message(
    template: AppointmentNotice,
    businessId: string,
    appointmentId: string,
    login?: { clientAccountId: string },
  ): Promise<NotifyMessage<AppointmentNotice> | null> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const a = await tx.appointment.findFirst({
        where: { businessId, id: appointmentId },
        select: {
          clientId: true,
          startsAt: true,
          status: true,
          client: { select: { displayName: true, email: true } },
          type: { select: { name: true } },
        },
      });
      if (!a || a.status !== 'SCHEDULED' || a.startsAt.getTime() <= Date.now()) return null;
      const account = await tx.clientAccount.findFirst({
        where: login
          ? { businessId, id: login.clientAccountId }
          : { businessId, clientId: a.clientId, portalRole: 'PRIMARY', status: 'ACTIVE' },
        select: { id: true, email: true, user: { select: { name: true } } },
      });
      const to = account?.email ?? a.client.email;
      if (!to) return null;
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { name: true, slug: true },
      });
      return {
        template,
        to,
        businessId,
        ...(account ? { recipient: { clientAccountId: account.id } } : {}),
        data: {
          name: account?.user.name ?? a.client.displayName,
          firmName: firm.name,
          title: a.type?.name ?? 'Appointment',
          startsAt: a.startsAt,
          timeZone: await firmTimeZone(tx, businessId),
          link: `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}/appointments`,
        },
      };
    });
  }
}
