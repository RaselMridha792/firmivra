import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import { INVOICE_ERRORS } from '@firmivra/types';
import { conflict } from '../invoices/invoice-view.js';
import {
  type CheckoutSession,
  stripeErrorName,
  type StripeGateway,
} from '../stripe/stripe-gateway.js';

const logger = new Logger('Checkout');

/**
 * A transaction that holds the invoice's row while it asks Stripe about its checkouts. Under the
 * row lock an invoice has at most one open checkout, so Pay Now makes at most three Stripe calls
 * (retrieve, expire, create) of up to STRIPE_TIMEOUT_MS each, inside the database's 30 s cap
 * (MAX_TRANSACTION_MS in packages/db).
 */
export const CHECKOUT_LIMITS = { timeout: 30_000 };

export const providerUnavailable = () =>
  new ServiceUnavailableException({
    code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    message: INVOICE_ERRORS.PAYMENT_PROVIDER_UNAVAILABLE,
  });
export const paymentInProgress = () =>
  conflict('PAYMENT_IN_PROGRESS', INVOICE_ERRORS.PAYMENT_IN_PROGRESS);

/** A Stripe call; a failure is 503, logged by error type and ids only. */
export async function stripeCall<T>(what: string, ref: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.warn(`Stripe ${what} failed for ${ref}: ${stripeErrorName(error)}`);
    throw providerUnavailable();
  }
}

/** Takes the invoice's row, so checkouts and cancels of one invoice run one at a time. */
export async function lockInvoice(tx: TxClient, businessId: string, invoiceId: string) {
  await tx.$queryRaw`
    SELECT 1 FROM invoices WHERE business_id = ${businessId}::uuid AND id = ${invoiceId}::uuid FOR UPDATE`;
}

export interface OpenCheckout {
  id: string;
  processorRef: string;
  accountId: string;
  amountCents: number;
  session: CheckoutSession;
}

/**
 * The invoice's checkouts that no event has reached yet, as Stripe sees them now. One Stripe has
 * already completed (paid, its webhook not here yet) is `PAYMENT_IN_PROGRESS`; one that expired is
 * marked FAILED (`checkout_expired`, listed to no one) and left out.
 */
export async function openCheckouts(
  tx: TxClient,
  stripe: StripeGateway,
  businessId: string,
  invoiceId: string,
): Promise<OpenCheckout[]> {
  const pending = await tx.payment.findMany({
    where: { businessId, invoiceId, status: 'PENDING', events: { none: {} } },
    select: { id: true, processorRef: true, accountId: true, amountCents: true },
  });
  const open: OpenCheckout[] = [];
  for (const p of pending) {
    const session = await stripeCall('checkout.sessions.retrieve', p.id, () =>
      stripe.retrieveCheckoutSession(p.accountId, p.processorRef),
    );
    if (session.status === 'complete') throw paymentInProgress();
    if (session.status === 'expired') await markExpired(tx, businessId, p.id);
    else open.push({ ...p, session });
  }
  return open;
}

/** Ends an open checkout at Stripe, then marks its payment FAILED (`checkout_expired`). */
export async function expireCheckout(
  tx: TxClient,
  stripe: StripeGateway,
  businessId: string,
  checkout: OpenCheckout,
): Promise<void> {
  await stripeCall('checkout.sessions.expire', checkout.id, () =>
    stripe.expireCheckoutSession(checkout.accountId, checkout.processorRef),
  );
  await markExpired(tx, businessId, checkout.id);
}

const markExpired = (tx: TxClient, businessId: string, paymentId: string) =>
  tx.payment.updateMany({
    where: { businessId, id: paymentId, status: 'PENDING' },
    data: { status: 'FAILED', failureCode: 'checkout_expired' },
  });
