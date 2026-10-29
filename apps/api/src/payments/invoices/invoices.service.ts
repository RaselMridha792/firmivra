import { randomUUID } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { INVOICE_ERRORS, PaymentMethodKey, STANDARD_PAYMENT_TERMS } from '@firmivra/types';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AddInvoiceHistoryRequest,
  CancelInvoiceRequest,
  CorrectInvoiceRequest,
  CreateInvoiceRequest,
  Invoice,
  InvoiceHistory,
  InvoiceHistoryItem,
  InvoiceList,
  InvoicePdfLink,
  ListInvoicesQuery,
  PaymentMethodsSummary,
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
import { isUniqueViolation } from '../../workspaces/common.js';
import {
  CHECKOUT_LIMITS,
  expireCheckout,
  lockInvoice,
  oneAtATime,
  openCheckouts,
  paymentInProgress,
  providerUnavailable,
  withStripeHold,
} from '../checkout/checkout-sessions.js';
import { STRIPE_GATEWAY, type StripeGateway } from '../stripe/stripe-gateway.js';
import { REPORT_FILES, type ReportFiles } from '../../reports/report-files.js';
import { InvoiceNotices } from './invoice-notices.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import { endDraftRecurrence, startRecurrence, syncDraftRecurrence } from './invoice-recurrence.js';
import {
  conflict,
  dateIn,
  day,
  firmToday,
  holdsMoney,
  type InvoiceRow,
  invoiceSelect,
  money,
  notFound,
  paymentsEnabled,
  processing,
  toDate,
  dispatchTimes,
  invoiceOf,
  toListItem,
} from './invoice-view.js';

type ListQuery = z.output<typeof ListInvoicesQuery>;
type CreateBody = z.output<typeof CreateInvoiceRequest>;
type DraftBody = z.output<typeof UpdateInvoiceRequest>;

export const archived = () => conflict('CLIENT_ARCHIVED', 'Restore the client first');
export const notDraft = () => conflict('NOT_DRAFT', 'Only a draft can be changed');

const DAY = 86_400_000;

