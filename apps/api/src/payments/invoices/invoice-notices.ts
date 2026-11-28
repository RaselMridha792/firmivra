import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../../database/database.module.js';
import { Notifier } from '../../notifications/notifier.js';

export type InvoiceNotice =
  | 'invoice.sent'
  | 'payment.received'
  // Q23 (IP-041): a bank payment the bank did not complete, to both sides.
  | 'payment.failed'
  // Invoices Review 2 (I-C02, I-N04): before the due date, and overdue.
  | 'invoice.reminder'
  | 'invoice.overdue';

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
    await this.notice(event, businessId, invoiceId, actorUserId, audience);
  }

  /**
   * I-C02, I-N04: a reminder before the due date or an overdue notice, to the client, once per
   * `eventKey` (the invoice, its step and its due date). True when the Notifier has it.
   */
  remind(
    event: 'invoice.reminder' | 'invoice.overdue',
    businessId: string,
    invoiceId: string,
    eventKey: string,
  ): Promise<boolean> {
    return this.notice(event, businessId, invoiceId, null, 'client', eventKey);
  }

  private async notice(
    event: InvoiceNotice,
    businessId: string,
    invoiceId: string,
    actorUserId: string | null,
    audience?: 'client' | 'staff',
    eventKey?: string,
  ): Promise<boolean> {
    try {
      // The invoice's "Send email notification to client" decides its reminders' emails too.
      const email =
        event === 'payment.received' || event === 'payment.failed'
          ? true
          : await this.emailsClient(businessId, invoiceId);
      const result = await this.notifier.notify({
        businessId,
        event,
        recordId: invoiceId,
        actorUserId,
        ...(audience ? { audience } : {}),
        ...(eventKey ? { eventKey } : {}),
        ...(email ? {} : { channels: { inApp: true, email: false, sms: false } }),
      });
      if (result.failed) this.logger.warn(`${event} for invoice ${invoiceId} was not written`);
      return !result.failed;
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.warn(`${event} for invoice ${invoiceId} failed (${name})`);
      return false;
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
