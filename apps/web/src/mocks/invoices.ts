import {
  ApiRequestError,
  CancelInvoiceRequest,
  CreateInvoiceRequest,
  type FirmInvoicePayment,
  Invoice,
  InvoiceId,
  type InvoiceListItem,
  type InvoiceRefund,
  type InvoicesClient,
  type InvoiceStatus,
  isInvoiceOverdue,
  lineAmountCents,
  ListInvoicesQuery,
  ListMyInvoicesQuery,
  type MemberRef,
  MY_INVOICE_SECTIONS,
  MY_INVOICE_VIEWS,
  type MyInvoice,
  type MyInvoiceDetail,
  type MyInvoicesClient,
  myInvoiceStatus,
  type OfflinePayment,
  OfflinePaymentId,
  parseInput,
  PaymentId,
  RecordOfflinePaymentRequest,
  RefundPaymentRequest,
  UpdateInvoiceRequest,
  VoidOfflinePaymentRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import { clientFixtures, firstClientId, type MockFirmRole, mockStaff } from './clients';
import { engagementFixtures } from './engagements';
import { mockOffset } from './tasks';

/**
 * Mock data for `api.invoices` (firm) and `api.myInvoices(slug)` (portal), R7. Synthetic data
 * only, on R10's mock clients and services. Same input checks, rules, error codes and error order
 * (403, 400, 404, 409) as the API. Amounts are computed here as the database computes them.
 * `pay` answers a `mock:` checkout link that opens nothing and marks nothing paid; `refund` adds a
 * PENDING refund that stays pending (no Stripe webhook here). `recordPayment` and `voidPayment`
 * keep check and cash payments as the database does (PAID once covered, reopened by a void). Dates follow today, so every client
 * status shows. Nothing is built until the first call.
 */
const DAY = 86_400_000;
/** The mock firm's time zone: "today", Due Soon and overdue follow its calendar, as in the API. */
const FIRM_TIME_ZONE = 'America/New_York';
/** The firm's calendar date of an instant. */
const dateOf = (instant: string | Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: FIRM_TIME_ZONE }).format(new Date(instant));
const today = () => dateOf(new Date());
/** A calendar date `days` after (or before) `date`. */
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** Midday in the firm's time zone on that date (EDT; close enough for a mock). */
const noonOn = (date: string) => `${date}T16:00:00.000Z`;
const now = () => new Date().toISOString();
const invoiceId = (n: number) => `0199b6e1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const lineId = (n: number) => `0199b6e2-0000-7000-8000-${String(n).padStart(12, '0')}`;
const paymentId = (n: number) => `0199b6e3-0000-7000-8000-${String(n).padStart(12, '0')}`;
const refundId = (n: number) => `0199b6e4-0000-7000-8000-${String(n).padStart(12, '0')}`;
const offlineId = (n: number) => `0199b6e5-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** A payment as the database keeps it; what is refunded and refundable is computed from it. */
type Payment = Omit<FirmInvoicePayment, 'refundedCents' | 'refundableCents'>;
/** An invoice as the database keeps it: amounts and the client's view are computed from it. */
interface Row {
  id: string;
  number: string;
  clientId: string;
  engagementId: string | null;
  status: InvoiceStatus;
  lines: { id: string; description: string; quantity: number; unitAmountCents: number }[];
  discountCents: number;
  scheduledFor: string | null;
  dueOn: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  createdBy: MemberRef | null;
  createdAt: string;
  updatedAt: string;
  /** Submitted payments, newest first (checkouts the client left are never kept). */
  payments: Payment[];
  /** Check and cash payments, voided ones included, newest first. */
  offline: OfflinePayment[];
}

let fixtures: { rows: readonly Row[]; invoices: readonly Invoice[] } | undefined;

/**
 * The firm's invoices. Client 1 (the signed-in portal client) has one of each: Pending, Due Soon
 * (one past due), one with a payment processing, Upcoming, four Paid (one partly refunded, one
 * after a failed bank payment, one by check with a voided cash payment), Canceled, one canceled
 * while Upcoming (still shown as Canceled), plus a draft and a draft canceled before it was sent
 * (neither reaches the portal). Client 2 (Sam Staff's) and client 3 (not Sam's) have one open
 * invoice each.
 */
