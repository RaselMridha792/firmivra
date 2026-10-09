import { Inject, Injectable } from '@nestjs/common';
import { INVOICE_ERRORS } from '@firmivra/types';
import { databaseErrorCode, type Database, type Prisma, type TxClient } from '@firmivra/db';
import type {
  CancelInvoiceRequest,
  CreateInvoiceRequest,
  Invoice,
  InvoiceList,
  ListInvoicesQuery,
  UpdateInvoiceRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../../audit/audit.service.js';
import {
  type ClientsActor,
  decodeCursor,
  encodeCursor,
  likeEscape,
} from '../../clients/clients.service.js';
import { DATABASE } from '../../database/database.module.js';
import {
  CHECKOUT_LIMITS,
  expireCheckout,
  openCheckouts,
  paymentInProgress,
  providerUnavailable,
} from '../checkout/checkout-sessions.js';
import { STRIPE_GATEWAY, type StripeGateway } from '../stripe/stripe-gateway.js';
import { InvoiceNotices } from './invoice-notices.js';
import {
  conflict,
  day,
  firmToday,
  holdsMoney,
  type InvoiceRow,
  invoiceSelect,
  notFound,
  paymentsEnabled,
  processing,
  toDate,
  toInvoice,
  toListItem,
} from './invoice-view.js';

type ListQuery = z.output<typeof ListInvoicesQuery>;
type CreateBody = z.output<typeof CreateInvoiceRequest>;
type DraftBody = z.output<typeof UpdateInvoiceRequest>;

export const archived = () => conflict('CLIENT_ARCHIVED', 'Restore the client first');
export const notDraft = () => conflict('NOT_DRAFT', 'Only a draft can be changed');
const isUniqueViolation = (e: unknown) =>
  (e as { code?: unknown } | null)?.code === 'P2002' || databaseErrorCode(e) === '23505';

/**
 * The firm's invoices (R7 step 7; contract in packages/types/src/payments). Owner and Admin reach
 * every invoice; Staff only read those of clients assigned to them (others 404) and the routes
 * refuse them every change. The database computes line amounts, subtotal and total and keeps the
 * lifecycle; every change runs in one transaction with its audit row; reads are audited after.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notices: InvoiceNotices,
    @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway | null,
  ) {}

  inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private reach(actor: ClientsActor): Prisma.ClientWhereInput {
    return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
  }

  /** The invoice, if its client is in reach; `lock` takes its row (FOR UPDATE) first. */
  async load(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    lock = false,
  ): Promise<InvoiceRow> {
    if (lock) {
      await tx.$queryRaw`
        SELECT 1 FROM invoices WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    const row = await tx.invoice.findFirst({
      where: { businessId, id, client: this.reach(actor) },
      select: invoiceSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  async list(businessId: string, actor: ClientsActor, q: ListQuery): Promise<InvoiceList> {
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const term = q.search ? likeEscape(q.search) : undefined;
    const list = await this.inFirm(businessId, async (tx) => {
      if (q.clientId) {
        const client = await tx.client.findFirst({
          where: { AND: [{ businessId, id: q.clientId }, this.reach(actor)] },
          select: { id: true },
        });
        if (!client) throw notFound();
      }
      const where: Prisma.InvoiceWhereInput = {
        AND: [
          { businessId, client: this.reach(actor) },
          q.clientId ? { clientId: q.clientId } : {},
          q.status ? { status: q.status } : {},
          term
            ? {
                OR: [
                  { number: { contains: term, mode: 'insensitive' } },
                  { client: { displayName: { contains: term, mode: 'insensitive' } } },
                ],
              }
            : {},
          after
            ? {
                OR: [
                  { createdAt: { lt: after.createdAt } },
                  { createdAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {},
        ],
      };
      const rows = await tx.invoice.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: invoiceSelect,
      });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      const { today } = await firmToday(tx, businessId);
      return {
        items: page.map((row) => toListItem(row, today)),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
        paymentsEnabled: await paymentsEnabled(tx, businessId),
      };
    });
    // Reads of client data are audited too (CLAUDE.md rule 8), as clients and engagements are.
    await this.audit.log(
      'invoices.listed',
      { type: 'invoice' },
      { count: list.items.length, ...(q.clientId ? { clientId: q.clientId } : {}) },
    );
    return list;
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<Invoice> {
    const invoice = await this.inFirm(businessId, async (tx) => {
      const row = await this.load(tx, businessId, actor, id);
      return toInvoice(row, (await firmToday(tx, businessId)).today);
    });
    await this.audit.log(
      'invoice.viewed',
      { type: 'invoice', id },
      { clientId: invoice.client.id },
    );
    return invoice;
  }

  /** The client (404) and the service (one of this client's, 404); true when it is archived. */
  private async checkClient(
    tx: TxClient,
    businessId: string,
    clientId: string,
    engagementId: string | null | undefined,
  ): Promise<boolean> {
    await tx.$queryRaw`
      SELECT 1 FROM clients WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid FOR SHARE`;
    const client = await tx.client.findFirst({
      where: { businessId, id: clientId },
      select: { archivedAt: true },
    });
    if (!client) throw notFound();
    if (engagementId) {
      const service = await tx.engagement.findFirst({
        where: { businessId, clientId, id: engagementId },
        select: { id: true },
      });
      if (!service) throw notFound();
    }
    return client.archivedAt !== null;
  }

  /**
   * Writes a draft's fields and lines. The discount goes on last, after the lines made the
   * subtotal, so the database's `total = subtotal - discount >= 0` holds after every statement.
   */
  private async writeDraft(tx: TxClient, businessId: string, id: string, body: DraftBody) {
    const where = { businessId_id: { businessId, id } };
    await tx.invoice.update({ where, data: { discountCents: 0 } });
    await tx.invoiceLine.deleteMany({ where: { businessId, invoiceId: id } });
    await tx.invoiceLine.createMany({
      data: body.lines.map((l, i) => ({
        businessId,
        invoiceId: id,
        description: l.description,
        quantity: l.quantity,
        unitAmountCents: l.unitAmountCents,
        sortOrder: i,
      })),
    });
    await tx.invoice.update({
      where,
      data: {
        engagementId: body.engagementId ?? null,
        discountCents: body.discountCents,
        dueOn: toDate(body.dueOn),
        scheduledFor: body.scheduledFor ? toDate(body.scheduledFor) : null,
      },
    });
  }

  /** `INV-{year}-{4 digits}`: the next in the firm for the firm's calendar year. */
  private async nextNumber(tx: TxClient, businessId: string): Promise<string> {
    const year = (await firmToday(tx, businessId)).today.slice(0, 4);
    const [row] = await tx.$queryRaw<{ n: number | null }[]>`
      SELECT max(substring(number from '^INV-[0-9]{4}-([0-9]+)$')::int) AS n
        FROM invoices WHERE business_id = ${businessId}::uuid AND number LIKE ${`INV-${year}-%`}`;
    return `INV-${year}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
  }

  async create(businessId: string, actor: ClientsActor, body: CreateBody): Promise<Invoice> {
    const attempt = () =>
      this.inFirm(businessId, async (tx) => {
        if (await this.checkClient(tx, businessId, body.clientId, body.engagementId)) {
          throw archived();
        }
        const { id } = await tx.invoice.create({
          data: {
            businessId,
            clientId: body.clientId,
            number: await this.nextNumber(tx, businessId),
            createdByUserId: actor.userId,
          },
          select: { id: true },
        });
        await this.writeDraft(tx, businessId, id, body);
        const row = await this.load(tx, businessId, actor, id);
        await this.audit.logIn(
          tx,
          'invoice.created',
          { type: 'invoice', id },
          {
            clientId: body.clientId,
            number: row.number,
            totalCents: row.totalCents,
            lines: row.lines.length,
          },
        );
        return toInvoice(row, (await firmToday(tx, businessId)).today);
      });
    // Two creates at once can pick the same number: the unique index refuses one; it tries again.
    return attempt().catch((e: unknown) => {
      if (isUniqueViolation(e)) return attempt();
      throw e;
    });
  }

  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: DraftBody,
  ): Promise<Invoice> {
    return this.inFirm(businessId, async (tx) => {
      const current = await this.load(tx, businessId, actor, id, true);
      const isArchived = await this.checkClient(
        tx,
        businessId,
        current.clientId,
        body.engagementId,
      );
      if (current.status !== 'DRAFT') throw notDraft();
      if (isArchived) throw archived();
      await this.writeDraft(tx, businessId, id, body);
      const row = await this.load(tx, businessId, actor, id);
      await this.audit.logIn(
        tx,
        'invoice.updated',
        { type: 'invoice', id },
        { clientId: row.clientId, totalCents: row.totalCents, lines: row.lines.length },
      );
      return toInvoice(row, (await firmToday(tx, businessId)).today);
    });
  }

  /**
   * A draft goes to the client: SCHEDULED when its scheduled day is after the firm's today (the
   * daily job opens it then), otherwise OPEN now with `scheduled_for` cleared. Opening sends
   * `invoice.sent` to the client after the change commits.
   */
  async send(businessId: string, actor: ClientsActor, id: string): Promise<Invoice> {
    const { invoice, opened } = await this.inFirm(businessId, async (tx) => {
      const current = await this.load(tx, businessId, actor, id, true);
      const isArchived = await this.checkClient(tx, businessId, current.clientId, null);
      if (current.status !== 'DRAFT') throw notDraft();
      if (isArchived) throw archived();
      if (current.totalCents === 0) {
        throw conflict('ZERO_TOTAL', 'There is nothing to pay on this invoice');
      }
      const { today } = await firmToday(tx, businessId);
      const scheduledFor = day(current.scheduledFor);
      const later = scheduledFor !== null && scheduledFor > today;
      const dueOn = day(current.dueOn);
      if (!later && dueOn !== null && dueOn < today) {
        throw conflict('DUE_DATE_PASSED', 'The due date has passed; change it first');
      }
      await tx.invoice.update({
        where: { businessId_id: { businessId, id } },
        data: later
          ? { status: 'SCHEDULED' }
          : { status: 'OPEN', issuedAt: new Date(), scheduledFor: null },
      });
      const row = await this.load(tx, businessId, actor, id);
      await this.audit.logIn(
        tx,
        later ? 'invoice.scheduled' : 'invoice.sent',
        { type: 'invoice', id },
        { clientId: row.clientId, number: row.number, totalCents: row.totalCents },
      );
      return { invoice: toInvoice(row, today), opened: !later };
    });
    if (opened) await this.notices.send('invoice.sent', businessId, id, actor.userId);
    return invoice;
  }

  /**
   * Cancels a draft, scheduled or open invoice. Its open Checkout Sessions are expired at Stripe
   * first, so nobody can pay it afterwards; a payment Stripe is still settling is 409. A canceled
   * draft loses `scheduled_for` (the portal never shows it); a canceled SCHEDULED one keeps it.
   */
  async cancel(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: z.output<typeof CancelInvoiceRequest>,
  ): Promise<Invoice> {
    return this.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        const current = await this.load(tx, businessId, actor, id, true);
        if (current.status === 'PAID' || current.status === 'CANCELED') {
          throw conflict('INVOICE_CLOSED', INVOICE_ERRORS.INVOICE_CLOSED);
        }
        if (processing(current)) throw paymentInProgress();
        if (holdsMoney(current)) throw conflict('HAS_PAYMENTS', INVOICE_ERRORS.HAS_PAYMENTS);
        const unsettled = current.payments.some((p) => p.status === 'PENDING');
        if (unsettled) {
          if (!this.stripe) throw providerUnavailable();
          for (const open of await openCheckouts(tx, this.stripe, businessId, id)) {
            await expireCheckout(tx, this.stripe, businessId, open);
          }
        }
        await tx.invoice.update({
          where: { businessId_id: { businessId, id } },
          data: {
            status: 'CANCELED',
            canceledAt: new Date(),
            cancelReason: body.reason,
            ...(current.status === 'DRAFT' ? { scheduledFor: null } : {}),
          },
        });
        const row = await this.load(tx, businessId, actor, id);
        await this.audit.logIn(
          tx,
          'invoice.canceled',
          { type: 'invoice', id },
          { fromStatus: current.status, totalCents: row.totalCents },
        );
        return toInvoice(row, (await firmToday(tx, businessId)).today);
      },
      CHECKOUT_LIMITS,
    );
  }
}
