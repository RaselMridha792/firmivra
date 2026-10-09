import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { type Invoice, INVOICE_ERRORS, type RefundPaymentRequest } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import type { ClientsActor } from '../../clients/clients.service.js';
import { DATABASE } from '../../database/database.module.js';
import { CHECKOUT_LIMITS, providerUnavailable, stripeCall } from '../checkout/checkout-sessions.js';
import { conflict, firmToday, notFound, toInvoice } from '../invoices/invoice-view.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { STRIPE_GATEWAY, type StripeGateway } from '../stripe/stripe-gateway.js';

type Body = z.output<typeof RefundPaymentRequest>;

/**
 * Refunds (docs/api/invoices.yaml, "Refund"), Owner and Admin. The payment row is locked; Stripe
 * gets the payment intent, the amount, `metadata.refund_key` and an idempotency key made of the
 * firm, the payment and the dialog's key, so a double click or a retry refunds once. The refund is
 * PENDING until `charge.refunded` confirms it. A retry of a refund already made answers the
 * invoice as it is, found through Stripe (no column keeps the key).
 */
@Injectable()
export class RefundsService {
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
        const refundable = payment.amountCents - payment.refundReservedCents;
        const fits = payment.status === 'SUCCEEDED' && body.amountCents <= refundable;
        if (fits || payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') {
          if (!this.stripe) throw providerUnavailable();
        }
        const stripe = this.stripe;
        // Stripe makes the payment intent when the client pays; the session names it.
        const intentOf = async () => {
          const session = await stripeCall('checkout.sessions.retrieve', payment.id, () =>
            stripe!.retrieveCheckoutSession(payment.accountId, payment.processorRef),
          );
          if (!session.paymentIntentId) throw providerUnavailable();
          return session.paymentIntentId;
        };

        if (fits) {
          const paymentIntentId = await intentOf();
          const made = await stripeCall('refunds.create', payment.id, () =>
            stripe!.createRefund(
              payment.accountId,
              { paymentIntentId, amountCents: body.amountCents, refundKey: body.idempotencyKey },
              `${businessId}:${payment.id}:${body.idempotencyKey}`,
            ),
          );
          const known = await tx.paymentRefund.findUnique({
            where: {
              processor_processorRefundId: { processor: 'STRIPE', processorRefundId: made.id },
            },
          });
          if (!known) {
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
        } else {
          // A retry of a refund already made answers 200 with nothing new.
          let replay = false;
          if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') {
            const paymentIntent = await intentOf();
            const theirs = await stripeCall('refunds.list', payment.id, () =>
              stripe!.listRefunds(payment.accountId, { paymentIntent }),
            );
            const same = theirs.filter((r) => r.refundKey === body.idempotencyKey).map((r) => r.id);
            replay =
              same.length > 0 &&
              (await tx.paymentRefund.count({
                where: { businessId, paymentId: payment.id, processorRefundId: { in: same } },
              })) > 0;
          }
          if (!replay) {
            throw payment.status === 'SUCCEEDED'
              ? conflict('REFUND_TOO_LARGE', INVOICE_ERRORS.REFUND_TOO_LARGE)
              : conflict('NOT_REFUNDABLE', INVOICE_ERRORS.NOT_REFUNDABLE);
          }
        }
        const row = await this.invoices.load(tx, businessId, actor, invoiceId);
        return toInvoice(row, (await firmToday(tx, businessId)).today);
      },
      CHECKOUT_LIMITS,
    );
  }
}
