import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { MessageDirection } from '@firmivra/types';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyMessage, type NotifyService } from '../notify/notify.types.js';

const base = (url: string) => url.replace(/\/+$/, '');

/**
 * The email notice of a new message ('message.new'): never its subject or text, only the firm's
 * name and a link. To the client (their primary portal login, else the client record's email)
 * when the firm writes; to the client's assigned staff member, else the firm's active owners and
 * admins, when the client writes. A failure never fails the message (logged by thread id only).
 */
@Injectable()
export class MessageNotices {
  private readonly logger = new Logger('MessageNotices');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(businessId: string, threadId: string, direction: MessageDirection): Promise<void> {
    let messages: NotifyMessage<'message.new'>[] = [];
    try {
      messages = await this.messages(businessId, threadId, direction);
    } catch {
      this.logger.warn(`Could not prepare the notice for message thread ${threadId}`);
    }
    for (const message of messages) {
      try {
        await this.notify.send(message);
      } catch {
        // Ids only (hard rule 4). The message stands; R6 owns delivery and retries.
        this.logger.warn(`Could not send the notice for message thread ${threadId}`);
      }
    }
  }

  private messages(
    businessId: string,
    threadId: string,
    direction: MessageDirection,
  ): Promise<NotifyMessage<'message.new'>[]> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const thread = await tx.messageThread.findFirstOrThrow({
        where: { businessId, id: threadId },
        select: {
          clientId: true,
          client: { select: { displayName: true, email: true, assignedUserId: true } },
        },
      });
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { slug: true },
      });
      const notice = (to: string, name: string, link: string) => ({
        template: 'message.new' as const,
        to,
        businessId,
        data: { name, link },
      });
      if (direction === 'FIRM_TO_CLIENT') {
        const account = await tx.clientAccount.findFirst({
          where: { businessId, clientId: thread.clientId, portalRole: 'PRIMARY', status: 'ACTIVE' },
          select: { id: true, email: true, user: { select: { name: true } } },
        });
        const to = account?.email ?? thread.client.email;
        if (!to) return [];
        const link = `${base(this.env.PORTAL_BASE_URL)}/${firm.slug}/messages`;
        return [
          {
            ...notice(to, account?.user.name ?? thread.client.displayName, link),
            ...(account ? { recipient: { clientAccountId: account.id } } : {}),
          },
        ];
      }
      const member = { businessId, status: 'ACTIVE' as const };
      const assigned = thread.client.assignedUserId
        ? await tx.membership.findMany({
            where: { ...member, userId: thread.client.assignedUserId },
            select: { userId: true, user: { select: { email: true, name: true } } },
          })
        : [];
      const staff = assigned.length
        ? assigned
        : await tx.membership.findMany({
            where: { ...member, role: { in: ['OWNER', 'ADMIN'] } },
            select: { userId: true, user: { select: { email: true, name: true } } },
          });
      const link = `${base(this.env.APP_BASE_URL)}/clients/${thread.clientId}/messages`;
      return staff.map((m) => ({
        ...notice(m.user.email, m.user.name, link),
        recipient: { userId: m.userId },
      }));
    });
  }
}
