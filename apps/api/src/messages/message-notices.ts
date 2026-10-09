import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { Notifier } from '../notifications/notifier.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';

/** A message that just committed: who it is for follows from its direction. */
export interface SentMessage {
  businessId: string;
  threadId: string;
  messageId: string;
  /** Who wrote it: never notified about their own message. */
  senderUserId: string;
  toSide: 'client' | 'staff';
}

/** An error's class name for the log (never its message, which may quote values). */
const errorName = (error: unknown) => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][\w.]{0,63}$/.test(name) ? name : 'Error';
};

/**
 * The notices for a new message (R20 step 6), after it commits: the bell item
 * (`message.received`, through R6's Notifier) and the `message.received` email with only the
 * recipient's name and a link built from config, never the message text. Recipients as q27: the
 * client's ACTIVE PRIMARY login; on the firm side the client's assigned member and every Owner
 * and Admin (ACTIVE). No second email for a thread while that side still has an earlier unread
 * message in it. A failure is logged with ids only and never fails the request: the message
 * stands.
 */
@Injectable()
export class MessageNotices {
  private readonly logger = new Logger('MessageNotices');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly sender: NotifyService,
    @Inject(ENV) private readonly env: Env,
    private readonly notifier: Notifier,
  ) {}

  async sent(m: SentMessage): Promise<void> {
    try {
      await this.notifier.notify({
        businessId: m.businessId,
        event: 'message.received',
        recordId: m.threadId,
        audience: m.toSide,
        actorUserId: m.senderUserId,
        eventKey: `message:${m.messageId}`,
      });
      await this.email(m);
    } catch (error) {
      this.logger.warn(`notices for message ${m.messageId} not sent (${errorName(error)})`);
    }
  }

  private async email(m: SentMessage): Promise<void> {
    const db = this.database.forBusiness(m.businessId);
    const message = await db.message.findFirst({
      where: { businessId: m.businessId, id: m.messageId },
      select: {
        createdAt: true,
        direction: true,
        thread: {
          select: {
            clientId: true,
            client: { select: { assignedUserId: true } },
          },
        },
      },
    });
    if (!message) return;
    const earlierUnread = await db.message.count({
      where: {
        businessId: m.businessId,
        threadId: m.threadId,
        direction: message.direction,
        readAt: null,
        createdAt: { lt: message.createdAt },
      },
    });
    if (earlierUnread > 0) return;

    const { clientId } = message.thread;
    const recipients: {
      to: string;
      name: string;
      recipient: { userId: string } | { clientAccountId: string };
    }[] = [];
    let link: string;
    if (m.toSide === 'client') {
      const business = await db.business.findUnique({
        where: { id: m.businessId },
        select: { slug: true },
      });
      if (!business) return;
      const slug = encodeURIComponent(business.slug);
      link = new URL(`/${slug}/messages`, this.env.PORTAL_BASE_URL).toString();
      const logins = await db.clientAccount.findMany({
        where: { businessId: m.businessId, clientId, portalRole: 'PRIMARY', status: 'ACTIVE' },
        select: { id: true, email: true, user: { select: { name: true } } },
      });
      for (const l of logins) {
        recipients.push({ to: l.email, name: l.user.name, recipient: { clientAccountId: l.id } });
      }
    } else {
      link = new URL(`/clients/${clientId}/messages`, this.env.APP_BASE_URL).toString();
      const assigned = message.thread.client.assignedUserId;
      const members = await db.membership.findMany({
        where: {
          businessId: m.businessId,
          status: 'ACTIVE',
          OR: [{ role: { in: ['OWNER', 'ADMIN'] } }, ...(assigned ? [{ userId: assigned }] : [])],
        },
        select: { userId: true, user: { select: { name: true, email: true } } },
      });
      for (const p of members) {
        recipients.push({ to: p.user.email, name: p.user.name, recipient: { userId: p.userId } });
      }
    }
    for (const r of recipients) {
      if ('userId' in r.recipient && r.recipient.userId === m.senderUserId) continue;
      try {
        await this.sender.send({
          template: 'message.received',
          to: r.to,
          businessId: m.businessId,
          recipient: r.recipient,
          data: { name: r.name, link },
        });
      } catch (error) {
        this.logger.warn(
          `message.received email for message ${m.messageId} not sent (${errorName(error)})`,
        );
      }
    }
  }
}