function built() {
  if (fixtures) return fixtures;
  const day = (n: number) => addDays(today(), n);
  const service = (n: number) => engagementFixtures()[n - 1]!.id;
  const client = (n: number) => clientFixtures()[n - 1]!.id;
  let nextLine = 1;
  const lines = (...items: [description: string, quantity: number, unitAmountCents: number][]) =>
    items.map(([description, quantity, unitAmountCents]) => ({
      id: lineId(nextLine++),
      description,
      quantity,
      unitAmountCents,
    }));
  const paid = (n: number, amountCents: number, on: string, refunds: InvoiceRefund[] = []) => ({
    id: paymentId(n),
    amountCents,
    currency: 'usd',
    status: 'SUCCEEDED' as const,
    paidAt: noonOn(on),
    createdAt: noonOn(on),
    failureCode: null,
    refunds,
  });
  const row = (n: number, data: Partial<Row> & Pick<Row, 'number' | 'lines'>): Row => {
    const createdAt = data.issuedAt ?? noonOn(day(-1));
    return {
      id: invoiceId(n),
      clientId: firstClientId,
      engagementId: null,
      status: 'OPEN',
      discountCents: 0,
      scheduledFor: null,
      dueOn: null,
      issuedAt: null,
      paidAt: null,
      canceledAt: null,
      cancelReason: null,
      createdBy: mockMe,
      createdAt,
      updatedAt: createdAt,
      payments: [],
      offline: [],
      ...data,
    };
  };
  const rows = [
    row(1, {
      number: 'INV-2026-0101',
      engagementId: service(2),
      lines: lines(['Monthly bookkeeping, September', 1, 30_000]),
      issuedAt: noonOn(day(-20)),
      dueOn: day(20),
    }),
    row(2, {
      number: 'INV-2026-0102',
      engagementId: service(1),
      lines: lines(
        ['Individual tax preparation (Form 1040)', 1, 40_000],
        ['Schedule C, business income', 1, 5_000],
      ),
      issuedAt: noonOn(day(-10)),
      dueOn: day(4),
    }),
    row(3, {
      number: 'INV-2026-0098',
      lines: lines(['Tax planning consultation (hours)', 1.5, 15_000]),
      issuedAt: noonOn(day(-45)),
      dueOn: day(-15),
    }),
    row(4, {
      number: 'INV-2026-0100',
      engagementId: service(2),
      lines: lines(['Catch-up bookkeeping, July and August', 2, 15_000]),
      issuedAt: noonOn(day(-12)),
      dueOn: day(18),
      payments: [
        {
          id: paymentId(4),
          amountCents: 30_000,
          currency: 'usd',
          status: 'PENDING',
          paidAt: null,
          createdAt: noonOn(day(-1)),
          failureCode: null,
          refunds: [],
        },
      ],
    }),
    row(5, {
      number: 'INV-2026-0106',
      engagementId: service(2),
      status: 'SCHEDULED',
      lines: lines(['Monthly bookkeeping, October', 1, 30_000]),
      scheduledFor: day(12),
      dueOn: day(26),
      createdAt: noonOn(day(-2)),
      updatedAt: noonOn(day(-2)),
    }),
    row(6, {
      number: 'INV-2026-0081',
      engagementId: service(3),
      status: 'PAID',
      lines: lines(['Individual tax preparation (Form 1040)', 1, 25_000]),
      issuedAt: noonOn('2026-03-01'),
      dueOn: '2026-03-15',
      paidAt: noonOn('2026-03-10'),
      payments: [paid(6, 25_000, '2026-03-10')],
    }),
    row(7, {
      number: 'INV-2026-0012',
      engagementId: service(2),
      status: 'PAID',
      lines: lines(['Bookkeeping setup', 1, 15_000]),
      issuedAt: noonOn('2026-01-10'),
      dueOn: '2026-01-25',
      paidAt: noonOn('2026-01-20'),
      // Partly refunded: one confirmed refund.
      payments: [
        paid(7, 15_000, '2026-01-20', [
          {
            id: refundId(1),
            amountCents: 2_500,
            currency: 'usd',
            status: 'SUCCEEDED',
            refundedAt: noonOn('2026-02-03'),
            createdAt: noonOn('2026-02-02'),
          },
        ]),
      ],
    }),
    row(8, {
      number: 'INV-2025-0072',
      status: 'PAID',
      lines: lines(['Business formation (LLC filing and EIN)', 1, 27_500]),
      issuedAt: noonOn('2025-12-05'),
      dueOn: '2025-12-20',
      paidAt: noonOn('2025-12-15'),
      payments: [
        paid(9, 27_500, '2025-12-15'),
        {
          id: paymentId(8),
          amountCents: 27_500,
          currency: 'usd',
          status: 'FAILED',
          paidAt: null,
          createdAt: noonOn('2025-12-08'),
          failureCode: 'insufficient_funds',
          refunds: [],
        },
      ],
    }),
    row(9, {
      number: 'INV-2026-0090',
      engagementId: service(4),
      status: 'CANCELED',
      lines: lines(['Payroll processing, September', 2, 7_500]),
      issuedAt: noonOn('2026-09-01'),
      dueOn: '2026-09-15',
      canceledAt: noonOn('2026-09-05'),
      cancelReason: 'Payroll service ended; billed in error.',
    }),
    row(10, {
      number: 'INV-2026-0107',
      engagementId: service(1),
      status: 'DRAFT',
      lines: lines(['Amended return (Form 1040-X)', 1, 20_000]),
      dueOn: day(30),
    }),
    row(11, {
      number: 'INV-2026-0103',
      status: 'CANCELED',
      lines: lines(['Notary fee', 1, 2_500]),
      dueOn: day(10),
      canceledAt: noonOn(day(-3)),
      cancelReason: 'Created by mistake.',
      createdAt: noonOn(day(-4)),
      updatedAt: noonOn(day(-3)),
    }),
    // Canceled while SCHEDULED: the client saw it as Upcoming, so it stays as Canceled.
    row(14, {
      number: 'INV-2026-0097',
      engagementId: service(2),
      status: 'CANCELED',
      lines: lines(['Monthly bookkeeping, November (prepaid)', 1, 30_000]),
      scheduledFor: day(5),
      dueOn: day(19),
      canceledAt: noonOn(day(-2)),
      cancelReason: 'Client moved to quarterly billing.',
      createdAt: noonOn(day(-6)),
      updatedAt: noonOn(day(-2)),
    }),
    // Paid by check; a cash payment recorded by mistake was voided.
    row(15, {
      number: 'INV-2026-0095',
      engagementId: service(1),
      status: 'PAID',
      lines: lines(['Prior-year return review', 1, 12_000]),
      issuedAt: noonOn(day(-30)),
      dueOn: day(-16),
      paidAt: noonOn(day(-20)),
      offline: [
        {
          id: offlineId(2),
          method: 'CHECK',
          amountCents: 12_000,
          currency: 'usd',
          reference: '1042',
          receivedOn: day(-20),
          note: null,
          recordedBy: mockMe,
          recordedAt: noonOn(day(-20)),
          voidedAt: null,
          voidedBy: null,
          voidReason: null,
        },
        {
          id: offlineId(1),
          method: 'CASH',
          amountCents: 12_000,
          currency: 'usd',
          reference: null,
          receivedOn: day(-21),
          note: null,
          recordedBy: mockMe,
          recordedAt: noonOn(day(-21)),
          voidedAt: noonOn(day(-21)),
          voidedBy: mockMe,
          voidReason: 'Recorded on the wrong invoice.',
        },
      ],
    }),
    row(12, {
      number: 'INV-2026-0104',
      clientId: client(2),
      lines: lines(['Quarterly tax planning, Q3', 1, 20_000]),
      issuedAt: noonOn(day(-5)),
      dueOn: day(25),
    }),
    row(13, {
      number: 'INV-2026-0105',
      clientId: client(3),
      lines: lines(['Individual tax preparation (Form 1040)', 1, 35_000]),
      issuedAt: noonOn(day(-3)),
      dueOn: day(27),
    }),
  ];
  // Parsed, so a fixture that breaks the contract fails on first use.
  const invoices = rows.map((r) => Invoice.parse(toInvoice(r, today())));
  fixtures = { rows, invoices };
  return fixtures;
}

