import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { type Invoice, INVOICE_ERRORS, type RefundPaymentRequest } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import type { ClientsActor } from '../../clients/clients.service.js';
import { DATABASE } from '../../database/database.module.js';
import { CHECKOUT_LIMITS, providerUnavailable, stripeCall } from '../checkout/checkout-sessions.js';
import { conflict, firmToday, notFound, toInvoice } from '../invoices/invoice-view.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import {
  STRIPE_GATEWAY,
  stripeErrorName,
  type StripeGateway,
  type StripeRefund,
} from '../stripe/stripe-gateway.js';

type Body = z.output<typeof RefundPaymentRequest>;

/**
 * Refunds (docs/api/invoices.yaml, "Refund"), Owner and Admin. The payment row is locked; Stripe
 * gets the payment intent, the amount, `metadata.refund_key` and an idempotency key made of the
 * firm, the payment and the dialog's key, so a double click or a retry refunds once. The refund is
 * PENDING until `charge.refunded` confirms it. The payment intent's refunds at Stripe are looked
 * up by `metadata.refund_key` before any is made (no column keeps the key), so a retry of a
 * refund already made answers the invoice as it is, even after Stripe's 24-hour key window. At
 * most three Stripe calls run under the row lock (CHECKOUT_LIMITS).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Refunds');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway | null,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
  ) {}

  async refund(
    businessId: string,
    actor: ClientsActor,
    invoiceId: string,
    paymentId: string,
    body: Body,
  ): Promise<Invoice> {
    return this.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        await this.invoices.load(tx, businessId, actor, invoiceId);
        await tx.$queryRaw`
          SELECT 1 FROM payments
           WHERE business_id = ${businessId}::uuid AND id = ${paymentId}::uuid FOR UPDATE`;
        const payment = await tx.payment.findFirst({
          where: { businessId, id: paymentId, invoiceId },
        });
        if (!payment) throw notFound();
        if (payment.status !== 'SUCCEEDED' && payment.status !== 'REFUNDED') {
          throw conflict('NOT_REFUNDABLE', INVOICE_ERRORS.NOT_REFUNDABLE);
        }
        if (!this.stripe) throw providerUnavailable();
        const stripe = this.stripe;
        // Stripe makes the payment intent when the client pays; the session names it.
        const session = await stripeCall('checkout.sessions.retrieve', payment.id, () =>
          stripe.retrieveCheckoutSession(payment.accountId, payment.processorRef),
        );
        const paymentIntent = session.paymentIntentId;
        if (!paymentIntent) throw providerUnavailable();
        // One refund per key, also after Stripe has forgotten the idempotency key (24 hours): a
        // refund already made with this key is answered as it is, never made twice.
        const theirs = await stripeCall('refunds.list', payment.id, () =>
          // One page (100): far more refunds than one payment ever has.
          stripe.listRefunds(payment.accountId, { paymentIntent }),
        );
        let made: StripeRefund | null =
          theirs.find((r) => r.refundKey === body.idempotencyKey) ?? null;
        if (!made) {
          const refundable = payment.amountCents - payment.refundReservedCents;
          if (payment.status !== 'SUCCEEDED' || body.amountCents > refundable) {
            throw payment.status === 'SUCCEEDED'
              ? conflict('REFUND_TOO_LARGE', INVOICE_ERRORS.REFUND_TOO_LARGE)
              : conflict('NOT_REFUNDABLE', INVOICE_ERRORS.NOT_REFUNDABLE);
          }
          made = await stripe
            .createRefund(
              payment.accountId,
              {
                paymentIntentId: paymentIntent,
                amountCents: body.amountCents,
                refundKey: body.idempotencyKey,
              },
              `${businessId}:${payment.id}:${body.idempotencyKey}`,
            )
            .catch((error: unknown) => {
              const name = stripeErrorName(error);
              // Refunded in full at Stripe already (in the firm's dashboard, say).
              if (name.endsWith(':charge_already_refunded')) {
                throw conflict('NOT_REFUNDABLE', INVOICE_ERRORS.NOT_REFUNDABLE);
              }
              this.logger.warn(`Stripe refunds.create failed for ${payment.id}: ${name}`);
              throw providerUnavailable();
            });
        }
        const known = await tx.paymentRefund.findUnique({
          where: {
            processor_processorRefundId: { processor: 'STRIPE', processorRefundId: made.id },
          },
        });
        // A refund Stripe already failed or canceled never reserves cents here.
        if (!known && !['failed', 'canceled'].includes(made.status)) {
          await tx.paymentRefund.create({
            data: {
              businessId,
              paymentId: payment.id,
              processorRefundId: made.id,
              accountId: payment.accountId,
              amountCents: made.amountCents,
              currency: payment.currency,
            },
          });
          await this.audit.logIn(
            tx,
            'payment.refund_requested',
            { type: 'payment', id: payment.id },
            { invoiceId, amountCents: made.amountCents },
          );
        }
        const row = await this.invoices.load(tx, businessId, actor, invoiceId);
        return toInvoice(row, (await firmToday(tx, businessId)).today);
      },
      CHECKOUT_LIMITS,
    );
  }
}
