import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import { INVOICE_ERRORS } from '@firmivra/types';
import type { AuditService } from '../../audit/audit.service.js';
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

/** A Checkout Session lasts this long (Stripe takes 30 minutes to 24 hours). */
export const SESSION_MS = 60 * 60_000;
/** A checkout this much older than its session can no longer be paid, whatever Stripe answers. */
const STALE_MS = SESSION_MS + 15 * 60_000;
/** How long a Pay Now or cancel waits for another one's hold on the invoice before answering 409. */
const LOCK_WAIT = '1s';
/**
 * At most this many transactions of one API process wait on Stripe while they hold a pooled
 * connection and a row; one more answers 503 SERVICE_BUSY at once, so a slow Stripe or one client
 * clicking many times cannot take the pool from every other firm.
 */
const MAX_STRIPE_HOLDERS = 3;
let stripeHolders = 0;

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

/**
 * Takes the invoice's row, so checkouts and cancels of one invoice run one at a time. It waits at
 * most LOCK_WAIT: the row is held long only by another Pay Now or cancel talking to Stripe, so the
 * second click answers 409 PAYMENT_IN_PROGRESS (retryable) instead of holding a pooled connection.
 */
export async function lockInvoice(tx: TxClient, businessId: string, invoiceId: string) {
  const [before] = await tx.$queryRaw<{ v: string }[]>`
    SELECT current_setting('lock_timeout') AS v, set_config('lock_timeout', ${LOCK_WAIT}, true)`;
  try {
    await tx.$queryRaw`
      SELECT 1 FROM invoices WHERE business_id = ${businessId}::uuid AND id = ${invoiceId}::uuid FOR UPDATE`;
  } catch (error) {
    if (lockNotAvailable(error)) throw paymentInProgress();
    throw error;
  }
  await tx.$queryRaw`SELECT set_config('lock_timeout', ${before!.v}, true)`;
}

/** Postgres 55P03 (lock_not_available), however the driver adapter wraps it. */
function lockNotAvailable(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown } | null;
  return (
    e?.code === '55P03' ||
    e?.meta?.code === '55P03' ||
    (typeof e?.message === 'string' && /55P03|lock timeout/.test(e.message))
  );
}

/** Runs `fn`, which calls Stripe while holding a row, in one of the MAX_STRIPE_HOLDERS places. */
export async function withStripeHold<T>(fn: () => Promise<T>): Promise<T> {
  if (stripeHolders >= MAX_STRIPE_HOLDERS) {
    throw new ServiceUnavailableException({
      code: 'SERVICE_BUSY',
      message: 'The service is busy. Please try again in a moment.',
      retryAfter: 5,
    });
  }
  stripeHolders += 1;
  try {
    return await fn();
  } finally {
    stripeHolders -= 1;
  }
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
 * marked FAILED (`checkout_expired`, listed to no one) and left out. One older than its session
 * that Stripe no longer answers for (account disconnected or replaced) is expired too, so it never
 * blocks the invoice; a younger one Stripe does not answer for is 503 (it may still be paid).
 */
export async function openCheckouts(
  tx: TxClient,
  stripe: StripeGateway,
  audit: AuditService,
  businessId: string,
  invoiceId: string,
): Promise<OpenCheckout[]> {
  const pending = await tx.payment.findMany({
    where: { businessId, invoiceId, status: 'PENDING', events: { none: {} } },
    select: { id: true, processorRef: true, accountId: true, amountCents: true, createdAt: true },
  });
  const open: OpenCheckout[] = [];
  for (const { createdAt, ...p } of pending) {
    const stale = Date.now() - createdAt.getTime() > STALE_MS;
    const session = await stripeCall('checkout.sessions.retrieve', p.id, () =>
      stripe.retrieveCheckoutSession(p.accountId, p.processorRef),
    ).catch((error: unknown) => {
      if (stale) return null;
      throw error;
    });
    if (session?.status === 'complete') throw paymentInProgress();
    if (!session || session.status === 'expired') {
      await markExpired(tx, audit, businessId, invoiceId, p.id);
    } else open.push({ ...p, session });
  }
  return open;
}

/** Ends an open checkout at Stripe, then marks its payment FAILED (`checkout_expired`). */
export async function expireCheckout(
  tx: TxClient,
  stripe: StripeGateway,
  audit: AuditService,
  businessId: string,
  invoiceId: string,
  checkout: OpenCheckout,
): Promise<void> {
  await stripeCall('checkout.sessions.expire', checkout.id, () =>
    stripe.expireCheckoutSession(checkout.accountId, checkout.processorRef),
  );
  await markExpired(tx, audit, businessId, invoiceId, checkout.id);
}

async function markExpired(
  tx: TxClient,
  audit: AuditService,
  businessId: string,
  invoiceId: string,
  paymentId: string,
) {
  const { count } = await tx.payment.updateMany({
    where: { businessId, id: paymentId, status: 'PENDING' },
    data: { status: 'FAILED', failureCode: 'checkout_expired' },
  });
  if (count === 0) return;
  await audit.logIn(
    tx,
    'payment.failed',
    { type: 'payment', id: paymentId },
    { invoiceId, failureCode: 'checkout_expired' },
  );
}