/** The fixtures as the firm sees them. Built on first use: importing this file runs nothing. */
export function invoiceFixtures(): readonly Invoice[] {
  return built().invoices;
}

const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
const page = <T>(items: T[], query: { cursor?: string | undefined; limit: number }) => {
  const start = mockOffset(query.cursor);
  const next = start + query.limit;
  return { items: items.slice(start, next), nextCursor: next < items.length ? String(next) : null };
};
const processing = (r: Row) => r.payments.some((p) => p.status === 'PENDING');
/** Confirmed refunds of a payment. */
const refunded = (p: Payment) =>
  sum(p.refunds.filter((x) => x.status === 'SUCCEEDED').map((x) => x.amountCents));
/** What a new refund may take: the amount less refunds that are not FAILED, while SUCCEEDED. */
const refundable = (p: Payment) =>
  p.status === 'SUCCEEDED'
    ? p.amountCents - sum(p.refunds.filter((x) => x.status !== 'FAILED').map((x) => x.amountCents))
    : 0;
/** The firm's view of a payment. */
const firmPayment = (p: Payment): FirmInvoicePayment => ({
  ...p,
  refundedCents: refunded(p),
  refundableCents: refundable(p),
});

const live = (r: Row) => r.offline.filter((o) => o.voidedAt === null);
/**
 * The amounts the database keeps, and what is still to pay: the money received counts Stripe
 * payments that succeeded (refunded ones in full) and live offline payments, as the database's
 * app_invoice_paid_cents does, so a refund never makes money owed again.
 */
