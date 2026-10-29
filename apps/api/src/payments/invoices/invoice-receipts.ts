import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { INVOICE_ERRORS, type Invoice, type ReceiptFor } from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import type { ClientsActor } from '../../clients/clients.service.js';
import { DATABASE } from '../../database/database.module.js';
import { InvoiceNotices } from './invoice-notices.js';
import { firmToday, invoiceOf } from './invoice-view.js';
import { InvoicesService } from './invoices.service.js';

// IP-F12 (Octavia's Oct 27 review; Rasel, Oct 29): receipts. `payment.received` reaches the firm
// for every payment that succeeds. The client's copy, their receipt, goes only when the firm asked
// for it: Automatic Receipts (Settings > Payments, off by default), Record Payment's Send Receipt,
// or Send/Resend Receipt on the invoice. Each receipt is a RECEIPT_SENT invoice event, written
// with it under a lock on the payment, so an automatic receipt goes once per payment however often
// a request or Stripe's webhook is retried.

const idOf = (p: ReceiptFor) => ('paymentId' in p ? p.paymentId : p.offlinePaymentId);
const refOf = (p: ReceiptFor) =>
  'paymentId' in p ? { paymentId: p.paymentId } : { offlinePaymentId: p.offlinePaymentId };

@Injectable()
export class InvoiceReceipts {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly notices: InvoiceNotices,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
  ) {}

  /**
   * After a payment succeeded and committed: the firm's notice, and the client's receipt when
   * `sendReceipt` (left out: the firm's Automatic Receipts) says so, at most once per payment.
   */
  async afterPayment(
    businessId: string,
    invoiceId: string,
    payment: ReceiptFor,
    options: { sendReceipt?: boolean; actorUserId?: string | null } = {},
  ): Promise<void> {
    const actorUserId = options.actorUserId ?? null;
    await this.notices.send('payment.received', businessId, invoiceId, actorUserId, 'staff');
    const sent = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const wanted =
        options.sendReceipt ??
        (
          await tx.paymentSettings.findUnique({
            where: { businessId },
            select: { autoReceipts: true },
          })
        )?.autoReceipts === true;
      if (!wanted) return false;
      await lockPayment(tx, payment);
      const known = await tx.invoiceEvent.findFirst({
        where: { businessId, invoiceId, type: 'RECEIPT_SENT', ...refOf(payment) },
        select: { id: true },
      });
      if (known) return false;
      await this.record(tx, businessId, invoiceId, payment, actorUserId, true);
      return true;
    });
    if (sent) await this.notices.send('payment.received', businessId, invoiceId, null, 'client');
  }

  /**
   * Send Receipt or Resend Receipt (Owner and Admin): every call sends one, for a SUCCEEDED or
   * REFUNDED Stripe payment or a live offline one; 409 RECEIPT_NOT_AVAILABLE otherwise.
   */
  async send(
    businessId: string,
    actor: ClientsActor,
    invoiceId: string,
    payment: ReceiptFor,
  ): Promise<Invoice> {
    const invoice = await this.database.withScope(
      { kind: 'business', businessId, actorUserId: actor.userId },
      async (tx) => {
        // In reach first: a Staff member without the client, or another firm's invoice, is 404.
        await this.invoices.load(tx, businessId, actor, invoiceId);
        await lockPayment(tx, payment);
        const ok =
          'paymentId' in payment
            ? await tx.payment.findFirst({
                where: {
                  businessId,
                  invoiceId,
                  id: payment.paymentId,
                  status: { in: ['SUCCEEDED', 'REFUNDED'] },
                },
                select: { id: true },
              })
            : await tx.offlinePayment.findFirst({
                where: { businessId, invoiceId, id: payment.offlinePaymentId, voidedAt: null },
                select: { id: true },
              });
        if (!ok) {
          const exists =
            'paymentId' in payment
              ? await tx.payment.findFirst({
                  where: { businessId, invoiceId, id: payment.paymentId },
                  select: { id: true },
                })
              : await tx.offlinePayment.findFirst({
                  where: { businessId, invoiceId, id: payment.offlinePaymentId },
                  select: { id: true },
                });
          if (!exists) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
          throw new ConflictException({
            code: 'RECEIPT_NOT_AVAILABLE',
            message: INVOICE_ERRORS.RECEIPT_NOT_AVAILABLE,
          });
        }
        await this.record(tx, businessId, invoiceId, payment, actor.userId, false);
        const row = await this.invoices.load(tx, businessId, actor, invoiceId);
        return invoiceOf(tx, businessId, row, (await firmToday(tx, businessId)).today);
      },
    );
    await this.notices.send('payment.received', businessId, invoiceId, null, 'client');
    return invoice;
  }

  private async record(
    tx: TxClient,
    businessId: string,
    invoiceId: string,
    payment: ReceiptFor,
    actorUserId: string | null,
    automatic: boolean,
  ) {
    await tx.invoiceEvent.create({
      data: {
        businessId,
        invoiceId,
        type: 'RECEIPT_SENT',
        actorKind: actorUserId ? 'STAFF' : 'SYSTEM',
        actorUserId,
        ...refOf(payment),
      },
    });
    await this.audit.logIn(
      tx,
      'invoice.receipt_sent',
      { type: 'invoice', id: invoiceId },
      { ...refOf(payment), automatic },
      { businessId, ...(actorUserId ? { actorUserId } : {}) },
    );
  }
}

/** One receipt decision per payment at a time (a retried webhook or request waits here). */
async function lockPayment(tx: TxClient, payment: ReceiptFor) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`receipt:${idOf(payment)}`}, 0))`;
}
