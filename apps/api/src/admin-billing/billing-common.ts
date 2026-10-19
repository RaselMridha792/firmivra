import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  BILLING_PAYMENT_TERM_DAYS,
  type BillingAdmin,
  type BillingCreditNote,
  type BillingErrorCode,
  type BillingEstimate,
  type BillingEvent,
  type BillingFirm,
  type BillingInvoice,
  type BillingInvoiceStatus,
  type BillingLine,
  type BillingPayment,
  type BillingPaymentTerms,
  type BillingRecurring,
  type BillingSendStatus,
} from '@firmivra/types';

// Super Admin Billing (R60 on R0's B3): what the services share. Firmivra bills firms; money is
// integer cents of USD; the database numbers documents and keeps totals and money statuses.

/** The day billing dates are counted in (the platform's default zone). */
export const BILLING_ZONE = 'America/New_York';
/** Most recent documents a list or summary works over. */
export const CAP = 5000;

export const billingError = (
  status: 400 | 403 | 404 | 409 | 422,
  code: BillingErrorCode | 'VALIDATION_FAILED',
  message: string,
) => {
  const body = { code, message };
  if (status === 400) return new BadRequestException(body);
  if (status === 403) return new ForbiddenException(body);
  if (status === 404) return new NotFoundException(body);
  if (status === 422) return new UnprocessableEntityException(body);
  return new ConflictException(body);
};
export const notFound = (what: string) => billingError(404, 'NOT_FOUND', `${what} not found`);
export const invalid = (message: string) => billingError(400, 'VALIDATION_FAILED', message);
export const notDraft = () => billingError(409, 'NOT_A_DRAFT', 'Only drafts can be changed');

// ---------- Days and money ----------

/** `YYYY-MM-DD` of a stored date (Postgres `date`, read as UTC midnight). */
export const day = (d: Date) => d.toISOString().slice(0, 10);
export const dayOrNull = (d: Date | null) => (d ? day(d) : null);
/** A `YYYY-MM-DD` as a `date` column value. */
export const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const iso = (d: Date | null) => (d ? d.toISOString() : null);
/** Today in the billing zone. */
export function today(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  return parts;
}
export function addDays(s: string, days: number): string {
  const d = asDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return day(d);
}
export const daysBetween = (from: string, to: string) =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);
export const bps = (percent: number) => Math.round(percent * 100);
export const percent = (b: number) => b / 100;
/** Percent change, or null when there is nothing to compare with. */
export const trend = (current: number, previous: number) =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 100);

/** The terms a due date matches, or null for a custom one. */
export function termsOf(issue: string, due: string): BillingPaymentTerms | null {
  const days = daysBetween(issue, due);
  const found = (Object.entries(BILLING_PAYMENT_TERM_DAYS) as [BillingPaymentTerms, number][]).find(
    ([, d]) => d === days,
  );
  return found?.[0] ?? null;
}
/** The terms closest to a number of days (settings show one of the six). */
export function nearestTerms(days: number): BillingPaymentTerms {
  const all = Object.entries(BILLING_PAYMENT_TERM_DAYS) as [BillingPaymentTerms, number][];
  return all.reduce((best, cur) =>
    Math.abs(cur[1] - days) < Math.abs(best[1] - days) ? cur : best,
  )[0];
}

// ---------- Lines ----------

