import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../../database/database.module.js';
import { Notifier } from '../../notifications/notifier.js';

export type InvoiceNotice = 'invoice.sent' | 'payment.received';

/**
 * Invoice events through R6's Notifier (one helper for every feature): `invoice.sent` to the
 * client when an invoice opens (IP-F04: its email copy only when the invoice's "Send email
 * notification to client" is on; the portal's bell item either way); `payment.received` to the
 * firm when a payment succeeds, and to the client as their receipt (IP-F12, invoice-receipts.ts). The Notifier picks the recipients (the client's ACTIVE PRIMARY login, q27; the firm's
 * side worded for staff), writes the bell items and sends the email copy with names, the invoice
 * number and a link only. Called after the change commits; a failure never fails the change and
 * is logged with ids only.
 */
@Injectable()
export class InvoiceNotices {
  private readonly logger = new Logger('InvoiceNotices');

  constructor(
    private readonly notifier: Notifier,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  async send(
    event: InvoiceNotice,
    businessId: string,
    invoiceId: string,
    actorUserId: string | null = null,
    /** IP-F12: one side only (the client's receipt, the firm's notice); left out: both. */
    audience?: 'client' | 'staff',
  ): Promise<void> {
    try {
      const email =
        event === 'invoice.sent' ? await this.emailsClient(businessId, invoiceId) : true;
      const result = await this.notifier.notify({
        businessId,
        event,
        recordId: invoiceId,
        actorUserId,
        ...(audience ? { audience } : {}),
        ...(email ? {} : { channels: { inApp: true, email: false, sms: false } }),
      });
      if (result.failed) this.logger.warn(`${event} for invoice ${invoiceId} was not written`);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.warn(`${event} for invoice ${invoiceId} failed (${name})`);
    }
  }

  /** IP-F04: the invoice's "Send email notification to client". */
  private async emailsClient(businessId: string, invoiceId: string): Promise<boolean> {
    const row = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      tx.invoice.findFirst({ where: { businessId, id: invoiceId }, select: { emailClient: true } }),
    );
    return row?.emailClient ?? true;
  }
}