const historySelect = {
  id: true,
  type: true,
  body: true,
  createdAt: true,
  actor: { select: { userId: true, user: { select: { name: true } } } },
} as const;
const toHistoryItem = (r: {
  id: string;
  type: string;
  body: string | null;
  createdAt: Date;
  actor: { userId: string; user: { name: string } } | null;
}): InvoiceHistoryItem => ({
  id: r.id,
  type: r.type,
  body: r.body,
  actor: r.actor ? { userId: r.actor.userId, name: r.actor.user.name } : null,
  createdAt: r.createdAt.toISOString(),
});

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
    @Inject(REPORT_FILES) private readonly files: ReportFiles,
  ) {}

  inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private reach(actor: ClientsActor): Prisma.ClientWhereInput {
    return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
  }

  /** The invoice, if its client is in reach. */
  async load(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<InvoiceRow> {
    const row = await tx.invoice.findFirst({
      where: { businessId, id, client: this.reach(actor) },
      select: invoiceSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  /**
   * A draft in reach, its row held. A sent invoice is 409 NOT_DRAFT before any lock, so editing
   * one never waits behind a Pay Now; the row is then taken (briefly, as Pay Now does) and read
   * again. Another client's `engagementId` is 404 first, as the contract orders it.
   */
  private async loadDraft(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    engagementId?: string | null,
  ): Promise<InvoiceRow> {
    const first = await this.load(tx, businessId, actor, id);
    await this.checkEngagement(tx, businessId, first.clientId, engagementId);
    if (first.status !== 'DRAFT') throw notDraft();
    await lockInvoice(tx, businessId, id);
    const current = await this.load(tx, businessId, actor, id);
    if (current.status !== 'DRAFT') throw notDraft();
    return current;
  }

  /** IP-F08: what the editor may change: a draft, or a scheduled invoice not yet sent. */
  private async loadEditable(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    engagementId?: string | null,
  ): Promise<InvoiceRow> {
    const editable = (s: string) => s === 'DRAFT' || s === 'SCHEDULED';
    const first = await this.load(tx, businessId, actor, id);
    await this.checkEngagement(tx, businessId, first.clientId, engagementId);
    if (!editable(first.status)) throw notDraft();
    await lockInvoice(tx, businessId, id);
    const current = await this.load(tx, businessId, actor, id);
    if (!editable(current.status)) throw notDraft();
    return current;
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
      const sent = await dispatchTimes(
        tx,
        businessId,
        page.map((row) => row.id),
      );
      return {
        items: page.map((row) => toListItem(row, today, sent.get(row.id) ?? null)),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
        paymentsEnabled: await paymentsEnabled(tx, businessId),
        today,
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

  /**
   * IP-F20 (Octavia, Oct 27): the money collected in the range by method, on the firm's calendar.
   * Stripe payments count once their webhook confirmed them, less their confirmed refunds; recorded
   * payments count unless voided. Staff see only their clients' money.
   */
  async paymentMethods(
    businessId: string,
    actor: ClientsActor,
    q: { from?: string | undefined; to?: string | undefined },
  ): Promise<PaymentMethodsSummary> {
    const summary = await this.inFirm(businessId, async (tx) => {
      const { timeZone, today } = await firmToday(tx, businessId);
      const from = q.from ?? `${today.slice(0, 4)}-01-01`;
      const to = q.to ?? today;
      const reach = { client: this.reach(actor) };
      const widen = (d: string, days: number) =>
        new Date(Date.parse(`${d}T00:00:00Z`) + days * DAY);
      const online = await tx.payment.findMany({
        where: {
          businessId,
          status: { in: ['SUCCEEDED', 'REFUNDED'] },
          paidAt: { gte: widen(from, -1), lt: widen(to, 2) },
          invoice: reach,
        },
        select: {
          amountCents: true,
          methodType: true,
          paidAt: true,
          refunds: { where: { status: 'SUCCEEDED' }, select: { amountCents: true } },
        },
      });
      const recorded = await tx.offlinePayment.findMany({
        where: {
          businessId,
          voidedAt: null,
          receivedOn: { gte: toDate(from), lte: toDate(to) },
          invoice: reach,
        },
        select: { amountCents: true, method: true },
      });
      const totals = new Map<PaymentMethodKey, { amountCents: number; count: number }>();
      const add = (method: PaymentMethodKey, cents: number) => {
        if (cents <= 0) return;
        const t = totals.get(method) ?? { amountCents: 0, count: 0 };
        totals.set(method, { amountCents: t.amountCents + cents, count: t.count + 1 });
      };
      for (const p of online) {
        const onDay = p.paidAt ? dateIn(timeZone, p.paidAt) : null;
        if (!onDay || onDay < from || onDay > to) continue;
        const refunded = p.refunds.reduce((s, r) => s + r.amountCents, 0);
        add(
          p.methodType === 'card' ? 'CARD' : p.methodType === 'us_bank_account' ? 'ACH' : 'OTHER',
          p.amountCents - refunded,
        );
      }
      for (const p of recorded) add(p.method, p.amountCents);
      const items = PaymentMethodKey.options
        .filter((m) => totals.has(m))
        .map((method) => ({ method, ...totals.get(method)! }));
      return {
        from,
        to,
        items,
        totalCents: items.reduce((s, i) => s + i.amountCents, 0),
      };
    });
    await this.audit.log(
      'invoices.payment_methods.viewed',
      { type: 'invoice' },
      { from: summary.from, to: summary.to, methods: summary.items.length },
    );
    return summary;
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<Invoice> {
    const invoice = await this.inFirm(businessId, async (tx) => {
      const row = await this.load(tx, businessId, actor, id);
      return await invoiceOf(tx, businessId, row, (await firmToday(tx, businessId)).today);
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
    await this.checkEngagement(tx, businessId, clientId, engagementId);
    return client.archivedAt !== null;
  }

  /** `engagementId`, when given, must be one of this client's services (404 otherwise). */
  private async checkEngagement(
    tx: TxClient,
    businessId: string,
    clientId: string,
    engagementId: string | null | undefined,
  ): Promise<void> {
    if (!engagementId) return;
    const service = await tx.engagement.findFirst({
      where: { businessId, clientId, id: engagementId },
      select: { id: true },
    });
    if (!service) throw notFound();
  }

  /**
   * Writes a draft's fields and lines. The discount goes on last, after the lines made the
   * subtotal, so the database's `total = subtotal - discount >= 0` holds after every statement.
   */
  private async writeDraft(tx: TxClient, businessId: string, id: string, body: DraftBody) {
    const where = { businessId_id: { businessId, id } };
    await this.checkTerms(tx, businessId, id, body.paymentTerms ?? null);
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
        paymentTerms: body.paymentTerms ?? null,
        notesToClient: body.notesToClient ?? null,
        internalNote: body.internalNote ?? null,
      },
    });
  }

  /** IP-F05: the draft's schedule follows its Recurring settings (see invoice-recurrence.ts). */
  private async writeRecurrence(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: DraftBody,
  ) {
    const row = await this.load(tx, businessId, actor, id);
    const { today } = await firmToday(tx, businessId);
    await syncDraftRecurrence(tx, this.audit, businessId, actor.userId, row, body.recurring, today);
  }

  /**
   * Terms a firm's own list (`custom_term_days`) no longer has are 409 TERMS_NOT_OFFERED, except
   * the ones the draft already carries.
   */
  private async checkTerms(tx: TxClient, businessId: string, id: string, terms: string | null) {
    if (terms === null || (STANDARD_PAYMENT_TERMS as readonly string[]).includes(terms)) return;
    const settings = await tx.paymentSettings.findUnique({
      where: { businessId },
      select: { customTermDays: true },
    });
    const draft = await tx.invoice.findUnique({
      where: { businessId_id: { businessId, id } },
      select: { paymentTerms: true },
    });
    const own = (settings?.customTermDays ?? []).map((d) => `net_${d}`);
    if (!own.includes(terms) && draft?.paymentTerms !== terms) {
      throw conflict('TERMS_NOT_OFFERED', INVOICE_ERRORS.TERMS_NOT_OFFERED);
    }
  }

  /**
   * `INV-{year}-{4 digits}`: the next in the firm for the firm's calendar year. Creates in one
   * firm take their numbers one at a time (a transaction-scoped advisory lock), so two at once
   * never pick the same one.
   */
  private async nextNumber(tx: TxClient, businessId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice-number:${businessId}`}, 0))`;
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
        await this.writeRecurrence(tx, businessId, actor, id, body);
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
        return await invoiceOf(tx, businessId, row, (await firmToday(tx, businessId)).today);
      });
    // A number someone else took anyway (a create outside this service) is tried once more.
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
      const current = await this.loadEditable(tx, businessId, actor, id, body.engagementId);
      if (await this.checkClient(tx, businessId, current.clientId, body.engagementId)) {
        throw archived();
      }
      // IP-F08: a scheduled invoice stays scheduled, so its send day stays after today.
      if (current.status === 'SCHEDULED') {
        const { today } = await firmToday(tx, businessId);
        if (!body.scheduledFor || body.scheduledFor <= today) {
          throw conflict('SCHEDULE_PASSED', 'Choose a send day after today');
        }
      }
      await this.writeDraft(tx, businessId, id, body);
      await this.writeRecurrence(tx, businessId, actor, id, body);
      const row = await this.load(tx, businessId, actor, id);
      await this.audit.logIn(
        tx,
        'invoice.updated',
        { type: 'invoice', id },
        { clientId: row.clientId, totalCents: row.totalCents, lines: row.lines.length },
      );
      return await invoiceOf(tx, businessId, row, (await firmToday(tx, businessId)).today);
    });
  }

  /** IP-F09: the invoice's history: what the firm wrote and logged, newest first. */
  async history(businessId: string, actor: ClientsActor, id: string): Promise<InvoiceHistory> {
    const items = await this.inFirm(businessId, async (tx) => {
      await this.load(tx, businessId, actor, id);
      const rows = await tx.invoiceEvent.findMany({
        where: { businessId, invoiceId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: historySelect,
      });
      return rows.map(toHistoryItem);
    });
    await this.audit.log(
      'invoice.history_viewed',
      { type: 'invoice', id },
      { count: items.length },
    );
    return { items };
  }

  /** IP-F09: Add Note or Log Activity: firm only, kept in the invoice's history and audited. */
  async addHistory(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: z.output<typeof AddInvoiceHistoryRequest>,
  ): Promise<InvoiceHistoryItem> {
    return this.inFirm(businessId, async (tx) => {
      const invoice = await this.load(tx, businessId, actor, id);
      const row = await tx.invoiceEvent.create({
        data: {
          businessId,
          invoiceId: id,
          type: body.type,
          actorKind: 'STAFF',
          actorUserId: actor.userId,
          body: body.body,
        },
        select: historySelect,
      });
      await this.audit.logIn(
        tx,
        body.type === 'NOTE' ? 'invoice.note_added' : 'invoice.activity_logged',
        { type: 'invoice', id },
        { clientId: invoice.clientId, length: body.body.length },
      );
      return toHistoryItem(row);
    });
  }

  /**
   * IP-F09: the invoice as a PDF under the firm's own prefix, behind a 5-minute link. What the
   * client is billed only; the firm's notes and history never go on it.
   */
  async pdf(businessId: string, actor: ClientsActor, id: string): Promise<InvoicePdfLink> {
    const { invoice, firm } = await this.inFirm(businessId, async (tx) => {
      const row = await this.load(tx, businessId, actor, id);
      const business = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { name: true },
      });
      const { today } = await firmToday(tx, businessId);
      return { invoice: await invoiceOf(tx, businessId, row, today), firm: business.name };
    });
    const bytes = await renderInvoicePdf(invoice, firm);
    const key = `tenant/${businessId}/reports/invoice-${randomUUID()}.pdf`;
    let url: string;
    try {
      await this.files.put(key, bytes, 'application/pdf');
      url = await this.files.presignDownload({
        key,
        fileName: `${invoice.number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`,
        contentType: 'application/pdf',
      });
    } catch {
      throw new HttpException(
        {
          code: 'FILE_STORE_UNAVAILABLE',
          message: 'The file could not be saved. Try again shortly.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.audit.log('invoice.pdf_exported', { type: 'invoice', id });
    return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }

  /**
   * IP-F08 (Octavia, Oct 27): the dates of an invoice on its way, same number. Scheduled: its
   * send day (after today) and due date. Open with something to pay: its due date (today or
   * later). Once dispatched (IP-F07) a reason is required; the change and the reason are audited.
   */
  async correct(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: z.output<typeof CorrectInvoiceRequest>,
  ): Promise<Invoice> {
    return this.inFirm(businessId, async (tx) => {
      await this.load(tx, businessId, actor, id);
      await lockInvoice(tx, businessId, id);
      const current = await this.load(tx, businessId, actor, id);
      const open = current.status === 'OPEN' && money(current).balanceDueCents > 0;
      if (current.status !== 'SCHEDULED' && !open) {
        throw conflict(
          'NOT_CORRECTABLE',
          'Only a scheduled invoice, or an open one with something to pay, can be corrected',
        );
      }
      if (current.status === 'OPEN' && body.scheduledFor !== undefined) {
        throw conflict('NOT_CORRECTABLE', 'An invoice already sent has no send day to change');
      }
      const sentAt = (await dispatchTimes(tx, businessId, [id])).get(id) ?? null;
      if (sentAt && !body.reason) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'The request is not valid',
          details: [{ path: 'reason', message: 'Say why the sent invoice changes' }],
        });
      }
      const { today } = await firmToday(tx, businessId);
      const was = { dueOn: day(current.dueOn), scheduledFor: day(current.scheduledFor) };
      const next = {
        dueOn: body.dueOn ?? was.dueOn,
        scheduledFor: body.scheduledFor ?? was.scheduledFor,
      };
      if (body.scheduledFor !== undefined && body.scheduledFor <= today) {
        throw conflict('SCHEDULE_PASSED', 'Choose a send day after today');
      }
      if (body.dueOn !== undefined && body.dueOn < today) {
        throw conflict('DUE_DATE_PASSED', 'Choose today or a later due date');
      }
      if (
        current.status === 'SCHEDULED' &&
        next.dueOn !== null &&
        next.scheduledFor !== null &&
        next.dueOn < next.scheduledFor
      ) {
        throw conflict('DUE_BEFORE_SEND', 'The due date cannot come before the send day');
      }
      const changed = {
        ...(next.dueOn !== was.dueOn ? { dueOn: { from: was.dueOn, to: next.dueOn } } : {}),
        ...(next.scheduledFor !== was.scheduledFor
          ? { scheduledFor: { from: was.scheduledFor, to: next.scheduledFor } }
          : {}),
      };
      if (Object.keys(changed).length > 0) {
        await tx.invoice.update({
          where: { businessId_id: { businessId, id } },
          data: {
            ...(changed.dueOn ? { dueOn: next.dueOn ? toDate(next.dueOn) : null } : {}),
            ...(changed.scheduledFor
              ? { scheduledFor: next.scheduledFor ? toDate(next.scheduledFor) : null }
              : {}),
          },
        });
        await this.audit.logIn(
          tx,
          'invoice.corrected',
          { type: 'invoice', id },
          {
            clientId: current.clientId,
            ...changed,
            sent: sentAt !== null,
            ...(body.reason ? { reason: body.reason } : {}),
          },
        );
      }
      return await invoiceOf(tx, businessId, await this.load(tx, businessId, actor, id), today);
    });
  }

  /**
   * A draft goes to the client: SCHEDULED when its scheduled day is after the firm's today (the
   * daily job opens it then), otherwise OPEN now with `scheduled_for` cleared. Opening sends
   * `invoice.sent` to the client after the change commits.
   */
  async send(businessId: string, actor: ClientsActor, id: string): Promise<Invoice> {
    const { invoice, opened } = await this.inFirm(businessId, async (tx) => {
      const current = await this.loadDraft(tx, businessId, actor, id);
      if (await this.checkClient(tx, businessId, current.clientId, null)) throw archived();
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
      await startRecurrence(
        tx,
        this.audit,
        businessId,
        current,
        scheduledFor !== null && later ? scheduledFor : today,
      );
      const row = await this.load(tx, businessId, actor, id);
      await this.audit.logIn(
        tx,
        later ? 'invoice.scheduled' : 'invoice.sent',
        { type: 'invoice', id },
        { clientId: row.clientId, number: row.number, totalCents: row.totalCents },
      );
      return { invoice: await invoiceOf(tx, businessId, row, today), opened: !later };
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
    return oneAtATime(businessId, id, () => this.cancelNow(businessId, actor, id, body));
  }

  private async cancelNow(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: z.output<typeof CancelInvoiceRequest>,
  ): Promise<Invoice> {
    return this.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        // In reach first (404 otherwise), then the row, waiting briefly (409 while a Pay Now runs).
        await this.load(tx, businessId, actor, id);
        await lockInvoice(tx, businessId, id);
        const current = await this.load(tx, businessId, actor, id);
        if (current.status === 'PAID' || current.status === 'CANCELED') {
          throw conflict('INVOICE_CLOSED', INVOICE_ERRORS.INVOICE_CLOSED);
        }
        if (processing(current)) throw paymentInProgress();
        if (holdsMoney(current)) throw conflict('HAS_PAYMENTS', INVOICE_ERRORS.HAS_PAYMENTS);
        await endDraftRecurrence(tx, this.audit, businessId, current);
        const unsettled = current.payments.some((p) => p.status === 'PENDING');
        if (unsettled) {
          if (!this.stripe) throw providerUnavailable();
          const stripe = this.stripe;
          await withStripeHold(async () => {
            for (const open of await openCheckouts(tx, stripe, this.audit, businessId, id)) {
              await expireCheckout(tx, stripe, this.audit, businessId, id, open);
            }
          });
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
          { clientId: row.clientId, fromStatus: current.status, totalCents: row.totalCents },
        );
        return await invoiceOf(tx, businessId, row, (await firmToday(tx, businessId)).today);
      },
      CHECKOUT_LIMITS,
    );
  }
}
