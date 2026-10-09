import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import Stripe from 'stripe';
import { AuditService } from '../../audit/audit.service.js';
import { DATABASE } from '../../database/database.module.js';
import { InvoiceNotices } from '../invoices/invoice-notices.js';
import { providerUnavailable } from '../checkout/checkout-sessions.js';
import { StripeAccountsWriter, toOnboardingState } from '../stripe/stripe-accounts.js';
import {
  type ConnectedAccount,
  STRIPE_GATEWAY,
  STRIPE_WEBHOOK_SECRET,
  type StripeGateway,
} from '../stripe/stripe-gateway.js';

/** The fields of an event's object Firmivra reads (a Checkout Session or a payment intent). */
interface EventObject {
  id?: string;
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
        ? await this.stripe.paymentFailureCode(accountId, intent).catch(() => null)
        : null;
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
  private async link(ctx: Ctx, object: EventObject) {
    const paymentId = object.metadata?.payment_id;
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
    const paid = await tx.payment.aggregate({
      where: {
        businessId,
        invoiceId: payment.invoiceId,
        status: { in: ['SUCCEEDED', 'REFUNDED'] },
      },
      _sum: { amountCents: true },
    });
    // A payment of an invoice canceled meanwhile is still recorded; the firm refunds it.
    if (invoice.status === 'OPEN' && (paid._sum.amountCents ?? 0) >= invoice.totalCents) {
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
