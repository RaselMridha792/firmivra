import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { type CheckoutLink, INVOICE_ERRORS } from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DATABASE } from '../../database/database.module.js';
import { conflict } from '../invoices/invoice-view.js';
import { MyInvoicesService } from '../invoices/my-invoices.service.js';
import { STRIPE_GATEWAY, type StripeGateway } from '../stripe/stripe-gateway.js';
import {
  CHECKOUT_LIMITS,
  expireCheckout,
  lockInvoice,
  openCheckouts,
  paymentInProgress,
  providerUnavailable,
  SESSION_MS,
  stripeCall,
  withStripeHold,
} from './checkout-sessions.js';

/** An open session with less left than this is replaced, so the client never lands on a dead page. */
const REUSE_MIN_MS = 10 * 60_000;

/**
 * Pay Now (docs/api/invoices.yaml, "Pay Now (checkout)"). The amount is the balance due from the
 * database; the session runs on the firm's own connected account; one open checkout per invoice.
 * It marks nothing paid: only the webhook does.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway | null,
    @Inject(ENV) private readonly env: Env,
    private readonly mine: MyInvoicesService,
    private readonly audit: AuditService,
  ) {}

  async start(
    businessId: string,
    clientAccountId: string,
    invoiceId: string,
  ): Promise<CheckoutLink> {
    const created: { session?: { accountId: string; id: string } } = {};
    return this.database
      .withScope(
        { kind: 'business', businessId },
        async (tx) => {
          // The client's own invoice first (404 otherwise), so no one else's row is ever locked.
          await this.mine.mine(tx, businessId, clientAccountId, invoiceId);
          await lockInvoice(tx, businessId, invoiceId);
          const { row, mine } = await this.mine.mine(tx, businessId, clientAccountId, invoiceId);
          if (row.status !== 'OPEN' || mine.balanceDueCents <= 0) {
            throw conflict('NOT_PAYABLE', INVOICE_ERRORS.NOT_PAYABLE);
          }
          if (mine.paymentProcessing) throw paymentInProgress();
          const account = await tx.stripeAccount.findUnique({ where: { businessId } });
          if (!account?.chargesEnabled) {
            throw conflict('PAYMENTS_NOT_SET_UP', INVOICE_ERRORS.PAYMENTS_NOT_SET_UP);
          }
          if (!this.stripe) throw providerUnavailable();
          const stripe = this.stripe;
          const amountCents = mine.balanceDueCents;
          return withStripeHold(async () => {
            // One open checkout per invoice: the same amount with time left is answered again.
            let reuse: { id: string; url: string; expiresAt: Date } | null = null;
            for (const open of await openCheckouts(tx, stripe, this.audit, businessId, invoiceId)) {
              const fits =
                !reuse &&
                open.session.url !== null &&
                open.amountCents === amountCents &&
                open.accountId === account.accountId &&
                open.session.expiresAt.getTime() - Date.now() >= REUSE_MIN_MS;
              if (fits) {
                reuse = { id: open.id, url: open.session.url!, expiresAt: open.session.expiresAt };
              } else await expireCheckout(tx, stripe, this.audit, businessId, invoiceId, open);
            }
            if (reuse) {
              await this.audit.logIn(
                tx,
                'invoice.checkout_started',
                { type: 'invoice', id: invoiceId },
                { paymentId: reuse.id, amountCents, currency: row.currency, reused: true },
              );
              return { url: reuse.url, expiresAt: reuse.expiresAt.toISOString() };
            }

            const paymentId = randomUUID();
            const firm = await tx.business.findUniqueOrThrow({
              where: { id: businessId },
              select: { slug: true },
            });
            const back = `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}/invoices`;
            const session = await stripeCall('checkout.sessions.create', paymentId, () =>
              stripe.createCheckoutSession(
                {
                  accountId: account.accountId,
                  invoiceId,
                  paymentId,
                  description: `Invoice ${row.number}`,
                  amountCents,
                  currency: row.currency,
                  successUrl: `${back}?checkout=success&invoice=${invoiceId}`,
                  cancelUrl: `${back}?checkout=canceled&invoice=${invoiceId}`,
                  expiresAt: new Date(Date.now() + SESSION_MS),
                },
                paymentId,
              ),
            );
            created.session = { accountId: account.accountId, id: session.id };
            if (!session.url) throw providerUnavailable();
            await tx.payment.create({
              data: {
                id: paymentId,
                businessId,
                invoiceId,
                amountCents,
                currency: row.currency,
                processorRef: session.id,
                accountId: account.accountId,
              },
            });
            await this.audit.logIn(
              tx,
              'invoice.checkout_started',
              { type: 'invoice', id: invoiceId },
              { paymentId, amountCents, currency: row.currency },
            );
            return { url: session.url, expiresAt: session.expiresAt.toISOString() };
          });
        },
        CHECKOUT_LIMITS,
      )
      .catch(async (error: unknown) => {
        // The session exists at Stripe but nothing here points to it (the transaction ran out of
        // time or failed): end it, so no one can pay through a checkout no row knows.
        const orphan = created.session;
        if (orphan && this.stripe) {
          const { accountId, id: sessionId } = orphan;
          await stripeCall('checkout.sessions.expire', invoiceId, () =>
            this.stripe!.expireCheckoutSession(accountId, sessionId),
          ).catch(() => undefined);
          throw providerUnavailable();
        }
        throw error;
      });
  }
}
