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
  type ConnectedAccount,
  STRIPE_GATEWAY,
  STRIPE_WEBHOOK_SECRET,
  type StripeGateway,
  type StripeRefund,
} from '../stripe/stripe-gateway.js';

/** The fields of an event's object Firmivra reads (a Checkout Session or a payment intent). */
interface EventObject {
  id?: string;
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
    const accountId = event.account;
    if (!accountId) return;
    const known = await this.database.withScope({ kind: 'platform' }, (tx) =>
      tx.stripeAccount.findUnique({ where: { accountId }, select: { businessId: true } }),
    );
    if (!known) return; // Not a firm's account: acknowledged and ignored.
    const { businessId } = known;
    const object = event.data.object as EventObject;

    // Asked before the transaction: Stripe's reason a bank debit failed.
    let failureCode: string | null = null;
    if (event.type === 'checkout.session.async_payment_failed' && this.stripe) {
      const intent = intentId(object);
      failureCode = intent
        ? await this.stripe
            .retrievePaymentIntent(accountId, intent)
            .then((i) => i.failureCode)
            .catch(() => null)
        : null;
    }

    // charge.refunded: the payment from the charge's payment intent, and the charge's refunds.
    let refund: { paymentId: string | null; refunds: StripeRefund[] } | null = null;
    if (event.type === 'charge.refunded') {
      if (!this.stripe) throw providerUnavailable();
      const stripe = this.stripe;
      const intent = intentId(object);
      const charge = object.id;
      if (intent && charge) {
        const [info, refunds] = await Promise.all([
          stripeCall('paymentIntents.retrieve', event.id, () =>
            stripe.retrievePaymentIntent(accountId, intent),
          ),
          stripeCall('refunds.list', event.id, () => stripe.listRefunds(accountId, { charge })),
        ]);
        refund = { paymentId: info.paymentId, refunds };
      }
    }

    const outcome = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const inserted = await tx.paymentEvent.createMany({
        data: [{ businessId, processorEventId: event.id, accountId, type: event.type }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return null; // A duplicate delivery.
      const row = await tx.paymentEvent.findUniqueOrThrow({
        where: { processor_processorEventId: { processor: 'STRIPE', processorEventId: event.id } },
        select: { id: true },
      });
      const ctx = { tx, businessId, accountId, eventRowId: row.id };
      let paidInvoice: string | null = null;
      switch (event.type) {
        case 'checkout.session.completed':
          paidInvoice =
            object.payment_status === 'paid'
              ? await this.succeed(ctx, object, object.amount_total ?? null)
              : (await this.link(ctx, object), null);
          break;
        case 'payment_intent.succeeded':
          paidInvoice = await this.succeed(ctx, object, object.amount_received ?? null);
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
          if (event.type === 'refund.failed' || object.status === 'failed') {
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
    if (!outcome) return;

    if (event.type === 'account.updated') {
      await this.accounts.updateByAccountId(
        accountId,
        toOnboardingState(event.data.object as unknown as ConnectedAccount),
      );
    }
    if (outcome.paidInvoice) {
      await this.notices.send('payment.received', businessId, outcome.paidInvoice);
    }
  }

  /** This account's payment named in the object's metadata, linked to the event. */
  private link(ctx: Ctx, object: EventObject) {
    return this.linkPayment(ctx, object.metadata?.payment_id ?? null);
  }

  private async linkPayment(ctx: Ctx, paymentId: string | null) {
    if (!paymentId || !UUID.test(paymentId)) return null;
    const payment = await ctx.tx.payment.findFirst({
      where: { businessId: ctx.businessId, id: paymentId, accountId: ctx.accountId },
      select: { id: true, invoiceId: true, amountCents: true, status: true },
    });
    if (!payment) return null;
    await ctx.tx.paymentEvent.update({
      where: { id: ctx.eventRowId },
      data: { paymentId: payment.id },
    });
    return payment;
  }

  /** The payment SUCCEEDED, then its invoice PAID once succeeded payments cover the total. */
  private async succeed(ctx: Ctx, object: EventObject, amount: number | null) {
    const payment = await this.link(ctx, object);
    if (!payment || payment.status !== 'PENDING') return null;
    if (amount !== payment.amountCents) {
      // Never trusted: logged for an alarm, the payment stays as it is.
      this.logger.error(`Amount mismatch on payment ${payment.id}: Stripe ${amount}`);
      return null;
    }
    const { tx, businessId } = ctx;
    await tx.payment.update({
      where: { businessId_id: { businessId, id: payment.id } },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
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
    // A payment of an invoice canceled meanwhile is still recorded; the firm refunds it.
    if (
      invoice.status === 'OPEN' &&
      (await paidCents(tx, payment.invoiceId)) >= invoice.totalCents
    ) {
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
    const payment = await this.link(ctx, object);
    if (!payment || payment.status !== 'PENDING') return;
    await ctx.tx.payment.update({
      where: { businessId_id: { businessId: ctx.businessId, id: payment.id } },
      data: { status: 'FAILED', failureCode: code },
    });
    await this.audit.logIn(
      ctx.tx,
      'payment.failed',
      { type: 'payment', id: payment.id },
      { ...STRIPE, invoiceId: payment.invoiceId, failureCode: code },
      { businessId: ctx.businessId },
    );
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
