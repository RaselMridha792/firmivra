import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DATABASE } from '../../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../../notify/notify.types.js';

export type InvoiceNotice = 'invoice.sent' | 'payment.received';

/**
 * Tells people about an invoice through R6's NotifyService: `invoice.sent` to the client when an
 * invoice opens; `payment.received` to the client and to the firm's Owner and Admins when a
 * payment succeeds. The client's message goes to their primary login (its preferences apply), else
 * the client record's email. Data is names, the invoice number and a link: never an amount. A
 * failure never fails the change; the log names ids only.
 */
@Injectable()
export class InvoiceNotices {
  private readonly logger = new Logger('InvoiceNotices');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(template: InvoiceNotice, businessId: string, invoiceId: string): Promise<void> {
    try {
      const messages = await this.database.withScope(
        { kind: 'business', businessId },
        async (tx) => {
          const invoice = await tx.invoice.findFirst({
            where: { businessId, id: invoiceId },
            select: {
              number: true,
              clientId: true,
              client: { select: { displayName: true, email: true } },
            },
          });
          if (!invoice) return [];
          const firm = await tx.business.findUniqueOrThrow({
            where: { id: businessId },
            select: { slug: true },
          });
          const account = await tx.clientAccount.findFirst({
            where: {
              businessId,
              clientId: invoice.clientId,
              portalRole: 'PRIMARY',
              status: 'ACTIVE',
            },
            select: { id: true, email: true, user: { select: { name: true } } },
          });
          const portal = `${this.env.PORTAL_BASE_URL.replace(/\/$/, '')}/${firm.slug}/invoices`;
          const out = [];
          const to = account?.email ?? invoice.client.email;
          if (to) {
            out.push({
              template,
              to,
              businessId,
              ...(account ? { recipient: { clientAccountId: account.id } } : {}),
              data: {
                name: account?.user.name ?? invoice.client.displayName,
                invoiceNumber: invoice.number,
                link: portal,
              },
            });
          }
          if (template === 'payment.received') {
            const managers = await tx.membership.findMany({
              where: { businessId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
              select: { userId: true, user: { select: { name: true, email: true } } },
            });
            const app = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/invoices`;
            for (const m of managers) {
              out.push({
                template,
                to: m.user.email,
                businessId,
                recipient: { userId: m.userId },
                data: { name: m.user.name, invoiceNumber: invoice.number, link: app },
              });
            }
          }
          return out;
        },
      );
      for (const message of messages) {
        await this.notify.send(message).catch(() => {
          this.logger.warn(`Could not send ${template} for invoice ${invoiceId}`);
        });
      }
    } catch {
      this.logger.warn(`Could not send ${template} for invoice ${invoiceId}`);
    }
  }
}
