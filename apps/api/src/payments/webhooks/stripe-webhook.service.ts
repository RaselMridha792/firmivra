import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import Stripe from 'stripe';
import { AuditService } from '../../audit/audit.service.js';
import { DATABASE } from '../../database/database.module.js';
import { InvoiceNotices } from '../invoices/invoice-notices.js';
import { paidCents } from '../invoices/invoice-view.js';
import { providerUnavailable, stripeCall } from '../checkout/checkout-sessions.js';
import { StripeAccountsWriter, toOnboardingState } from '../stripe/stripe-accounts.js';
import {
  STRIPE_GATEWAY,
  STRIPE_WEBHOOK_SECRET,
  stripeErrorName,
  type StripeGateway,
  type StripeRefund,
} from '../stripe/stripe-gateway.js';

/** The fields of an event's object Firmivra reads (a Checkout Session or a payment intent). */
interface EventObject {
  id?: string;
  object?: string;
  currency?: string;
  status?: string;
  metadata?: Record<string, string> | null;
  payment_status?: string;
  payment_intent?: string | { id: string } | null;
  amount_total?: number | null;
  amount_received?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE = { actor: 'stripe' };

/**
 * Stripe's Connect webhook (docs/api/invoices.yaml, "Webhook"). Verifies the signature on the raw
 * body, finds the firm from `event.account` in platform scope (read only), then records the event
 * first and acts on it in that firm's business scope, so a duplicate delivery changes nothing and
 * an event from one firm's account never touches another's. `account.updated` goes through the
 * platform-scope writer. Only the event's type and id are kept, never its payload.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger('StripeWebhook');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway | null,
    @Inject(STRIPE_WEBHOOK_SECRET) private readonly secret: string | null,
    private readonly accounts: StripeAccountsWriter,
    private readonly audit: AuditService,
    private readonly notices: InvoiceNotices,
  ) {}

  verify(raw: Buffer | undefined, signature: string | undefined): Stripe.Event {
    if (!this.secret) throw providerUnavailable();
    if (!raw || !signature) throw invalidSignature();
    try {
      return Stripe.webhooks.constructEvent(raw, signature, this.secret);
    } catch {
      throw invalidSignature();
    }
  }

  async handle(event: Stripe.Event): Promise<void> {
    // Without a key nothing can be checked at Stripe: 503, and Stripe delivers it again later.
    if (!this.stripe) throw providerUnavailable();
    const stripe = this.stripe;
    if (event.livemode !== stripe.livemode) {
      // A test event at a live endpoint (or the reverse) is never acted on.
      this.logger.warn(`Ignored ${event.id}: livemode does not match the key`);
      return;
    }
    const accountId = event.account;
    if (!accountId) return;
    const known = await this.database.withScope({ kind: 'platform' }, (tx) =>
      tx.stripeAccount.findUnique({ where: { accountId }, select: { businessId: true } }),
    );
    if (!known) return; // Not a firm's account: acknowledged and ignored.
    const { businessId } = known;
    const inFirm = <T>(fn: (tx: TxClient) => Promise<T>) =>
      this.database.withScope({ kind: 'business', businessId }, fn);
    const where = {
      processor_processorEventId: { processor: 'STRIPE' as const, processorEventId: event.id },
    };
    // A duplicate delivery asks Stripe nothing.
    if (await inFirm((tx) => tx.paymentEvent.findUnique({ where, select: { id: true } }))) return;
    const object = event.data.object as EventObject;

    // Stripe's answers are asked before the event is recorded, so a failure is 503 and the
    // event comes again (a recorded event is never acted on twice).
    let failureCode: string | null = null;
    let intentConfirmed = false;
    let refund: { paymentId: string | null; refunds: StripeRefund[] } | null = null;
    switch (event.type) {
      case 'account.updated': {
        // Stripe's current state of the account, not the event's (events can arrive out of order).
        const account = await stripeCall('accounts.retrieve', accountId, () =>
          stripe.retrieveAccount(accountId),
        );
        await this.accounts.updateByAccountId(accountId, toOnboardingState(account));
        break;
      }
      case 'checkout.session.async_payment_failed': {
        const intent = intentId(object);
        failureCode = intent
          ? await stripe
              .retrievePaymentIntent(accountId, intent)
              .then((i) => i.failureCode)
              .catch(() => null)
          : null;
        break;
      }
      case 'charge.refunded': {
        // The payment from the charge's payment intent, and the charge's refunds.
        const intent = intentId(object);
        const charge = object.id;
        if (intent && charge) {
          const found = await Promise.all([
            stripe.retrievePaymentIntent(accountId, intent),
            stripe.listRefunds(accountId, { charge }),
          ]).catch((error: unknown) => {
            const name = stripeErrorName(error);
            // Not this account's payment intent: recorded and ignored.
            if (name.endsWith(':resource_missing')) return null;
            this.logger.warn(`Stripe refund lookup failed for ${event.id}: ${name}`);
            throw providerUnavailable();
          });
          if (!found) break;
          const [info, refunds] = found;
          refund = { paymentId: info.paymentId, refunds };
        }
        break;
      }
      case 'payment_intent.succeeded': {
        // The intent must be the one Stripe made for this payment's own session.
        const payment = await inFirm((tx) => findPayment(tx, businessId, accountId, object));
        if (payment?.status === 'PENDING' && object.id) {
          const session = await stripeCall('checkout.sessions.retrieve', payment.id, () =>
            stripe.retrieveCheckoutSession(accountId, payment.processorRef),
          );
          intentConfirmed = session.paymentIntentId === object.id;
        }
        break;
      }
      default:
        break;
    }

    const outcome = await inFirm(async (tx) => {
      const inserted = await tx.paymentEvent.createMany({
        data: [{ businessId, processorEventId: event.id, accountId, type: event.type }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return null; // A duplicate delivery at the same moment.
      const row = await tx.paymentEvent.findUniqueOrThrow({ where, select: { id: true } });
      const ctx = { tx, businessId, accountId, eventRowId: row.id };
      let paidInvoice: string | null = null;
      switch (event.type) {
        case 'checkout.session.completed':
          paidInvoice =
            object.payment_status === 'paid'
              ? await this.succeed(ctx, object, object.amount_total ?? null, true)
              : (await this.link(ctx, object, true), null);
          break;
        case 'payment_intent.succeeded':
          paidInvoice = await this.succeed(
            ctx,
            object,
            object.amount_received ?? null,
            intentConfirmed,
          );
          break;
        case 'checkout.session.async_payment_failed':
          await this.fail(ctx, object, sanitize(failureCode) ?? 'payment_failed');
          break;
        case 'checkout.session.expired':
          await this.fail(ctx, object, 'checkout_expired');
          break;
        case 'charge.refunded':
          if (refund) await this.confirmRefund(ctx, refund.paymentId, refund.refunds);
          break;
        case 'refund.failed':
        case 'refund.updated':
          // A refund canceled at Stripe is as good as failed: its cents are refundable again.
          if (event.type === 'refund.failed' || SETTLED_AT_STRIPE.has(object.status ?? '')) {
            await this.refundFailed(ctx, object.id ?? '');
          }
          break;
        default:
          // payment_intent.payment_failed changes nothing: the client may try another card in the
          // same session. Other types are recorded and ignored.
          break;
      }
      await tx.paymentEvent.update({ where: { id: row.id }, data: { processedAt: new Date() } });
      return { paidInvoice };
    });
    if (outcome?.paidInvoice) {
      await this.notices.send('payment.received', businessId, outcome.paidInvoice);
    }
  }

  /**
   * This account's payment named in the object's metadata, linked to the event, but only when the
   * object is that payment's own: a Checkout Session's id is the payment's `processor_ref`
   * a payment intent was confirmed at Stripe (`confirmed`), and the currency is
   * the payment's. Anything else is recorded and changes nothing.
   */
  private async link(ctx: Ctx, object: EventObject, confirmed: boolean) {
    if (!confirmed) return null;
    const payment = await findPayment(ctx.tx, ctx.businessId, ctx.accountId, object);
    if (!payment) return null;
    const isSession = object.object === 'checkout.session';
    if (isSession && object.id !== payment.processorRef) return null;
    if (object.currency && object.currency.toLowerCase() !== payment.currency) return null;
    await ctx.tx.paymentEvent.update({
      where: { id: ctx.eventRowId },
      data: { paymentId: payment.id },
    });
    return payment;
  }

