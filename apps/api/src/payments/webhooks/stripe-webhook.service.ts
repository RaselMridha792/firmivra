import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import Stripe from 'stripe';
import { AuditService } from '../../audit/audit.service.js';
import { DATABASE } from '../../database/database.module.js';
import { InvoiceNotices } from '../invoices/invoice-notices.js';
import { providerUnavailable, stripeCall } from '../checkout/checkout-sessions.js';
import { StripeAccountsWriter, toOnboardingState } from '../stripe/stripe-accounts.js';
import {
  STRIPE_GATEWAY,
  STRIPE_WEBHOOK_SECRET,
  type StripeGateway,
} from '../stripe/stripe-gateway.js';

/** The fields of an event's object Firmivra reads (a Checkout Session or a payment intent). */
interface EventObject {
  id?: string;
  object?: string;
  currency?: string;
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
          ? await stripe.paymentFailureCode(accountId, intent).catch(() => null)
          : null;
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
   * This account's payment named in the object's metadata, but only when the object is that
   * payment's own: a Checkout Session's id is the payment's `processor_ref`, a payment intent was
   * confirmed at Stripe (`confirmed`), and the object's currency (required) is the payment's.
   * Anything else is recorded and changes nothing.
   */
  private async own(ctx: Ctx, object: EventObject, confirmed: boolean) {
    if (!confirmed) return null;
    const payment = await findPayment(ctx.tx, ctx.businessId, ctx.accountId, object);
    if (!payment) return null;
    const isSession = object.object === 'checkout.session';
    if (isSession && object.id !== payment.processorRef) return null;
    if (!object.currency || object.currency.toLowerCase() !== payment.currency) return null;
    return payment;
  }

  /** `own()`, then the event is linked to that payment. */
  private async link(ctx: Ctx, object: EventObject, confirmed: boolean) {
    const payment = await this.own(ctx, object, confirmed);
    if (payment) await this.attach(ctx, payment.id);
    return payment;
  }

  private attach(ctx: Ctx, paymentId: string) {
    return ctx.tx.paymentEvent.update({ where: { id: ctx.eventRowId }, data: { paymentId } });
  }

  /** The payment SUCCEEDED, then its invoice PAID once succeeded payments cover the total. */
  private async succeed(ctx: Ctx, object: EventObject, amount: number | null, confirmed: boolean) {
    const { tx, businessId } = ctx;
    // The payment's own object first, so another session or currency never raises the alarm.
    const payment = await this.own(ctx, object, confirmed);
    if (!payment) return null;
    if (amount !== payment.amountCents) {
      // Never trusted: logged for an alarm; the event is not linked, so nothing shows as paid
      // or processing.
      this.logger.error(`Amount mismatch on payment ${payment.id}: Stripe ${amount}`);
      return null;
    }
    await this.attach(ctx, payment.id);
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
    // The database's PAID rule counts SUCCEEDED payments only.
    const paid = await tx.payment.aggregate({
      where: { businessId, invoiceId: payment.invoiceId, status: 'SUCCEEDED' },
      _sum: { amountCents: true },
    });
    if ((paid._sum.amountCents ?? 0) >= invoice.totalCents) {
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
}

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
