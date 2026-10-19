import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type ApplyBillingCreditRequest,
  BILLING_PAYMENT_TERM_DAYS,
  type BillingCreditNote,
  type BillingCreditNotePage,
  type BillingCreditNotesQuery,
  type BillingCreditNoteSummary,
  type BillingEstimate,
  type BillingEstimatePage,
  type BillingEstimatesQuery,
  type BillingEstimateSummary,
  type BillingInvoiceDetail,
  type BillingInvoicePage,
  type BillingInvoicesQuery,
  type BillingInvoiceSummary,
  type BillingPayment,
  type BillingPaymentPage,
  type BillingPaymentsQuery,
  type BillingPaymentSummary,
  type BillingRecurring,
  type BillingRecurringCounts,
  type BillingRecurringPage,
  type BillingRecurringQuery,
  type RecordBillingPaymentRequest,
  type RefundBillingCreditRequest,
  type RefundBillingPaymentRequest,
  type SaveBillingCreditNoteRequest,
  type SaveBillingEstimateRequest,
  type SaveBillingInvoiceRequest,
  type SaveBillingRecurringRequest,
  type SendBillingRequest,
  type SetBillingEstimateStatusRequest,
  type SetBillingRecurringStatusRequest,
  type VoidBillingRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  ADJUSTMENT_LINE,
  addDays,
  asDate,
  billableFirm,
  billingError,
  CAP,
  creditInclude,
  creditView,
  day,
  EMAIL_NOT_SET_UP,
  estimateInclude,
  estimateView,
  historyOf,
  invalid,
  invoiceInclude,
  invoiceStatus,
  invoiceView,
  lineData,
  loadFirms,
  loadTeam,
  matches,
  nextOccurrence,
  NOT_EMAILED,
  notDraft,
  notFound,
  pageOf,
  paymentInclude,
  paymentView,
  recurringInclude,
  recurringView,
  refundNote,
  sortBy,
  type Team,
  templateOf,
  today,
  trend,
} from './billing-common.js';

type Out<S extends z.ZodType> = z.output<S>;
/** Recurring schedules are run at most this often per API task when invoices are read. */
const RUN_EVERY_MS = 60_000;
/** At most this many invoices a schedule catches up in one run. */
const CATCH_UP = 12;