function figures(r: Row) {
  const lines = r.lines.map((l) => ({
    ...l,
    amountCents: lineAmountCents(l.quantity, l.unitAmountCents),
  }));
  const subtotalCents = sum(lines.map((l) => l.amountCents));
  const totalCents = subtotalCents - r.discountCents;
  const received = r.payments.filter((p) => p.status === 'SUCCEEDED' || p.status === 'REFUNDED');
  const amountPaidCents =
    sum(received.map((p) => p.amountCents)) + sum(live(r).map((o) => o.amountCents));
  const refundedCents = sum(received.map(refunded));
  const unpaid = r.status === 'DRAFT' || r.status === 'SCHEDULED' || r.status === 'OPEN';
  return {
    lines,
    subtotalCents,
    discountCents: r.discountCents,
    totalCents,
    amountPaidCents,
    refundedCents,
    balanceDueCents: unpaid ? Math.max(0, totalCents - amountPaidCents) : 0,
  };
}

const serviceOf = (r: Row) => {
  const e = engagementFixtures().find((x) => x.id === r.engagementId);
  return e ? { id: e.id, title: e.title } : null;
};
const titleOf = (r: Row) => serviceOf(r)?.title ?? r.lines[0]?.description ?? '';

function toListItem(r: Row, day: string): InvoiceListItem {
  const c = clientFixtures().find((x) => x.id === r.clientId);
  const f = figures(r);
  return {
    id: r.id,
    number: r.number,
    client: { id: r.clientId, displayName: c?.displayName ?? '' },
    service: serviceOf(r),
    title: titleOf(r),
    status: r.status,
    clientStatus: myInvoiceStatus(r, day),
    currency: 'usd',
    totalCents: f.totalCents,
    balanceDueCents: f.balanceDueCents,
    scheduledFor: r.scheduledFor,
    dueOn: r.dueOn,
    overdue: isInvoiceOverdue(r, day),
    issuedAt: r.issuedAt,
    paidAt: r.paidAt,
    canceledAt: r.canceledAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toInvoice(r: Row, day: string): Invoice {
  const { totalCents: _t, balanceDueCents: _b, ...f } = figures(r);
  return copy({
    ...toListItem(r, day),
    ...f,
    payments: r.payments.map(firmPayment),
    offlinePayments: r.offline,
    cancelReason: r.cancelReason,
    createdBy: r.createdBy,
  });
}

/** The client's view; only for invoices the portal shows. */
function toMine(r: Row, day: string, paymentsEnabled: boolean): MyInvoice {
  const status = myInvoiceStatus(r, day);
  if (!status) throw notFound();
  const f = figures(r);
  const paymentProcessing = processing(r);
  return {
    id: r.id,
    number: r.number,
    service: serviceOf(r),
    title: titleOf(r),
    status,
    section: MY_INVOICE_SECTIONS.CURRENT.includes(status) ? 'CURRENT' : 'PAST',
    currency: 'usd',
    totalCents: f.totalCents,
    balanceDueCents: f.balanceDueCents,
    issuedOn: r.issuedAt ? dateOf(r.issuedAt) : (r.scheduledFor ?? day),
    dueOn: r.dueOn,
    overdue: isInvoiceOverdue(r, day),
    paidAt: r.paidAt,
    canceledAt: r.canceledAt,
    paymentProcessing,
    canPay: r.status === 'OPEN' && f.balanceDueCents > 0 && !paymentProcessing && paymentsEnabled,
  };
}

function toMyDetail(r: Row, day: string, paymentsEnabled: boolean): MyInvoiceDetail {
  const { totalCents: _t, balanceDueCents: _b, ...f } = figures(r);
  return copy({
    ...toMine(r, day, paymentsEnabled),
    ...f,
    // No failure codes or refund rows for the client: the page says a payment failed and offers
    // Pay again, and shows what was refunded.
    payments: r.payments.map((p) => {
      const { failureCode: _f, refunds: _r, ...rest } = p;
      return { ...rest, refundedCents: refunded(p) };
    }),
    // Live ones only: method, amount and day (no reference, note or who recorded it).
    offlinePayments: live(r).map(({ id, method, amountCents, currency, receivedOn }) => ({
      id,
      method,
      amountCents,
      currency,
      receivedOn,
    })),
  });
}

/** Each mock keeps its own rows; callers always get copies, like a real API response. */
function store() {
  const rows: Row[] = built().rows.map((r) => structuredClone(r));
  let next = 108;
  let nextLine = 1000;
  let nextRefund = 100;
  let nextOffline = 100;
  return {
    rows,
    refundId: () => refundId(nextRefund++),
    offlineId: () => offlineId(nextOffline++),
    /** `{invoiceId}` of each offline payment by its idempotency key (keys are per firm). */
    offlineKeys: new Map<string, string>(),
    /** `{paymentId}:{idempotencyKey}` of the refunds made through this mock (keys are per payment). */
    refunds: new Set<string>(),
    /** The API numbers invoices; the mock goes on from the fixtures' numbers. */
    add: (data: Omit<Row, 'id' | 'number'>): Row => {
      const n = next++;
      const r = { ...data, id: invoiceId(n), number: `INV-${today().slice(0, 4)}-0${n}` };
      rows.unshift(r);
      return r;
    },
    /** A draft's fields from a parsed create or update body. */
    draft: (b: ReturnType<typeof UpdateInvoiceRequest.parse>) => ({
      lines: b.lines.map((l) => ({ ...l, id: lineId(nextLine++) })),
      discountCents: b.discountCents,
      dueOn: b.dueOn,
      scheduledFor: b.scheduledFor ?? null,
    }),
  };
}

/**
 * An in-memory `api.invoices`. `role: 'STAFF'` is Sam Staff, as in mocks/clients.ts: only the
 * invoices of clients 1 and 2 (assigned to Sam) exist for him, and every change is 403.
 * `paymentsEnabled: false` is a firm whose Stripe account cannot take payments yet.
 */
export function createInvoicesMock(
  options: { role?: MockFirmRole; paymentsEnabled?: boolean } = {},
): InvoicesClient {
  const s = store();
  const staffOnly = options.role === 'STAFF';
  const paymentsEnabled = options.paymentsEnabled ?? true;
  const forbidden = () => fail(403, 'FORBIDDEN', 'This action is not permitted');
  /** Owner and Admin only, before any other check (the API's guard runs first). */
  const manager = () => {
    if (staffOnly) throw forbidden();
  };
  /** The client of the firm the user may reach: 404 for an unknown one or (Staff) not theirs. */
  const reachable = (clientId: string) => {
    const c = clientFixtures().find((x) => x.id === clientId);
    if (!c || (staffOnly && c.assignedTo?.userId !== mockStaff.userId)) throw notFound();
    return c;
  };
  const visible = (r: Row) =>
    !staffOnly ||
    clientFixtures().some((c) => c.id === r.clientId && c.assignedTo?.userId === mockStaff.userId);
  const find = (id: string) => {
    const r = s.rows.find((x) => x.id === id && visible(x));
    if (!r) throw notFound();
    return r;
  };
  /** One of this client's services, or 404. */
  const engagementOf = (clientId: string, engagementId: string | null | undefined) => {
    if (!engagementId) return null;
    const e = engagementFixtures().find((x) => x.id === engagementId && x.clientId === clientId);
    if (!e) throw notFound();
    return e.id;
  };
  const notDraft = () => fail(409, 'NOT_DRAFT', 'Only a draft can be changed or sent');
  const archived = () => fail(409, 'CLIENT_ARCHIVED', 'Restore the client first');
  const isArchived = (r: Row) => !!clientFixtures().find((c) => c.id === r.clientId)?.archivedAt;

  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListInvoicesQuery, query);
      if (q.clientId) reachable(q.clientId);
      const day = today();
      const search = q.search?.toLowerCase();
      const found = s.rows
        .filter(visible)
        .filter((r) => !q.clientId || r.clientId === q.clientId)
        .filter((r) => !q.status || r.status === q.status)
        .map((r) => toListItem(r, day))
        .filter(
          (i) =>
            !search ||
            i.number.toLowerCase().includes(search) ||
            i.client.displayName.toLowerCase().includes(search),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number.localeCompare(a.number));
      return copy({ ...page(found, q), paymentsEnabled });
    },
    get: async (id) => {
      await mockDelay();
      return toInvoice(find(parseInput(InvoiceId, id)), today());
    },
    create: async (body) => {
      await mockDelay();
      manager();
      const b = parseInput(CreateInvoiceRequest, body);
      const client = reachable(b.clientId);
      const engagementId = engagementOf(client.id, b.engagementId);
      if (client.archivedAt) throw archived();
      const at = now();
      const r = s.add({
        clientId: client.id,
        engagementId,
        status: 'DRAFT',
        ...s.draft(b),
        issuedAt: null,
        paidAt: null,
        canceledAt: null,
        cancelReason: null,
        createdBy: mockMe,
        createdAt: at,
        updatedAt: at,
        payments: [],
        offline: [],
      });
      return toInvoice(r, today());
    },
    update: async (id, body) => {
      await mockDelay();
      manager();
      const key = parseInput(InvoiceId, id);
      const b = parseInput(UpdateInvoiceRequest, body);
      const r = find(key);
      const engagementId = engagementOf(r.clientId, b.engagementId);
      if (r.status !== 'DRAFT') throw notDraft();
      if (isArchived(r)) throw archived();
      const change: Partial<Row> = { ...s.draft(b), engagementId, updatedAt: now() };
      Object.assign(r, change);
      return toInvoice(r, today());
    },
    send: async (id) => {
      await mockDelay();
      manager();
      const r = find(parseInput(InvoiceId, id));
      if (r.status !== 'DRAFT') throw notDraft();
      if (isArchived(r)) throw archived();
      if (figures(r).totalCents <= 0) {
        throw fail(409, 'ZERO_TOTAL', 'There is nothing to pay on this invoice; cancel it instead');
      }
      const day = today();
      const later = r.scheduledFor !== null && r.scheduledFor > day;
      if (!later && r.dueOn !== null && r.dueOn < day) {
        throw fail(409, 'DUE_DATE_PASSED', 'The due date has passed; change it first');
      }
      const at = now();
      // A scheduled one opens on its day (the API's daily job); otherwise it opens now.
      const change: Partial<Row> = later
        ? { status: 'SCHEDULED', updatedAt: at }
        : { status: 'OPEN', issuedAt: at, scheduledFor: null, updatedAt: at };
      Object.assign(r, change);
      return toInvoice(r, day);
    },
    cancel: async (id, body) => {
      await mockDelay();
      manager();
      const key = parseInput(InvoiceId, id);
      const { reason } = parseInput(CancelInvoiceRequest, body);
      const r = find(key);
      if (r.status === 'PAID' || r.status === 'CANCELED') {
        throw fail(409, 'INVOICE_CLOSED', 'This invoice is paid or canceled');
      }
      if (processing(r)) {
        throw fail(409, 'PAYMENT_IN_PROGRESS', 'A payment for this invoice is being processed');
      }
      if (live(r).length > 0 || r.payments.some((p) => p.status === 'SUCCEEDED')) {
        throw fail(409, 'HAS_PAYMENTS', "Void or refund this invoice's payments first");
      }
      const at = now();
      const change: Partial<Row> = {
        status: 'CANCELED',
        canceledAt: at,
        cancelReason: reason,
        // A draft was never shown, so it never reaches the portal; a scheduled one keeps its day
        // (the client saw it as Upcoming) and stays in their history as Canceled.
        ...(r.status === 'DRAFT' ? { scheduledFor: null } : {}),
        updatedAt: at,
      };
      Object.assign(r, change);
      return toInvoice(r, today());
    },
    refund: async (id, payment, body) => {
      await mockDelay();
      manager();
      const key = parseInput(InvoiceId, id);
      const pid = parseInput(PaymentId, payment);
      const b = parseInput(RefundPaymentRequest, body);
      const r = find(key);
      const p = r.payments.find((x) => x.id === pid);
      if (!p) throw notFound();
      // The same key on the same payment again (a double click, a retry after a timeout or a 503):
      // the first refund stands and the invoice comes back as it is, even once nothing is left
      // to refund. The API finds it through Stripe (see the yaml's Refund rule).
      const retryKey = `${p.id}:${b.idempotencyKey}`;
      if (s.refunds.has(retryKey)) return toInvoice(r, today());
      if (refundable(p) === 0) {
        throw fail(409, 'NOT_REFUNDABLE', 'This payment cannot be refunded');
      }
      if (b.amountCents > refundable(p)) {
        throw fail(409, 'REFUND_TOO_LARGE', 'The refund is more than what is left of the payment');
      }
      s.refunds.add(retryKey);
      // PENDING until Stripe's webhook confirms it; the mock has no webhook, so it stays so.
      p.refunds.unshift({
        id: s.refundId(),
        amountCents: b.amountCents,
        currency: p.currency,
        status: 'PENDING',
        refundedAt: null,
        createdAt: now(),
      });
      r.updatedAt = now();
      return toInvoice(r, today());
    },
    recordPayment: async (id, body) => {
      await mockDelay();
      manager();
      const key = parseInput(InvoiceId, id);
      const b = parseInput(RecordOfflinePaymentRequest, body);
      if (b.receivedOn > today()) {
        throw fail(400, 'VALIDATION_FAILED', 'The day received cannot be in the future');
      }
      const r = find(key);
      // A retry of a payment already recorded: the invoice as it is now, nothing recorded twice.
      // The key is per firm: one already used on another invoice is 404, as the API answers.
      const recorded = s.offlineKeys.get(b.idempotencyKey);
      if (recorded !== undefined) {
        if (recorded !== r.id) throw notFound();
        return toInvoice(r, today());
      }
      if (r.status !== 'OPEN') throw fail(409, 'NOT_OPEN', 'Only an open invoice takes a payment');
      if (processing(r)) {
        throw fail(409, 'PAYMENT_IN_PROGRESS', 'A payment for this invoice is being processed');
      }
      if (b.amountCents > figures(r).balanceDueCents) {
        throw fail(409, 'AMOUNT_TOO_LARGE', 'The payment is more than the balance due');
      }
      // One live record of a check number per invoice, in any case (R0's unique index).
      const number = b.reference?.toUpperCase();
      if (
        b.method === 'CHECK' &&
        live(r).some((o) => o.method === 'CHECK' && o.reference?.toUpperCase() === number)
      ) {
        throw fail(409, 'DUPLICATE_CHECK_NUMBER', 'This check number is already recorded');
      }
      const at = now();
      s.offlineKeys.set(b.idempotencyKey, r.id);
      r.offline.unshift({
        id: s.offlineId(),
        method: b.method,
        amountCents: b.amountCents,
        currency: 'usd',
        reference: b.reference ?? null,
        receivedOn: b.receivedOn,
        note: b.note ?? null,
        recordedBy: mockMe,
        recordedAt: at,
        voidedAt: null,
        voidedBy: null,
        voidReason: null,
      });
      if (figures(r).balanceDueCents === 0) Object.assign(r, { status: 'PAID', paidAt: at });
      r.updatedAt = at;
      return toInvoice(r, today());
    },
    voidPayment: async (id, offlinePaymentId, body) => {
      await mockDelay();
      manager();
      const key = parseInput(InvoiceId, id);
      const oid = parseInput(OfflinePaymentId, offlinePaymentId);
      const { reason } = parseInput(VoidOfflinePaymentRequest, body);
      const r = find(key);
      const o = r.offline.find((x) => x.id === oid);
      if (!o) throw notFound();
      if (o.voidedAt) throw fail(409, 'ALREADY_VOIDED', 'This payment is voided already');
      const at = now();
      Object.assign(o, { voidedAt: at, voidedBy: mockMe, voidReason: reason });
      // A PAID invoice the payment no longer covers reopens, as the database does.
      if (r.status === 'PAID') {
        const { totalCents, amountPaidCents } = figures(r);
        if (amountPaidCents < totalCents) Object.assign(r, { status: 'OPEN', paidAt: null });
      }
      r.updatedAt = at;
      return toInvoice(r, today());
    },
  };
}