  /** The payment SUCCEEDED, then its invoice PAID once succeeded payments cover the total. */
  private async succeed(ctx: Ctx, object: EventObject, amount: number | null, confirmed: boolean) {
    const { tx, businessId } = ctx;
    const named = confirmed ? await findPayment(tx, businessId, ctx.accountId, object) : null;
    if (named && amount !== named.amountCents) {
      // Never trusted: logged for an alarm; the event is not linked, so nothing shows as paid
      // or processing.
      this.logger.error(`Amount mismatch on payment ${named.id}: Stripe ${amount}`);
      return null;
    }
    const payment = await this.link(ctx, object, confirmed);
    if (!payment) return null;
    // Both success events of one payment can arrive at once: only one moves it from PENDING.
    const { count } = await tx.payment.updateMany({
      where: { businessId, id: payment.id, status: 'PENDING' },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    if (count === 0) return null;
    await this.audit.logIn(
      tx,
      'payment.succeeded',
      { type: 'payment', id: payment.id },
      { ...STRIPE, invoiceId: payment.invoiceId, amountCents: payment.amountCents },
      { businessId },
    );
    const invoice = await tx.invoice.findFirstOrThrow({
      where: { businessId, id: payment.invoiceId },
      select: { status: true, totalCents: true },
    });
    // A payment of an invoice canceled meanwhile is still recorded (the firm refunds it), and the
    // client is not told it was received.
    if (invoice.status !== 'OPEN') return null;
    // The database's PAID rule: app_invoice_paid_cents (Stripe and live offline payments).
    if ((await paidCents(tx, payment.invoiceId)) >= invoice.totalCents) {
      await tx.invoice.update({
        where: { businessId_id: { businessId, id: payment.invoiceId } },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await this.audit.logIn(
        tx,
        'invoice.paid',
        { type: 'invoice', id: payment.invoiceId },
        { ...STRIPE, totalCents: invoice.totalCents },
        { businessId },
      );
    }
    return payment.invoiceId;
  }

  private async fail(ctx: Ctx, object: EventObject, code: string) {
    const payment = await this.link(ctx, object, true);
    if (!payment) return;
    const { count } = await ctx.tx.payment.updateMany({
      where: { businessId: ctx.businessId, id: payment.id, status: 'PENDING' },
      data: { status: 'FAILED', failureCode: code },
    });
    if (count === 0) return; // Already SUCCEEDED or FAILED: final.
    await this.audit.logIn(
      ctx.tx,
      'payment.failed',
      { type: 'payment', id: payment.id },
      { ...STRIPE, invoiceId: payment.invoiceId, failureCode: code },
      { businessId: ctx.businessId },
    );
  }

  /** This account's payment by id, linked to the event (refund events name no session). */
  private async linkPayment(ctx: Ctx, paymentId: string | null) {
    const payment = await findPayment(ctx.tx, ctx.businessId, ctx.accountId, {
      metadata: paymentId ? { payment_id: paymentId } : null,
    });
    if (!payment) return null;
    await ctx.tx.paymentEvent.update({
      where: { id: ctx.eventRowId },
      data: { paymentId: payment.id },
    });
    return payment;
  }

  /**
   * One charge.refunded confirms one refund: the oldest of the charge's refunds that Stripe has
   * not failed or canceled and that has no SUCCEEDED or FAILED row here. Its PENDING row (made by
   * Firmivra) becomes SUCCEEDED; with no row (made in the firm's Stripe dashboard) it is inserted
   * SUCCEEDED. The database marks the payment REFUNDED once confirmed refunds cover it.
   */
  private async confirmRefund(ctx: Ctx, paymentId: string | null, refunds: StripeRefund[]) {
    const payment = await this.linkPayment(ctx, paymentId);
    if (!payment) return;
    const { tx, businessId } = ctx;
    const live = refunds.filter((r) => !SETTLED_AT_STRIPE.has(r.status));
    const rows = await tx.paymentRefund.findMany({
      where: { businessId, processorRefundId: { in: live.map((r) => r.id) } },
    });
    const byId = new Map(rows.map((r) => [r.processorRefundId, r]));
    const next = live.find((r) => {
      const row = byId.get(r.id);
      return !row || row.status === 'PENDING';
    });
    if (!next) return; // Nothing left to confirm: recorded and ignored.
    const confirmed = {
      status: 'SUCCEEDED' as const,
      eventId: ctx.eventRowId,
      refundedAt: new Date(),
    };
    const row = byId.get(next.id);
    if (row) {
      await tx.paymentRefund.update({ where: { id: row.id }, data: confirmed });
    } else {
      const full = await tx.payment.findUniqueOrThrow({
        where: { businessId_id: { businessId, id: payment.id } },
        select: { currency: true },
      });
      await tx.paymentRefund.create({
        data: {
          businessId,
          paymentId: payment.id,
          processorRefundId: next.id,
          accountId: ctx.accountId,
          amountCents: next.amountCents,
          currency: full.currency,
          ...confirmed,
        },
      });
    }
    await this.audit.logIn(
      tx,
      'payment.refunded',
      { type: 'payment', id: payment.id },
      { ...STRIPE, invoiceId: payment.invoiceId, amountCents: next.amountCents },
      { businessId },
    );
  }

  /** A PENDING refund that failed at Stripe: its cents are refundable again. */
  private async refundFailed(ctx: Ctx, refundId: string) {
    const { tx, businessId } = ctx;
    const row = await tx.paymentRefund.findFirst({
      where: { businessId, processorRefundId: refundId, accountId: ctx.accountId },
    });
    if (!row) return; // Never counted: ignored.
    await this.linkPayment(ctx, row.paymentId);
    if (row.status === 'SUCCEEDED') {
      this.logger.error(`Stripe failed refund ${row.id}, already confirmed here`);
      return;
    }
    if (row.status !== 'PENDING') return;
    await tx.paymentRefund.update({ where: { id: row.id }, data: { status: 'FAILED' } });
    await this.audit.logIn(
      tx,
      'payment.refund_failed',
      { type: 'payment', id: row.paymentId },
      { ...STRIPE, amountCents: row.amountCents },
      { businessId },
    );
  }
}

const SETTLED_AT_STRIPE = new Set(['failed', 'canceled']);

/** The payment named in the object's metadata, on this firm's account. */
function findPayment(tx: TxClient, businessId: string, accountId: string, object: EventObject) {
  const paymentId = object.metadata?.payment_id;
  if (!paymentId || !UUID.test(paymentId)) return Promise.resolve(null);
  return tx.payment.findFirst({
    where: { businessId, id: paymentId, accountId },
    select: {
      id: true,
      invoiceId: true,
      amountCents: true,
      currency: true,
      status: true,
      processorRef: true,
    },
  });
}

interface Ctx {
  tx: TxClient;
  businessId: string;
  accountId: string;
  eventRowId: string;
}

const invalidSignature = () =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid Stripe signature' });
const intentId = (o: EventObject) =>
  typeof o.payment_intent === 'string' ? o.payment_intent : (o.payment_intent?.id ?? null);
/** The database takes `^[a-z0-9_]{1,64}$`. */
const sanitize = (code: string | null) => (code && /^[a-z0-9_]{1,64}$/.test(code) ? code : null);