/**
 * Super Admin Billing documents (R60 on R0's B3), in the Super Admin's admin scope: invoices and
 * their payments and refunds, credit notes and their applications, estimates, and recurring
 * schedules. The database numbers documents and keeps every total, money column and the statuses
 * that follow; the API moves the hand-set statuses, refuses what B3 refuses with a clear code, and
 * writes a platform audit row for every change (the record's history). No email goes out yet:
 * sending issues the document and records why it was not emailed.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private ranAt = 0;

  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  private log(
    tx: TxClient,
    action: string,
    entity: { type: string; id: string },
    businessId: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.logIn(tx, action, entity, { businessId, ...metadata }, { businessId: null });
  }

  private async settingsRow(tx: TxClient) {
    return tx.platformBillingSettings.findUnique({ where: { id: 1 } });
  }

  // ---------- Invoices ----------

  async invoices(query: Out<typeof BillingInvoicesQuery>): Promise<BillingInvoicePage> {
    await this.runDue();
    return this.admin.transaction(async (tx) => {
      const rows = await this.filteredInvoices(tx, query);
      const team = await loadTeam(tx);
      const t = today();
      const views = rows.map((r) => invoiceView(r, team, t));
      const key: Record<string, (v: (typeof views)[number]) => string | number> = {
        number: (v) => v.number,
        firm: (v) => v.firmName,
        issueDate: (v) => v.issueDate,
        dueDate: (v) => v.dueDate,
        amount: (v) => v.totalCents,
        status: (v) => v.status,
      };
      const sorted = query.sort ? sortBy(views, key[query.sort]!, query.descending) : views;
      return pageOf(sorted, query.page, query.pageSize);
    });
  }

  private async filteredInvoices(tx: TxClient, q: Out<typeof BillingInvoicesQuery>) {
    const rows = await tx.platformInvoice.findMany({
      where: {
        ...(q.firmId ? { businessId: q.firmId } : {}),
        ...(q.from || q.to
          ? {
              invoiceDate: {
                ...(q.from ? { gte: asDate(q.from) } : {}),
                ...(q.to ? { lte: asDate(q.to) } : {}),
              },
            }
          : {}),
        ...(q.dueFrom || q.dueTo
          ? {
              dueDate: {
                ...(q.dueFrom ? { gte: asDate(q.dueFrom) } : {}),
                ...(q.dueTo ? { lte: asDate(q.dueTo) } : {}),
              },
            }
          : {}),
        ...(q.minCents !== undefined || q.maxCents !== undefined
          ? {
              totalCents: {
                ...(q.minCents !== undefined ? { gte: q.minCents } : {}),
                ...(q.maxCents !== undefined ? { lte: q.maxCents } : {}),
              },
            }
          : {}),
      },
      include: invoiceInclude,
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      take: CAP,
    });
    const t = today();
    return rows.filter(
      (r) =>
        (!q.status?.length || q.status.includes(invoiceStatus(r, t))) &&
        matches(q.search, r.number, r.business.name, r.billToName, r.billToEmail, r.reference),
    );
  }

  async invoiceSummary(query: Out<typeof BillingInvoicesQuery>): Promise<BillingInvoiceSummary> {
    await this.runDue();
    return this.admin.transaction(async (tx) => {
      const rows = await this.filteredInvoices(tx, query);
      const t = today();
      const issued = rows.filter((r) => r.status !== 'DRAFT' && r.status !== 'VOIDED');
      const open = issued.filter((r) =>
        ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoiceStatus(r, t)),
      );
      const overdue = issued.filter((r) => invoiceStatus(r, t) === 'OVERDUE');
      const balance = (r: (typeof rows)[number]) =>
        Math.max(0, r.totalCents - r.paidCents - r.creditedCents);
      const net = (r: (typeof rows)[number]) => r.paidCents - r.refundedCents;
      let invoicedTrend: number | null = null;
      let paidTrend: number | null = null;
      if (query.from && query.to) {
        const length =
          Math.round((asDate(query.to).getTime() - asDate(query.from).getTime()) / 86_400_000) + 1;
        const previous = await this.filteredInvoices(tx, {
          ...query,
          from: addDays(query.from, -length),
          to: addDays(query.from, -1),
        });
        const prevIssued = previous.filter((r) => r.status !== 'DRAFT' && r.status !== 'VOIDED');
        invoicedTrend = trend(
          issued.reduce((s, r) => s + r.totalCents, 0),
          prevIssued.reduce((s, r) => s + r.totalCents, 0),
        );
        paidTrend = trend(
          issued.reduce((s, r) => s + net(r), 0),
          prevIssued.reduce((s, r) => s + net(r), 0),
        );
      }
      return {
        invoicedCents: issued.reduce((s, r) => s + r.totalCents, 0),
        invoicedCount: issued.length,
        invoicedTrend,
        paidCents: issued.reduce((s, r) => s + net(r), 0),
        paidCount: issued.filter((r) => r.paidCents > 0).length,
        paidTrend,
        outstandingCents: open.reduce((s, r) => s + balance(r), 0),
        outstandingCount: open.length,
        overdueCents: overdue.reduce((s, r) => s + balance(r), 0),
        overdueCount: overdue.length,
      };
    });
  }

  invoice(id: string): Promise<BillingInvoiceDetail> {
    return this.admin.transaction((tx) => this.invoiceDetail(tx, id));
  }

  private async invoiceDetail(tx: TxClient, id: string): Promise<BillingInvoiceDetail> {
    const row = await tx.platformInvoice.findUnique({ where: { id }, include: invoiceInclude });
    if (!row) throw notFound('Invoice');
    const [team, firms, payments, applications, recurring] = await Promise.all([
      loadTeam(tx),
      loadFirms(tx, row.businessId),
      tx.platformPayment.findMany({
        where: { invoiceId: id },
        include: paymentInclude,
        orderBy: { createdAt: 'asc' },
      }),
      tx.platformCreditApplication.findMany({
        where: { invoiceId: id },
        include: { creditNote: { select: { number: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      row.recurringId
        ? tx.platformRecurringInvoice.findUnique({
            where: { id: row.recurringId },
            select: { id: true, description: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      ...invoiceView(row, team, today()),
      firm: firms.get(row.businessId)!,
      payments: payments.map((p) => paymentView(p, team)),
      credits: applications.map((a) => ({
        id: a.id,
        creditNoteId: a.creditNoteId,
        creditNoteNumber: a.creditNote.number,
        amountCents: a.amountCents,
        at: a.createdAt.toISOString(),
        by: team.nameOf(a.appliedByUserId),
      })),
      history: await historyOf(tx, 'billing_invoice', id, team),
      schedule: recurring,
    };
  }

  createInvoice(body: Out<typeof SaveBillingInvoiceRequest>): Promise<BillingInvoiceDetail> {
    return this.admin.transaction(async (tx) => {
      const firm = await billableFirm(tx, body.firmId);
      if (body.estimateId) await this.convertible(tx, body.estimateId, firm.id);
      const row = await tx.platformInvoice.create({
        data: {
          businessId: firm.id,
          invoiceDate: asDate(body.issueDate),
          dueDate: asDate(body.dueDate),
          periodStart: body.periodStart ? asDate(body.periodStart) : null,
          periodEnd: body.periodEnd ? asDate(body.periodEnd) : null,
          billToName: firm.contactName,
          billToEmail: firm.contactEmail,
          reference: body.reference || null,
          notes: body.notes || null,
          internalNote: body.internalNote || null,
          discountCents: 0,
          allowOnlinePayment: body.allowOnlinePayment,
          sourceEstimateId: body.estimateId,
          createdByUserId: this.admin.adminUserId,
          lines: {
            create: lineData(body.lines, firm.taxExempt),
          },
        },
        select: { id: true, number: true },
      });
      await this.discount(tx, 'invoice', row.id, body.discountCents);
      await this.log(
        tx,
        'billing_invoice.created',
        { type: 'billing_invoice', id: row.id },
        firm.id,
        {
          detail: row.number,
          lines: body.lines.length,
        },
      );
      if (body.estimateId) await this.markConverted(tx, body.estimateId, row.id, firm.id);
      if (body.send) await this.issue(tx, row.id, firm.id, body.emailFirm);
      return this.invoiceDetail(tx, row.id);
    });
  }

  updateInvoice(
    id: string,
    body: Out<typeof SaveBillingInvoiceRequest>,
  ): Promise<BillingInvoiceDetail> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformInvoice.findUnique({
        where: { id },
        select: { status: true, businessId: true, sourceEstimateId: true },
      });
      if (!row) throw notFound('Invoice');
      if (row.status !== 'DRAFT') throw notDraft();
      if (body.firmId !== row.businessId)
        throw invalid('The firm of an invoice never changes; make a new one');
      const firm = await billableFirm(tx, row.businessId);
      // The discount comes off first: the lines are replaced, then it goes back on.
      await tx.platformInvoice.update({ where: { id }, data: { discountCents: 0 } });
      await tx.platformInvoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.platformInvoice.update({
        where: { id },
        data: {
          invoiceDate: asDate(body.issueDate),
          dueDate: asDate(body.dueDate),
          periodStart: body.periodStart ? asDate(body.periodStart) : null,
          periodEnd: body.periodEnd ? asDate(body.periodEnd) : null,
          billToName: firm.contactName,
          billToEmail: firm.contactEmail,
          reference: body.reference || null,
          notes: body.notes || null,
          internalNote: body.internalNote || null,
          discountCents: 0,
          allowOnlinePayment: body.allowOnlinePayment,
          lines: {
            create: lineData(body.lines, firm.taxExempt),
          },
        },
      });
      await this.discount(tx, 'invoice', id, body.discountCents);
      await this.log(tx, 'billing_invoice.updated', { type: 'billing_invoice', id }, firm.id, {
        lines: body.lines.length,
      });
      if (body.send) await this.issue(tx, id, firm.id, body.emailFirm);
      return this.invoiceDetail(tx, id);
    });
  }

  /**
   * The discount goes on after the lines: the database works out a document's total from its lines
   * when each is written, so a discount saved before them would take the total below zero.
   */
  private async discount(tx: TxClient, kind: 'invoice' | 'estimate', id: string, cents: number) {
    if (cents <= 0) return;
    const doc =
      kind === 'invoice'
        ? await tx.platformInvoice.findUniqueOrThrow({
            where: { id },
            select: { subtotalCents: true, taxCents: true },
          })
        : await tx.platformEstimate.findUniqueOrThrow({
            where: { id },
            select: { subtotalCents: true, taxCents: true },
          });
    // The database keeps a discount within the subtotal (before tax).
    if (cents > doc.subtotalCents)
      throw invalid(`The discount is more than the ${kind}'s subtotal`);
    if (kind === 'invoice')
      await tx.platformInvoice.update({ where: { id }, data: { discountCents: cents } });
    else await tx.platformEstimate.update({ where: { id }, data: { discountCents: cents } });
  }

  /** DRAFT -> SENT (the database stamps the time); the email is recorded as not sent yet. */
  private async issue(tx: TxClient, id: string, businessId: string, email: boolean) {
    const row = await tx.platformInvoice.findUniqueOrThrow({
      where: { id },
      select: { status: true, totalCents: true, number: true },
    });
    if (row.status === 'VOIDED')
      throw billingError(409, 'ALREADY_VOIDED', 'This invoice was voided');
    if (row.status === 'DRAFT') {
      if (row.totalCents <= 0) throw invalid('An invoice needs an amount to send');
      await tx.platformInvoice.update({
        where: { id },
        data: { status: 'SENT', sendError: email ? EMAIL_NOT_SET_UP : NOT_EMAILED },
      });
      await this.log(tx, 'billing_invoice.issued', { type: 'billing_invoice', id }, businessId, {
        detail: row.number,
      });
    } else {
      await tx.platformInvoice.update({
        where: { id },
        data: { sendError: email ? EMAIL_NOT_SET_UP : NOT_EMAILED },
      });
    }
    if (email)
      await this.log(
        tx,
        'billing_invoice.send_failed',
        { type: 'billing_invoice', id },
        businessId,
        {
          detail: 'Billing emails are not set up yet',
        },
      );
  }

  sendInvoice(id: string, body: Out<typeof SendBillingRequest>): Promise<BillingInvoiceDetail> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformInvoice.findUnique({
        where: { id },
        select: { businessId: true, status: true },
      });
      if (!row) throw notFound('Invoice');
      if (row.status === 'DRAFT') await billableFirm(tx, row.businessId);
      await this.issue(tx, id, row.businessId, body.email);
      return this.invoiceDetail(tx, id);
    });
  }

  duplicateInvoice(id: string): Promise<BillingInvoiceDetail> {
    return this.admin.transaction(async (tx) => {
      const source = await tx.platformInvoice.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!source) throw notFound('Invoice');
      const firm = await billableFirm(tx, source.businessId);
      const issue = today();
      const terms = Math.max(
        0,
        Math.round((source.dueDate.getTime() - source.invoiceDate.getTime()) / 86_400_000),
      );
      const row = await tx.platformInvoice.create({
        data: {
          businessId: firm.id,
          invoiceDate: asDate(issue),
          dueDate: asDate(addDays(issue, terms)),
          billToName: firm.contactName,
          billToEmail: firm.contactEmail,
          reference: source.reference,
          notes: source.notes,
          internalNote: source.internalNote,
          discountCents: 0,
          allowOnlinePayment: source.allowOnlinePayment,
          createdByUserId: this.admin.adminUserId,
          lines: {
            create: [...source.lines]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((l) => ({
                description: l.description,
                quantity: l.quantity,
                unitCents: l.unitCents,
                taxRateBps: l.taxRateBps,
                sortOrder: l.sortOrder,
              })),
          },
        },
        select: { id: true, number: true },
      });
      await this.discount(tx, 'invoice', row.id, source.discountCents);
      await this.log(
        tx,
        'billing_invoice.duplicated',
        { type: 'billing_invoice', id: row.id },
        firm.id,
        {
          detail: `From ${source.number}`,
          sourceId: id,
        },
      );
      return this.invoiceDetail(tx, row.id);
    });
  }

  voidInvoice(id: string, body: Out<typeof VoidBillingRequest>): Promise<BillingInvoiceDetail> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformInvoice.findUnique({ where: { id } });
      if (!row) throw notFound('Invoice');
      if (row.status === 'VOIDED')
        throw billingError(409, 'ALREADY_VOIDED', 'This invoice was already voided');
      const held = await tx.platformPayment.count({
        where: { invoiceId: id, status: { not: 'FAILED' } },
      });
      if (
        row.paidCents > 0 ||
        row.creditedCents > 0 ||
        held > 0 ||
        !['DRAFT', 'SENT'].includes(row.status)
      )
        throw billingError(409, 'HAS_MONEY', 'Payments or credits are recorded on it');
      // B3 gives every invoice that is not a draft a sent time, so a draft is issued (not
      // emailed) and voided in this one transaction.
      if (row.status === 'DRAFT')
        await tx.platformInvoice.update({
          where: { id },
          data: { status: 'SENT', sendError: NOT_EMAILED },
        });
      await tx.platformInvoice.update({
        where: { id },
        data: { status: 'VOIDED', voidReason: body.reason },
      });
      await this.log(
        tx,
        'billing_invoice.voided',
        { type: 'billing_invoice', id },
        row.businessId,
        { detail: body.reason },
      );
      return this.invoiceDetail(tx, id);
    });
  }

  async recordPayment(
    id: string,
    body: Out<typeof RecordBillingPaymentRequest>,
  ): Promise<BillingPayment> {
    const existing = await this.admin.transaction((tx) =>
      tx.platformPayment.findUnique({
        where: { idempotencyKey: body.requestId },
        include: paymentInclude,
      }),
    );
    if (existing)
      return this.admin.transaction(async (tx) => paymentView(existing, await loadTeam(tx)));
    return this.admin.transaction(async (tx) => {
      const inv = await tx.platformInvoice.findUnique({ where: { id } });
      if (!inv) throw notFound('Invoice');
      if (inv.status === 'DRAFT' || inv.status === 'VOIDED')
        throw billingError(409, 'NOT_ISSUED', 'Send the invoice first');
      const balance = inv.totalCents - inv.paidCents - inv.creditedCents;
      if (body.amountCents > balance)
        throw billingError(409, 'OVER_BALANCE', 'That is more than the invoice still owes');
      const settings = await this.settingsRow(tx);
      if (settings && !settings.allowPartialPayments && body.amountCents < balance)
        throw invalid('Partial payments are off in Billing Settings: record the full balance');
      const row = await tx.platformPayment.create({
        data: {
          businessId: inv.businessId,
          invoiceId: id,
          amountCents: body.amountCents,
          method: body.method,
          status: 'COMPLETED',
          paidOn: asDate(body.paidOn),
          reference: body.reference || null,
          notes: body.notes || null,
          recordedByUserId: this.admin.adminUserId,
          idempotencyKey: body.requestId,
        },
        include: paymentInclude,
      });
      await this.log(
        tx,
        'billing_invoice.payment_recorded',
        { type: 'billing_invoice', id },
        inv.businessId,
        {
          amountCents: body.amountCents,
          detail: `${row.method} payment`,
          paymentId: row.id,
          receiptRequested: body.sendReceipt,
        },
      );
      await this.log(
        tx,
        'billing_payment.created',
        { type: 'billing_payment', id: row.id },
        inv.businessId,
        {
          amountCents: body.amountCents,
          method: body.method,
        },
      );
      return paymentView(row, await loadTeam(tx));
    });
  }

  // ---------- Payments ----------

  private async filteredPayments(tx: TxClient, q: Out<typeof BillingPaymentsQuery>) {
    const rows = await tx.platformPayment.findMany({
      where: {
        ...(q.firmId ? { businessId: q.firmId } : {}),
        ...(q.invoiceId ? { invoiceId: q.invoiceId } : {}),
        ...(q.status?.length ? { status: { in: q.status } } : {}),
        ...(q.method?.length ? { method: { in: q.method } } : {}),
        ...(q.from || q.to
          ? {
              paidOn: {
                ...(q.from ? { gte: asDate(q.from) } : {}),
                ...(q.to ? { lte: asDate(q.to) } : {}),
              },
            }
          : {}),
      },
      include: paymentInclude,
      orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }],
      take: CAP,
    });
    return rows.filter((r) =>
      matches(
        q.search,
        r.invoice.number,
        r.invoice.business.name,
        r.invoice.billToName,
        r.reference,
      ),
    );
  }

  payments(query: Out<typeof BillingPaymentsQuery>): Promise<BillingPaymentPage> {
    return this.admin.transaction(async (tx) => {
      const team = await loadTeam(tx);
      const views = (await this.filteredPayments(tx, query)).map((p) => paymentView(p, team));
      const key: Record<string, (v: BillingPayment) => string | number> = {
        paidOn: (v) => v.paidOn,
        firm: (v) => v.firmName,
        invoice: (v) => v.invoiceNumber,
        amount: (v) => v.amountCents,
        method: (v) => v.method,
        status: (v) => v.status,
      };
      return pageOf(
        query.sort ? sortBy(views, key[query.sort]!, query.descending) : views,
        query.page,
        query.pageSize,
      );
    });
  }

  paymentSummary(query: Out<typeof BillingPaymentsQuery>): Promise<BillingPaymentSummary> {
    return this.admin.transaction(async (tx) => {
      const rows = await this.filteredPayments(tx, query);
      const done = rows.filter((r) => r.status !== 'PENDING' && r.status !== 'FAILED');
      const t = today();
      const monthStart = `${t.slice(0, 7)}-01`;
      const lastStart = addDays(monthStart, -1).slice(0, 7) + '-01';
      const all = await this.filteredPayments(tx, { ...query, from: undefined, to: undefined });
      const doneAll = all.filter((r) => r.status !== 'PENDING' && r.status !== 'FAILED');
      const thisMonth = doneAll.filter((r) => day(r.paidOn) >= monthStart);
      const lastMonth = doneAll.filter(
        (r) => day(r.paidOn) >= lastStart && day(r.paidOn) < monthStart,
      );
      const sum = (xs: typeof rows) => xs.reduce((s, r) => s + r.amountCents, 0);
      const refunded = done.filter((r) => r.refundedCents > 0);
      let totalTrend: number | null = null;
      if (query.from && query.to) {
        const length =
          Math.round((asDate(query.to).getTime() - asDate(query.from).getTime()) / 86_400_000) + 1;
        const prev = await this.filteredPayments(tx, {
          ...query,
          from: addDays(query.from, -length),
          to: addDays(query.from, -1),
        });
        totalTrend = trend(
          sum(done),
          sum(prev.filter((r) => r.status !== 'PENDING' && r.status !== 'FAILED')),
        );
      }
      return {
        totalCents: sum(done),
        totalCount: done.length,
        totalTrend,
        monthCents: sum(thisMonth),
        monthCount: thisMonth.length,
        monthTrend: trend(sum(thisMonth), sum(lastMonth)),
        refundsCents: done.reduce((s, r) => s + r.refundedCents, 0),
        refundsCount: refunded.length,
        averageCents: done.length ? Math.round(sum(done) / done.length) : 0,
      };
    });
  }

  payment(id: string): Promise<BillingPayment> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformPayment.findUnique({ where: { id }, include: paymentInclude });
      if (!row) throw notFound('Payment');
      return paymentView(row, await loadTeam(tx));
    });
  }

  refundPayment(
    id: string,
    body: Out<typeof RefundBillingPaymentRequest>,
  ): Promise<BillingPayment> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformPayment.findUnique({ where: { id }, include: paymentInclude });
      if (!row) throw notFound('Payment');
      const team = await loadTeam(tx);
      const left = paymentView(row, team).refundableCents;
      if (body.method !== 'ORIGINAL')
        throw billingError(
          422,
          'NOT_SUPPORTED_YET',
          'Refunds go back through the original method for now',
        );
      // B3 keeps refunded invoices fully paid: a payment on a part-paid invoice is refunded later.
      const inv = await tx.platformInvoice.findUniqueOrThrow({
        where: { id: row.invoiceId },
        select: { totalCents: true, paidCents: true, creditedCents: true },
      });
      if (inv.paidCents + inv.creditedCents !== inv.totalCents)
        throw billingError(
          422,
          'NOT_SUPPORTED_YET',
          'A payment can be refunded once its invoice is fully paid',
        );
      const amount = body.type === 'FULL' ? left : body.amountCents;
      if (amount <= 0 || amount > left)
        throw billingError(409, 'OVER_REFUNDABLE', 'That is more than can still be refunded');
      const refund = await tx.platformRefund.create({
        data: {
          businessId: row.businessId,
          paymentId: id,
          amountCents: amount,
          reason: body.reason,
          internalNote: refundNote(body.type, body.notes),
          requestedByUserId: this.admin.adminUserId,
        },
        select: { id: true },
      });
      // Recorded by hand: the refund is done (no processor refunds Firmivra's billing yet).
      await tx.platformRefund.update({ where: { id: refund.id }, data: { status: 'COMPLETED' } });
      await this.log(
        tx,
        'billing_payment.refunded',
        { type: 'billing_payment', id },
        row.businessId,
        {
          amountCents: amount,
          detail: body.reason,
          refundId: refund.id,
        },
      );
      await this.log(
        tx,
        'billing_invoice.refunded',
        { type: 'billing_invoice', id: row.invoiceId },
        row.businessId,
        {
          amountCents: amount,
          detail: body.reason,
        },
      );
      const fresh = await tx.platformPayment.findUniqueOrThrow({
        where: { id },
        include: paymentInclude,
      });
      return paymentView(fresh, team);
    });
  }

  // ---------- Credit notes ----------

  private async filteredCredits(tx: TxClient, q: Out<typeof BillingCreditNotesQuery>) {
    const rows = await tx.platformCreditNote.findMany({
      where: {
        ...(q.firmId ? { businessId: q.firmId } : {}),
        ...(q.invoiceId ? { relatedInvoiceId: q.invoiceId } : {}),
        ...(q.status?.length ? { status: { in: q.status } } : {}),
        ...(q.from || q.to
          ? {
              issueDate: {
                ...(q.from ? { gte: asDate(q.from) } : {}),
                ...(q.to ? { lte: asDate(q.to) } : {}),
              },
            }
          : {}),
      },
      include: creditInclude,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: CAP,
    });
    return rows.filter((r) =>
      matches(q.search, r.number, r.business.name, r.relatedInvoice?.number, r.reason),
    );
  }

  creditNotes(query: Out<typeof BillingCreditNotesQuery>): Promise<BillingCreditNotePage> {
    return this.admin.transaction(async (tx) => {
      const team = await loadTeam(tx);
      const views = (await this.filteredCredits(tx, query)).map((c) => {
        const { history: _history, ...rest } = creditView(c, team);
        return rest;
      });
      const key: Record<string, (v: (typeof views)[number]) => string | number> = {
        number: (v) => v.number,
        firm: (v) => v.firmName,
        invoice: (v) => v.invoiceNumber ?? '',
        date: (v) => v.date,
        amount: (v) => v.totalCents,
        applied: (v) => v.appliedCents,
        remaining: (v) => v.remainingCents,
        status: (v) => v.status,
      };
      return pageOf(
        query.sort ? sortBy(views, key[query.sort]!, query.descending) : views,
        query.page,
        query.pageSize,
      );
    });
  }

  creditNoteSummary(query: Out<typeof BillingCreditNotesQuery>): Promise<BillingCreditNoteSummary> {
    return this.admin.transaction(async (tx) => {
      const rows = await this.filteredCredits(tx, query);
      const issued = rows.filter((r) => r.status !== 'DRAFT' && r.status !== 'VOIDED');
      const open = issued.filter(
        (r) => r.status === 'AVAILABLE' || r.status === 'PARTIALLY_APPLIED',
      );
      return {
        count: rows.length,
        issuedCents: issued.reduce((s, r) => s + r.totalCents, 0),
        appliedCents: issued.reduce((s, r) => s + r.appliedCents, 0),
        availableCents: open.reduce(
          (s, r) => s + Math.max(0, r.totalCents - r.appliedCents - r.refundedCents),
          0,
        ),
        refundedCents: issued.reduce((s, r) => s + r.refundedCents, 0),
      };
    });
  }

  creditNote(id: string): Promise<BillingCreditNote> {
    return this.admin.transaction((tx) => this.creditDetail(tx, id));
  }

  private async creditDetail(tx: TxClient, id: string): Promise<BillingCreditNote> {
    const row = await tx.platformCreditNote.findUnique({ where: { id }, include: creditInclude });
    if (!row) throw notFound('Credit note');
    const team = await loadTeam(tx);
    return creditView(row, team, await historyOf(tx, 'billing_credit_note', id, team));
  }

  availableCredits(firmId: string): Promise<BillingCreditNote[]> {
    return this.admin.transaction(async (tx) => {
      const team = await loadTeam(tx);
      const rows = await tx.platformCreditNote.findMany({
        where: { businessId: firmId, status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] } },
        include: creditInclude,
        orderBy: { issueDate: 'asc' },
      });
      return rows.map((r) => creditView(r, team)).filter((c) => c.remainingCents > 0);
    });
  }

  private creditLines(body: Out<typeof SaveBillingCreditNoteRequest>, taxExempt: boolean) {
    return body.method === 'ADJUSTMENT'
      ? [
          {
            description: ADJUSTMENT_LINE,
            quantity: 1,
            unitCents: body.adjustmentCents,
            taxRateBps: 0,
            sortOrder: 0,
          },
        ]
      : lineData(body.lines, taxExempt);
  }

  private async relatedInvoice(tx: TxClient, invoiceId: string | null, firmId: string) {
    if (!invoiceId) return;
    const inv = await tx.platformInvoice.findUnique({
      where: { id: invoiceId },
      select: { businessId: true },
    });
    if (!inv) throw notFound('Invoice');
    if (inv.businessId !== firmId)
      throw billingError(409, 'OTHER_FIRM', 'The invoice belongs to another firm');
  }

  createCreditNote(body: Out<typeof SaveBillingCreditNoteRequest>): Promise<BillingCreditNote> {
    return this.admin.transaction(async (tx) => {
      const firm = await billableFirm(tx, body.firmId);
      await this.relatedInvoice(tx, body.invoiceId, firm.id);
      const row = await tx.platformCreditNote.create({
        data: {
          businessId: firm.id,
          relatedInvoiceId: body.invoiceId,
          issueDate: asDate(body.date),
          reason: body.reason,
          customerNote: body.customerNote || null,
          internalNote: body.internalNote || null,
          createdByUserId: this.admin.adminUserId,
          lines: {
            create: this.creditLines(body, firm.taxExempt),
          },
        },
        select: { id: true, number: true },
      });
      await this.log(
        tx,
        'billing_credit_note.created',
        { type: 'billing_credit_note', id: row.id },
        firm.id,
        {
          detail: row.number,
        },
      );
      if (body.issue) await this.issueCredit(tx, row.id);
      return this.creditDetail(tx, row.id);
    });
  }

  updateCreditNote(
    id: string,
    body: Out<typeof SaveBillingCreditNoteRequest>,
  ): Promise<BillingCreditNote> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformCreditNote.findUnique({
        where: { id },
        select: { status: true, businessId: true },
      });
      if (!row) throw notFound('Credit note');
      if (row.status !== 'DRAFT') throw notDraft();
      if (body.firmId !== row.businessId) throw invalid('The firm of a credit note never changes');
      const firm = await billableFirm(tx, row.businessId);
      await this.relatedInvoice(tx, body.invoiceId, firm.id);
      await tx.platformCreditNoteLine.deleteMany({ where: { creditNoteId: id } });
      await tx.platformCreditNote.update({
        where: { id },
        data: {
          relatedInvoiceId: body.invoiceId,
          issueDate: asDate(body.date),
          reason: body.reason,
          customerNote: body.customerNote || null,
          internalNote: body.internalNote || null,
          lines: {
            create: this.creditLines(body, firm.taxExempt),
          },
        },
      });
      await this.log(
        tx,
        'billing_credit_note.updated',
        { type: 'billing_credit_note', id },
        firm.id,
      );
      if (body.issue) await this.issueCredit(tx, id);
      return this.creditDetail(tx, id);
    });
  }

  private async issueCredit(tx: TxClient, id: string) {
    const row = await tx.platformCreditNote.findUniqueOrThrow({
      where: { id },
      select: { status: true, totalCents: true, businessId: true, number: true },
    });
    if (row.status !== 'DRAFT') throw notDraft();
    if (row.totalCents <= 0) throw invalid('A credit note needs an amount');
    await tx.platformCreditNote.update({ where: { id }, data: { status: 'AVAILABLE' } });
    await this.log(
      tx,
      'billing_credit_note.issued',
      { type: 'billing_credit_note', id },
      row.businessId,
      {
        amountCents: row.totalCents,
        detail: row.number,
      },
    );
  }

  issueCreditNote(id: string): Promise<BillingCreditNote> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformCreditNote.findUnique({
        where: { id },
        select: { businessId: true },
      });
      if (!row) throw notFound('Credit note');
      await billableFirm(tx, row.businessId);
      await this.issueCredit(tx, id);
      return this.creditDetail(tx, id);
    });
  }

  applyCredit(id: string, body: Out<typeof ApplyBillingCreditRequest>): Promise<BillingCreditNote> {
    return this.admin.transaction(async (tx) => {
      const credit = await tx.platformCreditNote.findUnique({ where: { id } });
      if (!credit) throw notFound('Credit note');
      const inv = await tx.platformInvoice.findUnique({ where: { id: body.invoiceId } });
      if (!inv) throw notFound('Invoice');
      if (inv.businessId !== credit.businessId)
        throw billingError(
          409,
          'OTHER_FIRM',
          'The credit note and the invoice belong to different firms',
        );
      if (credit.status !== 'AVAILABLE' && credit.status !== 'PARTIALLY_APPLIED')
        throw billingError(409, 'CREDIT_NOT_AVAILABLE', 'This credit note cannot be used now');
      if (!['SENT', 'PARTIALLY_PAID'].includes(inv.status))
        throw billingError(409, 'NOT_ISSUED', 'Credit goes only on a sent invoice with a balance');
      if (body.amountCents > credit.totalCents - credit.appliedCents - credit.refundedCents)
        throw billingError(409, 'OVER_CREDIT', 'That is more than the credit note has left');
      if (body.amountCents > inv.totalCents - inv.paidCents - inv.creditedCents)
        throw billingError(409, 'OVER_BALANCE', 'That is more than the invoice still owes');
      await tx.platformCreditApplication.create({
        data: {
          businessId: credit.businessId,
          creditNoteId: id,
          invoiceId: inv.id,
          amountCents: body.amountCents,
          appliedByUserId: this.admin.adminUserId,
        },
      });
      await this.log(
        tx,
        'billing_credit_note.credit_applied',
        { type: 'billing_credit_note', id },
        credit.businessId,
        {
          amountCents: body.amountCents,
          detail: `To ${inv.number}`,
        },
      );
      await this.log(
        tx,
        'billing_invoice.credit_applied',
        { type: 'billing_invoice', id: inv.id },
        credit.businessId,
        {
          amountCents: body.amountCents,
          detail: `From ${credit.number}`,
        },
      );
      return this.creditDetail(tx, id);
    });
  }

  refundCreditNote(
    id: string,
    body: Out<typeof RefundBillingCreditRequest>,
  ): Promise<BillingCreditNote> {
    return this.admin.transaction(async (tx) => {
      const c = await tx.platformCreditNote.findUnique({ where: { id } });
      if (!c) throw notFound('Credit note');
      if (body.method !== 'ORIGINAL')
        throw billingError(
          422,
          'NOT_SUPPORTED_YET',
          'Refunds go back through the original method for now',
        );
      if (c.status !== 'AVAILABLE' && c.status !== 'PARTIALLY_APPLIED')
        throw billingError(409, 'CREDIT_NOT_AVAILABLE', 'This credit note cannot be refunded now');
      const left = c.totalCents - c.appliedCents - c.refundedCents;
      if (body.amountCents > left)
        throw billingError(409, 'OVER_CREDIT', 'That is more than the credit note has left');
      const refunded = c.refundedCents + body.amountCents;
      await tx.platformCreditNote.update({
        where: { id },
        data: {
          refundedCents: refunded,
          ...(refunded + c.appliedCents === c.totalCents ? { status: 'REFUNDED' as const } : {}),
        },
      });
      await this.log(
        tx,
        'billing_credit_note.refunded',
        { type: 'billing_credit_note', id },
        c.businessId,
        {
          amountCents: body.amountCents,
          detail: body.reason,
        },
      );
      return this.creditDetail(tx, id);
    });
  }

  voidCreditNote(id: string, body: Out<typeof VoidBillingRequest>): Promise<BillingCreditNote> {
    return this.admin.transaction(async (tx) => {
      const c = await tx.platformCreditNote.findUnique({ where: { id } });
      if (!c) throw notFound('Credit note');
      if (c.status === 'VOIDED')
        throw billingError(409, 'ALREADY_VOIDED', 'This credit note was already voided');
      if (c.appliedCents > 0 || c.refundedCents > 0 || !['DRAFT', 'AVAILABLE'].includes(c.status))
        throw billingError(409, 'HAS_MONEY', 'Credit was already used from it');
      // As invoices: B3 gives every credit note that is not a draft an issue time.
      if (c.status === 'DRAFT')
        await tx.platformCreditNote.update({ where: { id }, data: { status: 'AVAILABLE' } });
      await tx.platformCreditNote.update({
        where: { id },
        data: { status: 'VOIDED', voidReason: body.reason },
      });
      await this.log(
        tx,
        'billing_credit_note.voided',
        { type: 'billing_credit_note', id },
        c.businessId,
        { detail: body.reason },
      );
      return this.creditDetail(tx, id);
    });
  }

  // ---------- Estimates ----------

  private async filteredEstimates(tx: TxClient, q: Out<typeof BillingEstimatesQuery>, team: Team) {
    const rows = await tx.platformEstimate.findMany({
      where: {
        ...(q.firmId ? { businessId: q.firmId } : {}),
        ...(q.from || q.to
          ? {
              issueDate: {
                ...(q.from ? { gte: asDate(q.from) } : {}),
                ...(q.to ? { lte: asDate(q.to) } : {}),
              },
            }
          : {}),
      },
      include: estimateInclude,
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      take: CAP,
    });
    const t = today();
    return rows
      .map((r) => estimateView(r, team, t))
      .filter(
        (v) =>
          (!q.status?.length || q.status.includes(v.status)) &&
          matches(q.search, v.number, v.firmName, v.contactName, v.email, v.reference),
      );
  }

  estimates(query: Out<typeof BillingEstimatesQuery>): Promise<BillingEstimatePage> {
    return this.admin.transaction(async (tx) => {
      const views = (await this.filteredEstimates(tx, query, await loadTeam(tx))).map(
        ({ history: _h, ...rest }) => rest,
      );
      const key: Record<string, (v: (typeof views)[number]) => string | number> = {
        number: (v) => v.number,
        firm: (v) => v.firmName,
        issueDate: (v) => v.issueDate,
        expirationDate: (v) => v.expirationDate,
        amount: (v) => v.totalCents,
        status: (v) => v.status,
      };
      return pageOf(
        query.sort ? sortBy(views, key[query.sort]!, query.descending) : views,
        query.page,
        query.pageSize,
      );
    });
  }

  estimateSummary(query: Out<typeof BillingEstimatesQuery>): Promise<BillingEstimateSummary> {
    return this.admin.transaction(async (tx) => {
      const views = await this.filteredEstimates(tx, query, await loadTeam(tx));
      const of = (...s: string[]) => views.filter((v) => s.includes(v.status));
      const sum = (xs: typeof views) => xs.reduce((n, v) => n + v.totalCents, 0);
      return {
        totalCents: sum(views),
        totalCount: views.length,
        approvedCents: sum(of('APPROVED', 'CONVERTED')),
        approvedCount: of('APPROVED', 'CONVERTED').length,
        pendingCents: sum(of('SENT', 'PENDING')),
        pendingCount: of('SENT', 'PENDING').length,
        declinedCents: sum(of('DECLINED')),
        declinedCount: of('DECLINED').length,
      };
    });
  }

  estimate(id: string): Promise<BillingEstimate> {
    return this.admin.transaction((tx) => this.estimateDetail(tx, id));
  }

  private async estimateDetail(tx: TxClient, id: string): Promise<BillingEstimate> {
    const row = await tx.platformEstimate.findUnique({ where: { id }, include: estimateInclude });
    if (!row) throw notFound('Estimate');
    const team = await loadTeam(tx);
    return estimateView(row, team, today(), await historyOf(tx, 'billing_estimate', id, team));
  }

  private async assignee(tx: TxClient, id: string | null) {
    if (!id) return;
    const found = await tx.platformAdmin.findUnique({
      where: { userId: id },
      select: { userId: true },
    });
    if (!found) throw invalid('Assign the estimate to a team member');
  }

  createEstimate(body: Out<typeof SaveBillingEstimateRequest>): Promise<BillingEstimate> {
    return this.admin.transaction(async (tx) => {
      const firm = await billableFirm(tx, body.firmId);
      await this.assignee(tx, body.assignedToId);
      const row = await tx.platformEstimate.create({
        data: {
          businessId: firm.id,
          issueDate: asDate(body.issueDate),
          expirationDate: asDate(body.expirationDate),
          contactName: body.contactName,
          contactEmail: body.email.toLowerCase(),
          contactPhone: body.phone || null,
          reference: body.reference || null,
          notes: body.notes || null,
          discountCents: 0,
          assignedUserId: body.assignedToId,
          createdByUserId: this.admin.adminUserId,
          lines: {
            create: lineData(body.lines, firm.taxExempt),
          },
        },
        select: { id: true, number: true, totalCents: true },
      });
      await this.discount(tx, 'estimate', row.id, body.discountCents);
      await this.log(
        tx,
        'billing_estimate.created',
        { type: 'billing_estimate', id: row.id },
        firm.id,
        { detail: row.number },
      );
      if (body.send) await this.sendEstimateIn(tx, row.id, firm.id, body.emailFirm);
      return this.estimateDetail(tx, row.id);
    });
  }

  updateEstimate(
    id: string,
    body: Out<typeof SaveBillingEstimateRequest>,
  ): Promise<BillingEstimate> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformEstimate.findUnique({
        where: { id },
        select: { status: true, businessId: true },
      });
      if (!row) throw notFound('Estimate');
      if (row.status !== 'DRAFT') throw notDraft();
      if (body.firmId !== row.businessId) throw invalid('The firm of an estimate never changes');
      const firm = await billableFirm(tx, row.businessId);
      await this.assignee(tx, body.assignedToId);
      await tx.platformEstimate.update({ where: { id }, data: { discountCents: 0 } });
      await tx.platformEstimateLine.deleteMany({ where: { estimateId: id } });
      await tx.platformEstimate.update({
        where: { id },
        data: {
          issueDate: asDate(body.issueDate),
          expirationDate: asDate(body.expirationDate),
          contactName: body.contactName,
          contactEmail: body.email.toLowerCase(),
          contactPhone: body.phone || null,
          reference: body.reference || null,
          notes: body.notes || null,
          discountCents: 0,
          assignedUserId: body.assignedToId,
          lines: {
            create: lineData(body.lines, firm.taxExempt),
          },
        },
        select: { totalCents: true },
      });
      await this.discount(tx, 'estimate', id, body.discountCents);
      await this.log(tx, 'billing_estimate.updated', { type: 'billing_estimate', id }, firm.id);
      if (body.send) await this.sendEstimateIn(tx, id, firm.id, body.emailFirm);
      return this.estimateDetail(tx, id);
    });
  }

  private async sendEstimateIn(tx: TxClient, id: string, businessId: string, email: boolean) {
    const row = await tx.platformEstimate.findUniqueOrThrow({
      where: { id },
      select: { status: true, totalCents: true, number: true },
    });
    if (row.status === 'CONVERTED')
      throw billingError(409, 'ESTIMATE_CONVERTED', 'This estimate was already converted');
    if (row.status === 'DECLINED')
      throw billingError(409, 'ESTIMATE_DECIDED', 'This estimate was already decided');
    if (row.status === 'DRAFT') {
      if (row.totalCents <= 0) throw invalid('An estimate needs an amount to send');
      await tx.platformEstimate.update({ where: { id }, data: { status: 'SENT' } });
      await this.log(tx, 'billing_estimate.sent', { type: 'billing_estimate', id }, businessId, {
        detail: row.number,
      });
    }
    if (email)
      await this.log(
        tx,
        'billing_estimate.send_failed',
        { type: 'billing_estimate', id },
        businessId,
        {
          detail: 'Billing emails are not set up yet',
        },
      );
  }

  sendEstimate(id: string, body: Out<typeof SendBillingRequest>): Promise<BillingEstimate> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformEstimate.findUnique({
        where: { id },
        select: { businessId: true },
      });
      if (!row) throw notFound('Estimate');
      await this.sendEstimateIn(tx, id, row.businessId, body.email);
      return this.estimateDetail(tx, id);
    });
  }

  setEstimateStatus(
    id: string,
    body: Out<typeof SetBillingEstimateStatusRequest>,
  ): Promise<BillingEstimate> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformEstimate.findUnique({
        where: { id },
        select: { status: true, businessId: true, totalCents: true },
      });
      if (!row) throw notFound('Estimate');
      if (row.status === 'CONVERTED')
        throw billingError(409, 'ESTIMATE_CONVERTED', 'This estimate was already converted');
      if (row.status === 'DECLINED')
        throw billingError(409, 'ESTIMATE_DECIDED', 'This estimate was already decided');
      if (row.status === body.status) return this.estimateDetail(tx, id);
      if (row.status === 'DRAFT' && body.status !== 'DRAFT' && row.totalCents <= 0)
        throw invalid('An estimate needs an amount');
      // What was quoted is fixed once sent (B3), so a sent estimate never becomes a draft again.
      if (body.status === 'DRAFT')
        throw billingError(409, 'NOT_A_DRAFT', 'A sent estimate cannot go back to draft');
      // Only a decided estimate keeps a decision time: leaving Approved clears it.
      const undecided =
        row.status === 'APPROVED' && (body.status === 'SENT' || body.status === 'PENDING');
      await tx.platformEstimate.update({
        where: { id },
        data: { status: body.status, ...(undecided ? { decidedAt: null } : {}) },
      });
      await this.log(
        tx,
        'billing_estimate.status_changed',
        { type: 'billing_estimate', id },
        row.businessId,
        {
          detail: `${row.status} to ${body.status}`,
        },
      );
      return this.estimateDetail(tx, id);
    });
  }

  duplicateEstimate(id: string): Promise<BillingEstimate> {
    return this.admin.transaction(async (tx) => {
      const s = await tx.platformEstimate.findUnique({ where: { id }, include: { lines: true } });
      if (!s) throw notFound('Estimate');
      const firm = await billableFirm(tx, s.businessId);
      const settings = await this.settingsRow(tx);
      const issue = today();
      const row = await tx.platformEstimate.create({
        data: {
          businessId: firm.id,
          issueDate: asDate(issue),
          expirationDate: asDate(addDays(issue, settings?.estimateValidDays ?? 30)),
          contactName: s.contactName,
          contactEmail: s.contactEmail,
          contactPhone: s.contactPhone,
          reference: s.reference,
          notes: s.notes,
          discountCents: 0,
          assignedUserId: s.assignedUserId,
          createdByUserId: this.admin.adminUserId,
          lines: {
            create: [...s.lines]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((l) => ({
                description: l.description,
                quantity: l.quantity,
                unitCents: l.unitCents,
                taxRateBps: l.taxRateBps,
                sortOrder: l.sortOrder,
              })),
          },
        },
        select: { id: true },
      });
      await this.discount(tx, 'estimate', row.id, s.discountCents);
      await this.log(
        tx,
        'billing_estimate.duplicated',
        { type: 'billing_estimate', id: row.id },
        firm.id,
        {
          detail: `From ${s.number}`,
        },
      );
      return this.estimateDetail(tx, row.id);
    });
  }

  deleteEstimate(id: string): Promise<{ ok: true }> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformEstimate.findUnique({
        where: { id },
        select: { status: true, businessId: true, number: true },
      });
      if (!row) throw notFound('Estimate');
      if (row.status !== 'DRAFT') throw notDraft();
      await tx.platformEstimate.delete({ where: { id } });
      await this.log(
        tx,
        'billing_estimate.deleted',
        { type: 'billing_estimate', id },
        row.businessId,
        { detail: row.number },
      );
      return { ok: true as const };
    });
  }

  /** The estimate an invoice converts: the firm's, not declined and not converted yet. */
  private async convertible(tx: TxClient, estimateId: string, firmId: string) {
    const e = await tx.platformEstimate.findUnique({
      where: { id: estimateId },
      include: { convertedInvoice: { select: { id: true } } },
    });
    if (!e) throw notFound('Estimate');
    if (e.businessId !== firmId)
      throw billingError(409, 'OTHER_FIRM', 'The estimate belongs to another firm');
    if (e.status === 'CONVERTED' || e.convertedInvoice)
      throw billingError(409, 'ESTIMATE_CONVERTED', 'This estimate was already converted');
    if (e.status === 'DECLINED')
      throw billingError(409, 'ESTIMATE_DECIDED', 'This estimate was declined');
    return e;
  }

  private async markConverted(
    tx: TxClient,
    estimateId: string,
    invoiceId: string,
    businessId: string,
  ) {
    const e = await tx.platformEstimate.findUniqueOrThrow({
      where: { id: estimateId },
      select: { number: true },
    });
    await tx.platformEstimate.update({ where: { id: estimateId }, data: { status: 'CONVERTED' } });
    await this.log(
      tx,
      'billing_estimate.converted',
      { type: 'billing_estimate', id: estimateId },
      businessId,
      {
        detail: e.number,
        invoiceId,
      },
    );
  }

  convertEstimate(id: string): Promise<BillingInvoiceDetail> {
    return this.admin.transaction(async (tx) => {
      const e0 = await tx.platformEstimate.findUnique({
        where: { id },
        select: { businessId: true },
      });
      if (!e0) throw notFound('Estimate');
      const firm = await billableFirm(tx, e0.businessId);
      const e = await this.convertible(tx, id, firm.id);
      const lines = await tx.platformEstimateLine.findMany({
        where: { estimateId: id },
        orderBy: { sortOrder: 'asc' },
      });
      if (lines.length === 0) throw invalid('The estimate has no lines');
      const settings = await this.settingsRow(tx);
      const issue = today();
      const terms = firm.paymentTermDays ?? settings?.defaultPaymentTermDays ?? 30;
      const row = await tx.platformInvoice.create({
        data: {
          businessId: firm.id,
          invoiceDate: asDate(issue),
          dueDate: asDate(addDays(issue, terms)),
          billToName: firm.contactName,
          billToEmail: firm.contactEmail,
          reference: e.reference ?? e.number,
          notes: e.notes,
          discountCents: 0,
          sourceEstimateId: id,
          createdByUserId: this.admin.adminUserId,
          lines: {
            create: lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitCents: l.unitCents,
              taxRateBps: l.taxRateBps,
              sortOrder: l.sortOrder,
            })),
          },
        },
        select: { id: true, number: true },
      });
      await this.log(
        tx,
        'billing_invoice.created',
        { type: 'billing_invoice', id: row.id },
        firm.id,
        {
          detail: `${row.number} from ${e.number}`,
        },
      );
      await this.discount(tx, 'invoice', row.id, e.discountCents);
      await this.markConverted(tx, id, row.id, firm.id);
      return this.invoiceDetail(tx, row.id);
    });
  }

  // ---------- Recurring ----------

  private async filteredRecurring(
    tx: TxClient,
    q: Out<typeof BillingRecurringQuery>,
    withStatus = true,
  ) {
    const rows = await tx.platformRecurringInvoice.findMany({
      where: {
        ...(q.firmId ? { businessId: q.firmId } : {}),
        ...(withStatus && q.status?.length ? { status: { in: q.status } } : {}),
        ...(q.from || q.to
          ? {
              nextInvoiceDate: {
                ...(q.from ? { gte: asDate(q.from) } : {}),
                ...(q.to ? { lte: asDate(q.to) } : {}),
              },
            }
          : {}),
      },
      include: recurringInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: CAP,
    });
    return rows.filter((r) =>
      matches(q.search, r.business.name, r.description, templateOf(r.lineTemplate)[0]?.description),
    );
  }

  async recurringSchedules(
    query: Out<typeof BillingRecurringQuery>,
  ): Promise<BillingRecurringPage> {
    await this.runDue();
    return this.admin.transaction(async (tx) => {
      const views = (await this.filteredRecurring(tx, query)).map((r) => {
        const { history: _h, invoices: _i, ...rest } = recurringView(r);
        return rest;
      });
      const key: Record<string, (v: (typeof views)[number]) => string | number> = {
        firm: (v) => v.firmName,
        template: (v) => v.template,
        frequency: (v) => v.frequency,
        amount: (v) => v.amountCents,
        nextInvoiceDate: (v) => v.nextInvoiceDate ?? '9999',
        status: (v) => v.status,
      };
      return pageOf(
        query.sort ? sortBy(views, key[query.sort]!, query.descending) : views,
        query.page,
        query.pageSize,
      );
    });
  }

  recurringCounts(query: Out<typeof BillingRecurringQuery>): Promise<BillingRecurringCounts> {
    return this.admin.transaction(async (tx) => {
      const rows = await this.filteredRecurring(tx, query, false);
      return {
        all: rows.length,
        active: rows.filter((r) => r.status === 'ACTIVE').length,
        paused: rows.filter((r) => r.status === 'PAUSED').length,
        canceled: rows.filter((r) => r.status === 'CANCELED').length,
      };
    });
  }

  recurringSchedule(id: string): Promise<BillingRecurring> {
    return this.admin.transaction((tx) => this.recurringDetail(tx, id));
  }

  private async recurringDetail(tx: TxClient, id: string): Promise<BillingRecurring> {
    const row = await tx.platformRecurringInvoice.findUnique({
      where: { id },
      include: recurringInclude,
    });
    if (!row) throw notFound('Schedule');
    const team = await loadTeam(tx);
    const invoices = await tx.platformInvoice.findMany({
      where: { recurringId: id },
      orderBy: { invoiceDate: 'desc' },
      select: {
        id: true,
        number: true,
        invoiceDate: true,
        status: true,
        dueDate: true,
        totalCents: true,
        paidCents: true,
        creditedCents: true,
      },
    });
    const t = today();
    return recurringView(
      row,
      invoices.map((i) => ({
        id: i.id,
        number: i.number,
        issueDate: day(i.invoiceDate),
        status: invoiceStatus(i, t),
      })),
      await historyOf(tx, 'billing_recurring', id, team),
    );
  }

  private async templateFor(
    tx: TxClient,
    firmId: string,
    body: Out<typeof SaveBillingRecurringRequest>,
  ) {
    const firm = (await loadFirms(tx, firmId)).get(firmId)!;
    const settings = await this.settingsRow(tx);
    const rate = firm.taxExempt
      ? 0
      : Math.round((firm.taxPercent ?? (settings?.defaultTaxRateBps ?? 0) / 100) * 100);
    return [
      { description: body.template, quantity: 1, unitCents: body.amountCents, taxRateBps: rate },
    ];
  }

  createRecurring(body: Out<typeof SaveBillingRecurringRequest>): Promise<BillingRecurring> {
    return this.admin.transaction(async (tx) => {
      const firm = await billableFirm(tx, body.firmId);
      const row = await tx.platformRecurringInvoice.create({
        data: {
          businessId: firm.id,
          description: body.description,
          frequency: body.frequency,
          intervalDays: body.frequency === 'CUSTOM' ? body.customIntervalDays : null,
          lineTemplate: (await this.templateFor(tx, firm.id, body)) as Prisma.InputJsonValue,
          amountCents: body.amountCents,
          startDate: asDate(body.startDate),
          nextInvoiceDate: asDate(body.nextInvoiceDate),
          endDate: body.endDate ? asDate(body.endDate) : null,
          autoSend: body.autoSend,
          autoPay: body.autoPay,
          createdByUserId: this.admin.adminUserId,
        },
        select: { id: true },
      });
      await this.log(
        tx,
        'billing_recurring.created',
        { type: 'billing_recurring', id: row.id },
        firm.id,
        {
          detail: body.template,
          amountCents: body.amountCents,
        },
      );
      return this.recurringDetail(tx, row.id);
    });
  }

  updateRecurring(
    id: string,
    body: Out<typeof SaveBillingRecurringRequest>,
  ): Promise<BillingRecurring> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformRecurringInvoice.findUnique({
        where: { id },
        select: { status: true, businessId: true },
      });
      if (!row) throw notFound('Schedule');
      if (row.status === 'CANCELED')
        throw billingError(409, 'SCHEDULE_CANCELED', 'This schedule was canceled');
      if (body.firmId !== row.businessId) throw invalid('The firm of a schedule never changes');
      await tx.platformRecurringInvoice.update({
        where: { id },
        data: {
          description: body.description,
          frequency: body.frequency,
          intervalDays: body.frequency === 'CUSTOM' ? body.customIntervalDays : null,
          lineTemplate: (await this.templateFor(tx, row.businessId, body)) as Prisma.InputJsonValue,
          amountCents: body.amountCents,
          startDate: asDate(body.startDate),
          nextInvoiceDate: asDate(body.nextInvoiceDate),
          endDate: body.endDate ? asDate(body.endDate) : null,
          autoSend: body.autoSend,
          autoPay: body.autoPay,
        },
      });
      await this.log(
        tx,
        'billing_recurring.updated',
        { type: 'billing_recurring', id },
        row.businessId,
        {
          amountCents: body.amountCents,
        },
      );
      return this.recurringDetail(tx, id);
    });
  }

  setRecurringStatus(
    id: string,
    body: Out<typeof SetBillingRecurringStatusRequest>,
  ): Promise<BillingRecurring> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformRecurringInvoice.findUnique({
        where: { id },
        select: { status: true, businessId: true },
      });
      if (!row) throw notFound('Schedule');
      if (row.status === 'CANCELED')
        throw billingError(409, 'SCHEDULE_CANCELED', 'This schedule was canceled');
      if (row.status !== body.status) {
        await tx.platformRecurringInvoice.update({ where: { id }, data: { status: body.status } });
        const verb =
          body.status === 'CANCELED' ? 'canceled' : body.status === 'PAUSED' ? 'paused' : 'resumed';
        await this.log(
          tx,
          `billing_recurring.${verb}`,
          { type: 'billing_recurring', id },
          row.businessId,
        );
      }
      return this.recurringDetail(tx, id);
    });
  }

  runRecurring(id: string): Promise<BillingInvoiceDetail> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.platformRecurringInvoice.findUnique({ where: { id } });
      if (!row) throw notFound('Schedule');
      if (row.status !== 'ACTIVE')
        throw billingError(409, 'SCHEDULE_CANCELED', 'Resume the schedule first');
      const invoiceId = await this.generate(tx, row, this.admin.adminUserId);
      if (!invoiceId) throw invalid('The schedule has no more invoices to make');
      return this.invoiceDetail(tx, invoiceId);
    });
  }

  /**
   * One invoice for the schedule's next occurrence (one per occurrence, B3's unique key): its
   * template lines, the firm's terms, sent when the schedule auto-sends; then the next date moves on
   * (none past the end date). Answers the invoice id, or null when nothing is due to make.
   */
  private async generate(
    tx: TxClient,
    row: Prisma.PlatformRecurringInvoiceGetPayload<object>,
    actor: string,
  ): Promise<string | null> {
    if (!row.nextInvoiceDate) return null;
    const occurrence = day(row.nextInvoiceDate);
    if (row.endDate && occurrence > day(row.endDate)) {
      await tx.platformRecurringInvoice.update({
        where: { id: row.id },
        data: { nextInvoiceDate: null },
      });
      return null;
    }
    const firm = (await loadFirms(tx, row.businessId)).get(row.businessId);
    if (!firm?.canBill || !firm.contactEmail) return null;
    const settings = await this.settingsRow(tx);
    const terms =
      firm.paymentTermDays ?? settings?.defaultPaymentTermDays ?? BILLING_PAYMENT_TERM_DAYS.NET_30;
    const next = nextOccurrence(occurrence, row.frequency, row.intervalDays);
    const lines = templateOf(row.lineTemplate);
    const invoice = await tx.platformInvoice.create({
      data: {
        businessId: row.businessId,
        subscriptionId: row.subscriptionId,
        recurringId: row.id,
        recurringOccurrence: asDate(occurrence),
        invoiceDate: asDate(occurrence),
        dueDate: asDate(addDays(occurrence, terms)),
        periodStart: asDate(occurrence),
        periodEnd: asDate(addDays(next, -1)),
        billToName: firm.contactName,
        billToEmail: firm.contactEmail,
        notes: row.description,
        createdByUserId: actor,
        lines: {
          create: (lines.length
            ? lines
            : [
                {
                  description: row.description,
                  quantity: 1,
                  unitCents: row.amountCents,
                  taxRateBps: 0,
                },
              ]
          ).map((l, i) => ({ ...l, sortOrder: i })),
        },
      },
      select: { id: true, number: true },
    });
    const endsBefore = row.endDate && next > day(row.endDate);
    await tx.platformRecurringInvoice.update({
      where: { id: row.id },
      data: { nextInvoiceDate: endsBefore ? null : asDate(next) },
    });
    await this.log(
      tx,
      'billing_invoice.created',
      { type: 'billing_invoice', id: invoice.id },
      row.businessId,
      {
        detail: `${invoice.number} from a recurring schedule`,
      },
    );
    await this.log(
      tx,
      'billing_recurring.run',
      { type: 'billing_recurring', id: row.id },
      row.businessId,
      {
        detail: invoice.number,
        occurrence,
      },
    );
    if (row.autoSend) await this.issue(tx, invoice.id, row.businessId, true);
    return invoice.id;
  }

  /**
   * Due schedules make their invoices when invoices or schedules are read: at most every minute
   * per API task, one runner at a time (an advisory lock), at most 12 invoices per schedule per run.
   */
  async runDue(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.ranAt < RUN_EVERY_MS) return;
    this.ranAt = now;
    try {
      await this.admin.transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(4600061)) AS l`;
        const due = await tx.platformRecurringInvoice.findMany({
          where: { status: 'ACTIVE', nextInvoiceDate: { lte: asDate(today()) } },
          take: 100,
        });
        for (const schedule of due) {
          let row: typeof schedule | null = schedule;
          for (
            let n = 0;
            row?.nextInvoiceDate && day(row.nextInvoiceDate) <= today() && n < CATCH_UP;
            n++
          ) {
            const made = await this.generate(tx, row, row.createdByUserId);
            if (!made) break;
            row = await tx.platformRecurringInvoice.findUnique({ where: { id: schedule.id } });
          }
        }
      });
    } catch (error) {
      this.ranAt = 0;
      this.logger.warn(`Recurring billing did not run: ${(error as Error).name}`);
    }
  }
}
