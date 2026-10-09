import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { databaseErrorCode, DB_ERRORS, type Database, type TxClient } from '@firmivra/db';
import {
  type Invoice,
  INVOICE_ERRORS,
  type RecordOfflinePaymentRequest,
  type VoidOfflinePaymentRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import type { ClientsActor } from '../../clients/clients.service.js';
import { DATABASE } from '../../database/database.module.js';
import {
  CHECKOUT_LIMITS,
  expireCheckout,
  openCheckouts,
  paymentInProgress,
  providerUnavailable,
} from '../checkout/checkout-sessions.js';
import { InvoiceNotices } from '../invoices/invoice-notices.js';
import {
  conflict,
  firmToday,
  money,
  notFound,
  paidCents,
  processing,
  toDate,
  toInvoice,
} from '../invoices/invoice-view.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { STRIPE_GATEWAY, type StripeGateway } from '../stripe/stripe-gateway.js';

type RecordBody = z.output<typeof RecordOfflinePaymentRequest>;
type VoidBody = z.output<typeof VoidOfflinePaymentRequest>;

const isUniqueViolation = (e: unknown) =>
  (e as { code?: unknown } | null)?.code === 'P2002' || databaseErrorCode(e) === '23505';
/** R0's unique index on (business_id, idempotency_key); also raised by name by the trigger. */
export const KEY_INDEX = 'offline_payments_business_id_idempotency_key_key';

/**
 * The unique index a Prisma error names: the pg adapter puts PostgreSQL's constraint in
 * `meta.driverAdapterError.cause.constraint.index` (its message names it too).
 */
export function violatedIndex(error: unknown): string | undefined {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta;
  const cause = meta?.driverAdapterError?.cause as
    { constraint?: { index?: unknown }; originalMessage?: unknown } | undefined;
  const index = cause?.constraint?.index;
  if (typeof index === 'string') return index;
  const message = cause?.originalMessage;
  return typeof message === 'string' ? /unique constraint "([^"]+)"/.exec(message)?.[1] : undefined;
}

const tooLarge = () => conflict('AMOUNT_TOO_LARGE', INVOICE_ERRORS.AMOUNT_TOO_LARGE);
const duplicateCheck = () =>
  conflict('DUPLICATE_CHECK_NUMBER', INVOICE_ERRORS.DUPLICATE_CHECK_NUMBER);
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });

/** The database's refusals as the contract's answers; anything else as it is. */
function mapped(error: unknown): unknown {
  const code = databaseErrorCode(error);
  if (code === DB_ERRORS.OVER_BALANCE) return tooLarge();
  if (code === DB_ERRORS.PAYMENT_IN_PROGRESS) return paymentInProgress();
  // A demotion that committed first: the member is no longer an Owner or Admin.
  if (code === DB_ERRORS.NOT_FIRM_MANAGER) return forbidden();
  return error;
}

/**
 * Check and cash payments (docs/api/invoices.yaml, "Offline payments"; R0's offline_payments),
 * Owner and Admin. Each runs in the firm's scope as the acting member, whom the database checks
 * and records. The invoice row is locked first, the order every money write on it takes. A
 * recording ends the invoice's open Pay Now checkouts at Stripe first (as cancel does), counts no
 * more than the balance due, and makes the invoice PAID once covered; a void goes only through
 * app_void_offline_payment, which reopens a PAID invoice it no longer covers. Both are audited
 * with ids, the method and the amount (never the note or the reference).
 */