export interface LineRow {
  id: string;
  description: string;
  quantity: Prisma.Decimal;
  unitCents: number;
  taxRateBps: number;
  amountCents: number;
  taxCents: number;
  sortOrder: number;
}
export const lineView = (l: LineRow): BillingLine => ({
  id: l.id,
  description: l.description,
  quantity: Number(l.quantity),
  rateCents: l.unitCents,
  taxPercent: percent(l.taxRateBps),
  amountCents: l.amountCents,
  taxCents: l.taxCents,
});
export const sortLines = <T extends { sortOrder: number }>(lines: T[]) =>
  [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
/** Lines as the line tables take them (amounts and tax are the database's). */
export function lineData(
  lines: readonly {
    description: string;
    quantity: number;
    rateCents: number;
    taxPercent: number;
  }[],
  taxExempt = false,
) {
  return lines.map((l, i) => ({
    description: l.description,
    quantity: l.quantity,
    unitCents: l.rateCents,
    taxRateBps: taxExempt ? 0 : bps(l.taxPercent),
    sortOrder: i,
  }));
}

// ---------- People and firms ----------

export interface Team {
  admins: BillingAdmin[];
  nameOf(userId: string | null): string;
}
export async function loadTeam(tx: TxClient): Promise<Team> {
  const admins = await tx.platformAdmin.findMany({ select: { userId: true } });
  const users = await tx.user.findMany({
    where: { id: { in: admins.map((a) => a.userId) } },
    select: { id: true, name: true, email: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    admins: users
      .map((u) => ({ id: u.id, name: u.name, email: u.email }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    nameOf: (id) => (id ? (names.get(id) ?? 'Former team member') : 'System'),
  };
}

const firmSelect = {
  id: true,
  slug: true,
  name: true,
  status: true,
  createdAt: true,
} satisfies Prisma.BusinessSelect;

/** Every firm (or one) with its billing profile, plan and contact (else its first active owner). */
export async function loadFirms(tx: TxClient, onlyId?: string): Promise<Map<string, BillingFirm>> {
  const where = onlyId ? { id: onlyId } : {};
  const [firms, profiles, subscriptions, owners] = await Promise.all([
    tx.business.findMany({ where, select: firmSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    tx.platformFirmBillingProfile.findMany({ where: onlyId ? { businessId: onlyId } : {} }),
    tx.platformFirmSubscription.findMany({
      where: onlyId ? { businessId: onlyId } : {},
      select: {
        businessId: true,
        status: true,
        billingCycle: true,
        plan: { select: { name: true } },
      },
    }),
    tx.membership.findMany({
      where: { role: 'OWNER', status: 'ACTIVE', ...(onlyId ? { businessId: onlyId } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { businessId: true, userId: true },
    }),
  ]);
  const users = new Map(
    (
      await tx.user.findMany({
        where: { id: { in: [...new Set(owners.map((o) => o.userId))] } },
        select: { id: true, name: true, email: true, phone: true },
      })
    ).map((u) => [u.id, u]),
  );
  const ownerOf = new Map<string, { name: string; email: string; phone: string }>();
  for (const o of owners) {
    const u = users.get(o.userId);
    if (u && !ownerOf.has(o.businessId))
      ownerOf.set(o.businessId, { name: u.name, email: u.email, phone: u.phone ?? '' });
  }
  const profileOf = new Map(profiles.map((p) => [p.businessId, p]));
  const planOf = new Map(subscriptions.map((s) => [s.businessId, s]));
  const out = new Map<string, BillingFirm>();
  for (const f of firms) {
    const p = profileOf.get(f.id);
    const owner = ownerOf.get(f.id);
    const sub = planOf.get(f.id);
    out.set(f.id, {
      id: f.id,
      slug: f.slug,
      name: f.name,
      status: f.status,
      contactName: p?.billingContactName ?? owner?.name ?? f.name,
      contactEmail: p?.billingContactEmail ?? owner?.email ?? '',
      contactPhone: owner?.phone ?? '',
      paymentTermDays: p?.paymentTermDays ?? null,
      taxPercent:
        p?.taxRateBps === null || p?.taxRateBps === undefined ? null : percent(p.taxRateBps),
      taxExempt: p?.taxExempt ?? false,
      autoPay: p?.autoPay ?? false,
      notes: p?.notes ?? '',
      hasProfile: p !== undefined,
      plan: sub ? { name: sub.plan.name, status: sub.status, cycle: sub.billingCycle } : null,
      canBill: f.status === 'ACTIVE',
    });
  }
  return out;
}

/** The firm, or 404; 409 FIRM_NOT_BILLABLE when it cannot get new documents. */
export async function billableFirm(tx: TxClient, firmId: string): Promise<BillingFirm> {
  const firm = (await loadFirms(tx, firmId)).get(firmId);
  if (!firm) throw notFound('Firm');
  if (!firm.canBill)
    throw billingError(409, 'FIRM_NOT_BILLABLE', 'Only active firms can get new billing documents');
  if (!firm.contactEmail)
    throw invalid('The firm has no billing contact. Save its billing profile first.');
  return firm;
}

// ---------- History ----------

const ACTION_TEXT: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  issued: 'Issued',
  sent: 'Sent',
  send_failed: 'Email not sent',
  duplicated: 'Duplicated',
  voided: 'Voided',
  payment_recorded: 'Payment recorded',
  refunded: 'Refund recorded',
  credit_applied: 'Credit applied',
  status_changed: 'Status changed',
  converted: 'Converted to invoice',
  deleted: 'Deleted',
  run: 'Invoice generated',
  paused: 'Paused',
  resumed: 'Resumed',
  canceled: 'Canceled',
};

/** A record's history: its platform audit rows, newest first. */
export async function historyOf(
  tx: TxClient,
  entityType: string,
  entityId: string,
  team: Team,
): Promise<BillingEvent[]> {
  const rows = await tx.auditLog.findMany({
    where: { businessId: null, entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, createdAt: true, actorUserId: true, action: true, metadata: true },
  });
  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const verb = r.action.split('.').slice(1).join('.');
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      actor: team.nameOf(r.actorUserId),
      action: ACTION_TEXT[verb] ?? verb.replace(/_/g, ' '),
      detail: typeof meta.detail === 'string' ? meta.detail : '',
      amountCents: typeof meta.amountCents === 'number' ? meta.amountCents : null,
    };
  });
}

// ---------- Invoices ----------

export const invoiceInclude = {
  business: { select: { name: true } },
  lines: true,
  sourceEstimate: { select: { id: true, number: true } },
} satisfies Prisma.PlatformInvoiceInclude;
export type InvoiceRow = Prisma.PlatformInvoiceGetPayload<{ include: typeof invoiceInclude }>;

/** The page's status, from the stored one and the money (Overdue is never stored). */
export function invoiceStatus(
  row: Pick<InvoiceRow, 'status' | 'dueDate' | 'totalCents' | 'paidCents' | 'creditedCents'>,
  todayIs: string,
): BillingInvoiceStatus {
  const balance = row.totalCents - row.paidCents - row.creditedCents;
  switch (row.status) {
    case 'SENT':
    case 'PARTIALLY_PAID':
      if (balance > 0 && day(row.dueDate) < todayIs) return 'OVERDUE';
      return row.status === 'SENT' ? 'PENDING' : 'PARTIALLY_PAID';
    default:
      return row.status;
  }
}

/** The send_error recorded when a document is issued without its email. */
export const NOT_EMAILED = 'NOT_EMAILED';
export const EMAIL_NOT_SET_UP = 'EMAIL_NOT_SET_UP';
export function sendStatusOf(row: {
  sentAt: Date | null;
  sendError: string | null;
  status: string;
}): BillingSendStatus {
  if (row.status === 'DRAFT' || !row.sentAt) return 'NOT_SENT';
  if (row.sendError === NOT_EMAILED) return 'NOT_SENT';
  return row.sendError ? 'FAILED' : 'SENT';
}

export function invoiceView(row: InvoiceRow, team: Team, todayIs: string): BillingInvoice {
  const issue = day(row.invoiceDate);
  const due = day(row.dueDate);
  return {
    id: row.id,
    number: row.number,
    firmId: row.businessId,
    firmName: row.business.name,
    billToName: row.billToName,
    billToEmail: row.billToEmail,
    currency: 'USD',
    paymentTerms: termsOf(issue, due),
    issueDate: issue,
    dueDate: due,
    periodStart: dayOrNull(row.periodStart),
    periodEnd: dayOrNull(row.periodEnd),
    reference: row.reference ?? '',
    notes: row.notes ?? '',
    internalNote: row.internalNote ?? '',
    lines: sortLines(row.lines).map(lineView),
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    taxCents: row.taxCents,
    totalCents: row.totalCents,
    paidCents: row.paidCents,
    refundedCents: row.refundedCents,
    creditedCents: row.creditedCents,
    balanceCents: Math.max(0, row.totalCents - row.paidCents - row.creditedCents),
    status: invoiceStatus(row, todayIs),
    allowOnlinePayment: row.allowOnlinePayment,
    recurringId: row.recurringId,
    estimateId: row.sourceEstimate?.id ?? null,
    estimateNumber: row.sourceEstimate?.number ?? null,
    sentAt: iso(row.status === 'DRAFT' ? null : row.sentAt),
    sendStatus: sendStatusOf(row),
    sendError: row.sendError === NOT_EMAILED ? null : row.sendError,
    paidAt: iso(row.paidAt),
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdBy: team.nameOf(row.createdByUserId),
  };
}

// ---------- Payments ----------

export const paymentInclude = {
  refunds: { orderBy: { createdAt: 'asc' } },
  invoice: { select: { number: true, billToName: true, business: { select: { name: true } } } },
} satisfies Prisma.PlatformPaymentInclude;
export type PaymentRow = Prisma.PlatformPaymentGetPayload<{ include: typeof paymentInclude }>;

const REFUND_TAG = /^\[(FULL|PARTIAL)\] /;
export function paymentView(p: PaymentRow, team: Team): BillingPayment {
  const held = p.refunds
    .filter((r) => r.status !== 'FAILED')
    .reduce((s, r) => s + r.amountCents, 0);
  const refundable =
    p.status === 'COMPLETED' || p.status === 'PARTIALLY_REFUNDED'
      ? Math.max(0, p.amountCents - held)
      : 0;
  return {
    id: p.id,
    invoiceId: p.invoiceId,
    invoiceNumber: p.invoice.number,
    firmId: p.businessId,
    firmName: p.invoice.business.name,
    billToName: p.invoice.billToName,
    currency: 'USD',
    amountCents: p.amountCents,
    paidOn: day(p.paidOn),
    method: p.method,
    reference: p.reference ?? '',
    status: p.status,
    refundedCents: p.refundedCents,
    refundableCents: refundable,
    refunds: p.refunds.map((r) => {
      const tag = REFUND_TAG.exec(r.internalNote ?? '');
      return {
        id: r.id,
        paymentId: r.paymentId,
        amountCents: r.amountCents,
        type:
          (tag?.[1] as 'FULL' | 'PARTIAL' | undefined) ??
          (r.amountCents >= p.amountCents ? 'FULL' : 'PARTIAL'),
        status: r.status,
        reason: r.reason,
        notes: (r.internalNote ?? '').replace(REFUND_TAG, ''),
        method: 'ORIGINAL' as const,
        at: (r.completedAt ?? r.createdAt).toISOString(),
        by: team.nameOf(r.requestedByUserId),
      };
    }),
    notes: p.notes ?? '',
    failureReason: p.failureReason,
    recordedBy: team.nameOf(p.recordedByUserId),
    recordedAt: p.createdAt.toISOString(),
    receiptSentAt: iso(p.receiptSentAt),
  };
}
/** A refund's internal note keeps whether it was full or partial (B3 stores no type). */
export const refundNote = (type: 'FULL' | 'PARTIAL', notes: string) =>
  `[${type}] ${notes}`.trimEnd();

// ---------- Estimates ----------

export const estimateInclude = {
  business: { select: { name: true } },
  lines: true,
  convertedInvoice: { select: { id: true, number: true } },
} satisfies Prisma.PlatformEstimateInclude;
export type EstimateRow = Prisma.PlatformEstimateGetPayload<{ include: typeof estimateInclude }>;

export function estimateView(
  e: EstimateRow,
  team: Team,
  todayIs: string,
  history: BillingEvent[] = [],
): BillingEstimate {
  const expired =
    (e.status === 'SENT' || e.status === 'PENDING') && day(e.expirationDate) < todayIs;
  return {
    id: e.id,
    number: e.number,
    firmId: e.businessId,
    firmName: e.business.name,
    contactName: e.contactName,
    email: e.contactEmail,
    phone: e.contactPhone ?? '',
    currency: 'USD',
    issueDate: day(e.issueDate),
    expirationDate: day(e.expirationDate),
    reference: e.reference ?? '',
    lines: sortLines(e.lines).map(lineView),
    subtotalCents: e.subtotalCents,
    discountCents: e.discountCents,
    taxCents: e.taxCents,
    totalCents: e.totalCents,
    notes: e.notes ?? '',
    status: expired ? 'EXPIRED' : e.status,
    assignedToId: e.assignedUserId,
    assignedToName: e.assignedUserId ? team.nameOf(e.assignedUserId) : null,
    convertedInvoiceId: e.convertedInvoice?.id ?? null,
    convertedInvoiceNumber: e.convertedInvoice?.number ?? null,
    sentAt: iso(e.sentAt),
    decidedAt: iso(e.decidedAt),
    createdBy: team.nameOf(e.createdByUserId),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    history,
  };
}

// ---------- Credit notes ----------

export const ADJUSTMENT_LINE = 'Credit adjustment';
export const creditInclude = {
  business: { select: { name: true } },
  lines: true,
  relatedInvoice: { select: { id: true, number: true } },
  applications: {
    orderBy: { createdAt: 'asc' },
    include: { invoice: { select: { number: true } } },
  },
} satisfies Prisma.PlatformCreditNoteInclude;
export type CreditRow = Prisma.PlatformCreditNoteGetPayload<{ include: typeof creditInclude }>;

export function creditView(
  c: CreditRow,
  team: Team,
  history: BillingEvent[] = [],
): BillingCreditNote {
  const lines = sortLines(c.lines);
  const adjustment = lines.length === 1 && lines[0]!.description === ADJUSTMENT_LINE;
  const reason = c.reason as BillingCreditNote['reason'];
  return {
    id: c.id,
    number: c.number,
    firmId: c.businessId,
    firmName: c.business.name,
    invoiceId: c.relatedInvoice?.id ?? null,
    invoiceNumber: c.relatedInvoice?.number ?? null,
    currency: 'USD',
    date: day(c.issueDate),
    reason: [
      'SERVICE_ISSUE',
      'BILLING_ERROR',
      'DUPLICATE_CHARGE',
      'CANCELLATION',
      'PRICE_ADJUSTMENT',
      'GOODWILL',
    ].includes(reason)
      ? reason
      : 'OTHER',
    method: adjustment ? 'ADJUSTMENT' : 'LINE_ITEMS',
    lines: lines.map(lineView),
    subtotalCents: c.subtotalCents,
    taxCents: c.taxCents,
    totalCents: c.totalCents,
    appliedCents: c.appliedCents,
    refundedCents: c.refundedCents,
    remainingCents: Math.max(0, c.totalCents - c.appliedCents - c.refundedCents),
    internalNote: c.internalNote ?? '',
    customerNote: c.customerNote ?? '',
    status: c.status,
    issuedAt: iso(c.issuedAt),
    voidedAt: iso(c.voidedAt),
    voidReason: c.voidReason,
    applications: c.applications.map((a) => ({
      id: a.id,
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoice.number,
      amountCents: a.amountCents,
      at: a.createdAt.toISOString(),
      by: team.nameOf(a.appliedByUserId),
    })),
    createdBy: team.nameOf(c.createdByUserId),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    history,
  };
}

// ---------- Recurring ----------

export const recurringInclude = {
  business: { select: { name: true } },
} satisfies Prisma.PlatformRecurringInvoiceInclude;
export type RecurringRow = Prisma.PlatformRecurringInvoiceGetPayload<{
  include: typeof recurringInclude;
}>;

/** The stored line template: the lines each generated invoice gets. */
export interface TemplateLine {
  description: string;
  quantity: number;
  unitCents: number;
  taxRateBps: number;
}
export function templateOf(json: Prisma.JsonValue): TemplateLine[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((l) => {
    const o = l as Record<string, unknown> | null;
    if (!o || typeof o.description !== 'string' || typeof o.unitCents !== 'number') return [];
    return [
      {
        description: o.description,
        quantity: typeof o.quantity === 'number' ? o.quantity : 1,
        unitCents: o.unitCents,
        taxRateBps: typeof o.taxRateBps === 'number' ? o.taxRateBps : 0,
      },
    ];
  });
}

export function recurringView(
  r: RecurringRow,
  invoices: BillingRecurring['invoices'] = [],
  history: BillingEvent[] = [],
): BillingRecurring {
  return {
    id: r.id,
    firmId: r.businessId,
    firmName: r.business.name,
    template: templateOf(r.lineTemplate)[0]?.description ?? r.description,
    description: r.description,
    frequency: r.frequency,
    customIntervalDays: r.intervalDays,
    amountCents: r.amountCents,
    currency: 'USD',
    startDate: day(r.startDate),
    nextInvoiceDate: dayOrNull(r.nextInvoiceDate),
    endDate: dayOrNull(r.endDate),
    autoSend: r.autoSend,
    autoPay: r.autoPay,
    status: r.status,
    invoices,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    history,
  };
}

/** The occurrence after `from` for a schedule's frequency. */
export function nextOccurrence(
  from: string,
  frequency: RecurringRow['frequency'],
  intervalDays: number | null,
): string {
  const d = asDate(from);
  const months = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 } as const;
  if (frequency === 'WEEKLY') return addDays(from, 7);
  if (frequency === 'CUSTOM') return addDays(from, Math.max(1, intervalDays ?? 30));
  const m = months[frequency];
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return day(target);
}

// ---------- Lists ----------

export function pageOf<T>(rows: T[], page = 1, pageSize = 10) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(Math.max(1, page), pageCount);
  return {
    items: rows.slice((p - 1) * pageSize, p * pageSize),
    total: rows.length,
    page: p,
    pageSize,
    pageCount,
  };
}

export function sortBy<T>(rows: T[], key: (t: T) => string | number, descending = false): T[] {
  const sorted = [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y));
  });
  return descending ? sorted.reverse() : sorted;
}

export const matches = (search: string | undefined, ...fields: (string | null | undefined)[]) => {
  const words = (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
};
export const inRange = (d: string, from?: string, to?: string) =>
  (!from || d >= from) && (!to || d <= to);
