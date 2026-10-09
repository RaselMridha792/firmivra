import { Injectable, Logger } from '@nestjs/common';
import { Notifier } from '../../notifications/notifier.js';

export type InvoiceNotice = 'invoice.sent' | 'payment.received';

/**
 * Invoice events through R6's Notifier (one helper for every feature): `invoice.sent` to the
 * client when an invoice opens; `payment.received` to the client and the firm when a payment
 * succeeds. The Notifier picks the recipients (the client's ACTIVE PRIMARY login, q27; the firm's
 * side worded for staff), writes the bell items and sends the email copy with names, the invoice
 * number and a link only. Called after the change commits; a failure never fails the change and
 * is logged with ids only.
 */
@Injectable()
export class InvoiceNotices {
  private readonly logger = new Logger('InvoiceNotices');

  constructor(private readonly notifier: Notifier) {}

  async send(
    event: InvoiceNotice,
    businessId: string,
    invoiceId: string,
    actorUserId: string | null = null,
  ): Promise<void> {
    try {
      const result = await this.notifier.notify({
        businessId,
        event,
        recordId: invoiceId,
        actorUserId,
      });
      if (result.failed) this.logger.warn(`${event} for invoice ${invoiceId} was not written`);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.warn(`${event} for invoice ${invoiceId} failed (${name})`);
    }
  }
}