let myMocks: Map<string, MyInvoicesClient> | undefined;

/** `api.myInvoices(slug)` in mock mode: one mock per firm (by lower-cased slug), kept for the page. */
export function myInvoicesMock(firmSlug: string): MyInvoicesClient {
  myMocks ??= new Map();
  const slug = firmSlug.toLowerCase();
  let mock = myMocks.get(slug);
  if (!mock) {
    mock = createMyInvoicesMock();
    myMocks.set(slug, mock);
  }
  return mock;
}

/** Current first (soonest due date, none last), then past ones newest first. */
const portalOrder = (a: MyInvoice, b: MyInvoice) => {
  if (a.section !== b.section) return a.section === 'CURRENT' ? -1 : 1;
  const order =
    a.section === 'CURRENT'
      ? (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31')
      : (b.paidAt ?? b.canceledAt ?? '').localeCompare(a.paidAt ?? a.canceledAt ?? '');
  return order || a.number.localeCompare(b.number);
};

/**
 * An in-memory `api.myInvoices(slug)` for the signed-in portal client (client 1).
 * `paymentsEnabled: false` is a firm whose Stripe account cannot take payments yet.
 */
export function createMyInvoicesMock(
  options: { paymentsEnabled?: boolean } = {},
): MyInvoicesClient {
  const s = store();
  const paymentsEnabled = options.paymentsEnabled ?? true;
  // Never a draft or a draft canceled before it was sent; never another client's.
  const mine = (day: string) =>
    s.rows.filter((r) => r.clientId === firstClientId && myInvoiceStatus(r, day) !== null);
  const findMine = (id: string, day: string) => {
    const r = mine(day).find((x) => x.id === id);
    if (!r) throw notFound();
    return r;
  };

  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListMyInvoicesQuery, query);
      const day = today();
      const shown = MY_INVOICE_VIEWS[q.view];
      const search = q.search?.toLowerCase();
      const found = mine(day)
        .map((r) => toMine(r, day, paymentsEnabled))
        .filter((m) => shown.includes(m.status))
        .filter((m) => !q.status || m.status === q.status)
        .filter((m) => !q.section || m.section === q.section)
        .filter(
          (m) =>
            !search ||
            m.number.toLowerCase().includes(search) ||
            m.title.toLowerCase().includes(search),
        )
        .sort(portalOrder);
      return copy({ ...page(found, q), paymentsEnabled });
    },
    get: async (id) => {
      await mockDelay();
      const day = today();
      return toMyDetail(findMine(parseInput(InvoiceId, id), day), day, paymentsEnabled);
    },
    pay: async (id) => {
      await mockDelay();
      const day = today();
      const r = findMine(parseInput(InvoiceId, id), day);
      const m = toMine(r, day, paymentsEnabled);
      if (r.status !== 'OPEN' || m.balanceDueCents === 0) {
        throw fail(409, 'NOT_PAYABLE', 'This invoice is not open for payment');
      }
      if (m.paymentProcessing) {
        throw fail(409, 'PAYMENT_IN_PROGRESS', 'Your payment for this invoice is being processed');
      }
      if (!paymentsEnabled) {
        throw fail(409, 'PAYMENTS_NOT_SET_UP', 'Online payment is not available yet');
      }
      // No Stripe behind it: the link opens nothing, and nothing is charged or marked paid. The
      // API's Checkout Sessions last 60 minutes.
      return {
        url: `mock:checkout/${r.id}`,
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      };
    },
  };
}