@Injectable()
export class OfflinePaymentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway | null,
    private readonly invoices: InvoicesService,
    private readonly audit: AuditService,
    private readonly notices: InvoiceNotices,
  ) {}

  private inActor<T>(businessId: string, actor: ClientsActor, fn: (tx: TxClient) => Promise<T>) {
    return this.database.withScope(
      { kind: 'business', businessId, actorUserId: actor.userId },
      fn,
      CHECKOUT_LIMITS,
    );
  }

  /** A retry of a payment already recorded: the invoice as it is now. */
  private async replay(businessId: string, actor: ClientsActor, id: string, key: string) {
    return this.inActor(businessId, actor, async (tx) => {
      const known = await tx.offlinePayment.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey: key } },
        select: { invoiceId: true },
      });
      if (known?.invoiceId !== id) throw notFound();
      const row = await this.invoices.load(tx, businessId, actor, id);
      return toInvoice(row, (await firmToday(tx, businessId)).today);
    });
  }

  async record(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: RecordBody,
  ): Promise<Invoice> {
    let recorded = false;
    const invoice = await this.inActor(businessId, actor, async (tx) => {
      const { today } = await firmToday(tx, businessId);
      if (body.receivedOn > today) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'The day received cannot be after today',
        });
      }
      const current = await this.invoices.load(tx, businessId, actor, id, true);
      const known = await tx.offlinePayment.findUnique({
        where: { businessId_idempotencyKey: { businessId, idempotencyKey: body.idempotencyKey } },
        select: { invoiceId: true },
      });
      if (known) {
        if (known.invoiceId !== id) throw notFound();
        return toInvoice(current, today);
      }
      if (current.status !== 'OPEN') throw conflict('NOT_OPEN', INVOICE_ERRORS.NOT_OPEN);
      if (processing(current)) throw paymentInProgress();
      if (body.amountCents > money(current).balanceDueCents) throw tooLarge();
      // One live record of a check number per invoice, any case (offline_payments_one_live_check).
      if (body.method === 'CHECK' && body.reference) {
        const number = body.reference.toUpperCase();
        const live = current.offlinePayments.some(
          (o) =>
            o.method === 'CHECK' && o.voidedAt === null && o.reference?.toUpperCase() === number,
        );
        if (live) throw duplicateCheck();
      }
      // A checkout the client opened and left would let both kinds of money in: end it first.
      if (current.payments.some((p) => p.status === 'PENDING')) {
        if (!this.stripe) throw providerUnavailable();
        for (const open of await openCheckouts(tx, this.stripe, businessId, id)) {
          await expireCheckout(tx, this.stripe, businessId, open);
        }
      }
      const payment = await tx.offlinePayment.create({
        data: {
          businessId,
          invoiceId: id,
          method: body.method,
          amountCents: body.amountCents,
          currency: current.currency,
          reference: body.reference ?? null,
          receivedOn: toDate(body.receivedOn),
          note: body.note ?? null,
          idempotencyKey: body.idempotencyKey,
          recordedByUserId: actor.userId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'invoice.offline_payment_recorded',
        { type: 'invoice', id },
        { offlinePaymentId: payment.id, method: body.method, amountCents: body.amountCents },
      );
      if ((await paidCents(tx, id)) >= current.totalCents) {
        await tx.invoice.update({
          where: { businessId_id: { businessId, id } },
          data: { status: 'PAID', paidAt: new Date() },
        });
        await this.audit.logIn(
          tx,
          'invoice.paid',
          { type: 'invoice', id },
          { totalCents: current.totalCents, offlinePaymentId: payment.id },
        );
      }
      recorded = true;
      return toInvoice(await this.invoices.load(tx, businessId, actor, id), today);
    }).catch(async (error: unknown) => {
      if (isUniqueViolation(error)) {
        // Two first-time requests with one key at once: the second fails on the key; a retry.
        if (violatedIndex(error) === KEY_INDEX) {
          return this.replay(businessId, actor, id, body.idempotencyKey);
        }
        // Any other unique index is the one live check number per invoice.
        throw duplicateCheck();
      }
      throw mapped(error);
    });
    if (recorded) await this.notices.send('payment.received', businessId, id);
    return invoice;
  }

  async void(
    businessId: string,
    actor: ClientsActor,
    id: string,
    offlinePaymentId: string,
    body: VoidBody,
  ): Promise<Invoice> {
    return this.inActor(businessId, actor, async (tx) => {
      const before = await this.invoices.load(tx, businessId, actor, id, true);
      const payment = await tx.offlinePayment.findFirst({
        where: { businessId, id: offlinePaymentId, invoiceId: id },
        select: { voidedAt: true, method: true, amountCents: true },
      });
      if (!payment) throw notFound();
      if (payment.voidedAt) throw conflict('ALREADY_VOIDED', INVOICE_ERRORS.ALREADY_VOIDED);
      await tx.$queryRaw`
        SELECT id FROM app_void_offline_payment(${offlinePaymentId}::uuid, ${body.reason})`;
      const row = await this.invoices.load(tx, businessId, actor, id);
      await this.audit.logIn(
        tx,
        'invoice.offline_payment_voided',
        { type: 'invoice', id },
        {
          offlinePaymentId,
          method: payment.method,
          amountCents: payment.amountCents,
          ...(before.status !== row.status ? { reopened: true } : {}),
        },
      );
      return toInvoice(row, (await firmToday(tx, businessId)).today);
    }).catch((error: unknown) => {
      throw mapped(error);
    });
  }
}
