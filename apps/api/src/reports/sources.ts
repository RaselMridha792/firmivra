import type { TxClient } from '@firmivra/db';
import {
  ClientStatus,
  InvoiceStatus,
  LeadSource,
  LeadStatus,
  MembershipRole,
  MembershipStatus,
  PaymentStatus,
  type ReportCategory,
  type ReportDataSource,
  type ReportField,
  type ReportRowLink,
  TaskPriority,
  TaskStatus,
  TaxReturnStatus,
} from '@firmivra/types';
import { LIVE_TASK, liveClient } from '../tasks/task-common.js';
import { memberNames } from '../workspaces/common.js';

// The report catalog: each data source says what a report can show, group, sort and filter on, and
// how to load its rows. One query layer serves the dashboard cards, the quick reports, the
// builder's preview, saved reports, exports and schedules, so they reconcile. Rows are the firm's
// own (the caller's transaction is in the firm's scope), and a caller who only reaches some clients
// (Staff) loads only those clients' rows. A source's rows carry cells by field key: dates are local
// calendar days (the firm's time zone), money is cents, a value the source does not have is null.

export type Cell = string | number | boolean | null;

export interface Row {
  id: string;
  cells: Record<string, Cell>;
  links: ReportRowLink[];
}

export interface LoadContext {
  tx: TxClient;
  businessId: string;
  /** The firm's time zone: a day is the firm's day. */
  timezone: string;
  actor: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' };
  /** The caller reaches only the clients assigned to them (Staff). */
  reachOnly: boolean;
  /** The range to load, as local days, widened by a day each side; the engine filters exactly. */
  from: string;
  to: string;
}

export interface SourceDef {
  key: string;
  category: ReportCategory;
  label: string;
  description: string;
  /** The date field ranges apply to; null for a list with no date to range by (the team). */
  dateField: string | null;
  defaultColumns: string[];
  fields: ReportField[];
  supportsComparison: boolean;
  supportsTaxToggle: boolean;
  /** Only Owner and Admin (and a role with Manage on Reports) may use it: money and team data. */
  restricted: boolean;
  /** The breakdown chart's field when the report has no grouping (else the first status field). */
  breakdownBy?: string;
  load(ctx: LoadContext): Promise<Row[]>;
}

/** The most rows one report loads: past this the caller narrows the range or the filters. */
export const MAX_ROWS = 20_000;

export const localDay = (d: Date | null | undefined, timezone: string): string | null =>
  d
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d)
    : null;

const shift = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};
/** The window of instants that can fall on the local days from..to in any zone. */
export const windowOf = (from: string, to: string) => ({ gte: shift(from, -1), lte: shift(to, 2) });

const field = (
  key: string,
  label: string,
  type: ReportField['type'],
  o: Partial<
    Pick<
      ReportField,
      'groupable' | 'sortable' | 'filterable' | 'aggregatable' | 'locked' | 'sensitive'
    >
  > & {
    options?: readonly string[];
  } = {},
): ReportField => ({
  key,
  label,
  type,
  options: (o.options ?? []).map((v) => ({
    value: v,
    label: v
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase()),
  })),
  groupable: o.groupable ?? (type === 'STATUS' || type === 'TEXT' || type === 'BOOLEAN'),
  sortable: o.sortable ?? true,
  filterable: o.filterable ?? true,
  aggregatable: o.aggregatable ?? (type === 'MONEY' || type === 'NUMBER'),
  locked: o.locked ?? false,
  sensitive: o.sensitive ?? false,
});

const link = (kind: ReportRowLink['kind'], id: string): ReportRowLink => ({ kind, id });

/**
 * RP-F21 (Octavia's Reports review, Oct 28): what a money total counts, by source and field, said
 * on its KPI. Revenue Summary is collected payments; invoice reports are invoiced amounts (the
 * defaults until Octavia confirms, RP-Y04).
 */
export const MONEY_BASIS: Readonly<Record<string, string>> = {
  'invoices_payments.subtotal':
    'Invoiced: the invoices issued in the range, by invoice date, paid or not, before tax.',
  'invoices_payments.tax': 'Invoiced: the tax on the invoices issued in the range.',
  'invoices_payments.total':
    'Invoiced: the invoices issued in the range, by invoice date, paid or not, tax included.',
  'payments_received.amount':
    'Collected: payments received in the range, by paid date, including any tax they paid; tips are apart.',
  'payments_received.tip': 'Collected: tips paid with payments received in the range.',
};

// ---------- Clients ----------

const clients: SourceDef = {
  key: 'clients',
  category: 'CLIENT',
  label: 'Clients',
  description: 'The firm’s clients, with their status, source and who is assigned.',
  dateField: 'createdOn',
  defaultColumns: ['name', 'accountType', 'status', 'assignedTo', 'createdOn'],
  supportsComparison: true,
  supportsTaxToggle: false,
  restricted: false,
  fields: [
    field('name', 'Client Name', 'TEXT', { locked: true, groupable: false }),
    field('accountType', 'Client Type', 'STATUS', { options: ['INDIVIDUAL', 'BUSINESS'] }),
    field('status', 'Status', 'STATUS', { options: ClientStatus.options }),
    field('source', 'Source', 'TEXT'),
    field('assignedTo', 'Assigned To', 'TEXT'),
    field('createdOn', 'Created', 'DATE', { groupable: false }),
    field('clientSince', 'Client Since', 'DATE', { groupable: false }),
    field('email', 'Email', 'TEXT', { sensitive: true, groupable: false }),
    field('phone', 'Phone', 'TEXT', { sensitive: true, groupable: false }),
  ],
  async load(c) {
    const rows = await c.tx.client.findMany({
      where: {
        businessId: c.businessId,
        archivedAt: null,
        createdAt: windowOf(c.from, c.to),
        ...(c.reachOnly ? { assignedUserId: c.actor.userId } : {}),
      },
      take: MAX_ROWS + 1,
      select: {
        id: true,
        displayName: true,
        accountType: true,
        status: true,
        source: true,
        assignedUserId: true,
        createdAt: true,
        clientSince: true,
        email: true,
        phone: true,
      },
    });
    const names = await memberNames(
      c.tx,
      c.businessId,
      rows.map((r) => r.assignedUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      cells: {
        name: r.displayName,
        accountType: r.accountType,
        status: r.status,
        source: r.source,
        assignedTo: r.assignedUserId ? (names.get(r.assignedUserId) ?? null) : null,
        createdOn: localDay(r.createdAt, c.timezone),
        clientSince: r.clientSince?.toISOString().slice(0, 10) ?? null,
        email: r.email,
        phone: r.phone,
      },
      links: [link('CLIENT', r.id)],
    }));
  },
};

// ---------- Invoices ----------

const invoices: SourceDef = {
  key: 'invoices_payments',
  category: 'FINANCIAL',
  label: 'Invoices',
  description: 'Invoices with their status, amounts and due dates.',
  dateField: 'issuedOn',
  defaultColumns: ['number', 'client', 'status', 'total', 'issuedOn', 'dueOn'],
  supportsComparison: true,
  supportsTaxToggle: true,
  restricted: true,
  fields: [
    field('number', 'Invoice Number', 'TEXT', { locked: true, groupable: false }),
    field('client', 'Client', 'TEXT'),
    field('status', 'Status', 'STATUS', { options: InvoiceStatus.options }),
    // RP-F21: invoice amounts are invoiced (by invoice date, paid or not).
    field('subtotal', 'Invoiced Subtotal', 'MONEY'),
    field('tax', 'Invoiced Tax', 'MONEY'),
    field('total', 'Invoiced Total', 'MONEY'),
    field('issuedOn', 'Invoice Date', 'DATE', { groupable: false }),
    field('dueOn', 'Due Date', 'DATE', { groupable: false }),
    field('paidOn', 'Paid Date', 'DATE', { groupable: false }),
    field('daysOverdue', 'Days Overdue', 'NUMBER', { aggregatable: false }),
    field('assignedTo', 'Assigned To', 'TEXT'),
  ],
  async load(c) {
    const today = localDay(new Date(), c.timezone)!;
    const rows = await c.tx.invoice.findMany({
      where: {
        businessId: c.businessId,
        status: { not: 'DRAFT' },
        issuedAt: windowOf(c.from, c.to),
        ...(c.reachOnly ? { client: { assignedUserId: c.actor.userId } } : {}),
      },
      take: MAX_ROWS + 1,
      select: {
        id: true,
        number: true,
        status: true,
        subtotalCents: true,
        taxCents: true,
        totalCents: true,
        issuedAt: true,
        dueOn: true,
        paidAt: true,
        assignedUserId: true,
        clientId: true,
        client: { select: { displayName: true } },
      },
    });
    const names = await memberNames(
      c.tx,
      c.businessId,
      rows.map((r) => r.assignedUserId),
    );
    return rows.map((r) => {
      const due = r.dueOn?.toISOString().slice(0, 10) ?? null;
      return {
        id: r.id,
        cells: {
          number: r.number,
          client: r.client.displayName,
          status: r.status,
          subtotal: r.subtotalCents,
          tax: r.taxCents,
          total: r.totalCents,
          issuedOn: localDay(r.issuedAt, c.timezone),
          dueOn: due,
          paidOn: localDay(r.paidAt, c.timezone),
          daysOverdue:
            r.status === 'OPEN' && due && due < today
              ? Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000)
              : null,
          assignedTo: r.assignedUserId ? (names.get(r.assignedUserId) ?? null) : null,
        },
        links: [link('INVOICE', r.id), link('CLIENT', r.clientId)],
      };
    });
  },
};

// ---------- Payments received ----------

/** A payment's method in words: Stripe's method types and the recorded (offline) methods alike. */
export const paymentMethodLabel = (method: string | null): string => {
  switch (method) {
    case 'card':
    case 'CARD':
      return 'Card';
    case 'us_bank_account':
    case 'ACH':
      return 'ACH';
    case 'CASH':
      return 'Cash';
    case 'CHECK':
      return 'Check';
    default:
      return 'Other';
  }
};

/** The services an invoice's lines came from: one name, "Multiple services" or "Custom items". */
const serviceOf = (lines: { itemName: string | null; service: { name: string } | null }[]) => {
  const names = new Set(
    lines.filter((l) => l.service).map((l) => l.itemName ?? l.service?.name ?? ''),
  );
  if (names.size === 1) return [...names][0]!;
  return names.size > 1 ? 'Multiple services' : 'Custom items';
};

const paymentInvoiceSelect = {
  number: true,
  clientId: true,
  client: { select: { displayName: true } },
  lines: { select: { itemName: true, service: { select: { name: true } } } },
} as const;

// IP-F22 (Octavia, Oct 27): payments received are Stripe's (confirmed by its webhook) and the
// ones the firm recorded by hand (Record Payment: check, cash, ACH, card, other), not voided.
const payments: SourceDef = {
  key: 'payments_received',
  category: 'FINANCIAL',
  label: 'Payments',
  description: 'Payments received, by day, method and client.',
  dateField: 'paidOn',
  defaultColumns: ['invoice', 'client', 'amount', 'method', 'paidOn'],
  supportsComparison: true,
  supportsTaxToggle: false,
  restricted: true,
  breakdownBy: 'method',
  fields: [
    field('invoice', 'Invoice', 'TEXT', { locked: true, groupable: false }),
    field('client', 'Client', 'TEXT'),
    field('service', 'Service', 'TEXT'),
    field('status', 'Status', 'STATUS', { options: PaymentStatus.options }),
    // RP-F21: payments are collected (by paid date).
    field('amount', 'Amount Collected', 'MONEY'),
    field('tip', 'Tips Collected', 'MONEY'),
    field('method', 'Payment Method', 'TEXT'),
    field('processor', 'Processor', 'TEXT'),
    field('paidOn', 'Paid Date', 'DATE', { groupable: false }),
  ],
  async load(c) {
    const reach = c.reachOnly ? { invoice: { client: { assignedUserId: c.actor.userId } } } : {};
    const online = await c.tx.payment.findMany({
      where: { businessId: c.businessId, paidAt: windowOf(c.from, c.to), ...reach },
      take: MAX_ROWS + 1,
      select: {
        id: true,
        amountCents: true,
        tipCents: true,
        status: true,
        methodType: true,
        processor: true,
        paidAt: true,
        invoiceId: true,
        invoice: { select: paymentInvoiceSelect },
      },
    });
    const recorded = await c.tx.offlinePayment.findMany({
      where: {
        businessId: c.businessId,
        voidedAt: null,
        receivedOn: windowOf(c.from, c.to),
        ...reach,
      },
      take: MAX_ROWS + 1,
      select: {
        id: true,
        amountCents: true,
        method: true,
        receivedOn: true,
        invoiceId: true,
        invoice: { select: paymentInvoiceSelect },
      },
    });
    const rows: Row[] = online.map((r) => ({
      id: r.id,
      cells: {
        invoice: r.invoice.number,
        client: r.invoice.client.displayName,
        service: serviceOf(r.invoice.lines),
        status: r.status,
        amount: r.amountCents,
        tip: r.tipCents,
        method: paymentMethodLabel(r.methodType),
        processor: r.processor,
        paidOn: localDay(r.paidAt, c.timezone),
      },
      links: [
        link('PAYMENT', r.id),
        link('INVOICE', r.invoiceId),
        link('CLIENT', r.invoice.clientId),
      ],
    }));
    for (const r of recorded) {
      rows.push({
        id: r.id,
        cells: {
          invoice: r.invoice.number,
          client: r.invoice.client.displayName,
          service: serviceOf(r.invoice.lines),
          // A recorded payment is money received; a voided one is left out above.
          status: 'SUCCEEDED',
          amount: r.amountCents,
          tip: 0,
          method: paymentMethodLabel(r.method),
          processor: 'MANUAL',
          paidOn: r.receivedOn.toISOString().slice(0, 10),
        },
        links: [link('INVOICE', r.invoiceId), link('CLIENT', r.invoice.clientId)],
      });
    }
    return rows.slice(0, MAX_ROWS + 1);
  },
};

// ---------- Leads ----------

const leads: SourceDef = {
  key: 'leads',
  category: 'LEADS',
  label: 'Leads',
  description: 'Leads with their source, status and who is following up.',
  dateField: 'createdOn',
  defaultColumns: ['number', 'name', 'source', 'status', 'assignedTo', 'createdOn'],
  supportsComparison: true,
  supportsTaxToggle: false,
  restricted: false,
  fields: [
    field('number', 'Lead Number', 'NUMBER', {
      locked: true,
      aggregatable: false,
      groupable: false,
    }),
    field('name', 'Lead Name', 'TEXT', { groupable: false }),
    field('source', 'Source', 'STATUS', { options: LeadSource.options }),
    field('status', 'Status', 'STATUS', { options: LeadStatus.options }),
    field('service', 'Service', 'TEXT'),
    field('assignedTo', 'Assigned To', 'TEXT'),
    field('createdOn', 'Created', 'DATE', { groupable: false }),
    field('nextActionOn', 'Next Action', 'DATE', { groupable: false }),
    field('email', 'Email', 'TEXT', { sensitive: true, groupable: false }),
    field('phone', 'Phone', 'TEXT', { sensitive: true, groupable: false }),
  ],
  async load(c) {
    const rows = await c.tx.lead.findMany({
      where: {
        businessId: c.businessId,
        archivedAt: null,
        status: { not: 'DRAFT' },
        createdAt: windowOf(c.from, c.to),
        ...(c.reachOnly ? { assignedUserId: c.actor.userId } : {}),
      },
      take: MAX_ROWS + 1,
      select: {
        id: true,
        number: true,
        firstName: true,
        lastName: true,
        source: true,
        status: true,
        assignedUserId: true,
        createdAt: true,
        nextActionAt: true,
        email: true,
        phone: true,
        service: { select: { name: true } },
      },
    });
    const names = await memberNames(
      c.tx,
      c.businessId,
      rows.map((r) => r.assignedUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      cells: {
        number: r.number,
        name: `${r.firstName} ${r.lastName}`.trim(),
        source: r.source,
        status: r.status,
        service: r.service.name,
        assignedTo: r.assignedUserId ? (names.get(r.assignedUserId) ?? null) : null,
        createdOn: localDay(r.createdAt, c.timezone),
        nextActionOn: localDay(r.nextActionAt, c.timezone),
        email: r.email,
        phone: r.phone,
      },
      links: [link('LEAD', r.id)],
    }));
  },
};

// ---------- Tax returns ----------

const taxReturns: SourceDef = {
  key: 'tax_returns',
  category: 'TAX',
  label: 'Tax returns filed',
  description: 'Returns by filing status, type and preparer, over the date each was filed.',
  dateField: 'filedOn',
  defaultColumns: ['client', 'taxYear', 'filingType', 'status', 'preparer', 'filedOn'],
  supportsComparison: true,
  supportsTaxToggle: false,
  restricted: false,
  fields: [
    field('client', 'Client', 'TEXT', { locked: true }),
    field('taxYear', 'Tax Year', 'NUMBER', { aggregatable: false, groupable: true }),
    field('filingType', 'Return Type', 'STATUS', { options: ['INDIVIDUAL', 'BUSINESS'] }),
    field('status', 'Filing Status', 'STATUS', { options: TaxReturnStatus.options }),
    field('preparer', 'Preparer', 'TEXT'),
    field('dueOn', 'Due Date', 'DATE', { groupable: false }),
    field('filedOn', 'Filed Date', 'DATE', { groupable: false }),
  ],
  async load(c) {
    const rows = await c.tx.taxReturn.findMany({
      where: {
        businessId: c.businessId,
        archivedAt: null,
        filedOn: windowOf(c.from, c.to),
        ...(c.reachOnly ? { client: { assignedUserId: c.actor.userId } } : {}),
      },
      take: MAX_ROWS + 1,
      select: {
        id: true,
        clientId: true,
        taxYear: true,
        filingType: true,
        status: true,
        preparerUserId: true,
        dueOn: true,
        filedOn: true,
        client: { select: { displayName: true } },
      },
    });
    const names = await memberNames(
      c.tx,
      c.businessId,
      rows.map((r) => r.preparerUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      cells: {
        client: r.client.displayName,
        taxYear: r.taxYear,
        filingType: r.filingType,
        status: r.status,
        preparer: r.preparerUserId ? (names.get(r.preparerUserId) ?? null) : null,
        dueOn: r.dueOn?.toISOString().slice(0, 10) ?? null,
        filedOn: r.filedOn?.toISOString().slice(0, 10) ?? null,
      },
      links: [link('RETURN', r.id), link('CLIENT', r.clientId)],
    }));
  },
};

// ---------- Tasks (team productivity) ----------

const tasks: SourceDef = {
  key: 'tasks',
  category: 'TEAM_PRODUCTIVITY',
  label: 'Tasks',
  description: 'Task workload by person, status and priority.',
  dateField: 'createdOn',
  defaultColumns: ['title', 'client', 'status', 'priority', 'assignedTo', 'dueOn'],
  supportsComparison: true,
  supportsTaxToggle: false,
  restricted: true,
  fields: [
    field('title', 'Task', 'TEXT', { locked: true, groupable: false }),
    field('client', 'Client', 'TEXT'),
    field('status', 'Status', 'STATUS', { options: TaskStatus.options }),
    field('priority', 'Priority', 'STATUS', { options: TaskPriority.options }),
    field('assignedTo', 'Assigned To', 'TEXT'),
    field('createdOn', 'Created', 'DATE', { groupable: false }),
    field('dueOn', 'Due Date', 'DATE', { groupable: false }),
    field('completedOn', 'Completed', 'DATE', { groupable: false }),
    field('overdue', 'Overdue', 'BOOLEAN'),
  ],
  async load(c) {
    const today = localDay(new Date(), c.timezone)!;
    const rows = await c.tx.task.findMany({
      where: {
        businessId: c.businessId,
        archivedAt: null,
        ...LIVE_TASK,
        createdAt: windowOf(c.from, c.to),
        ...(c.reachOnly ? { client: { assignedUserId: c.actor.userId } } : {}),
      },
      take: MAX_ROWS + 1,
      select: {
        id: true,
        clientId: true,
        title: true,
        status: true,
        priority: true,
        assignedUserId: true,
        createdAt: true,
        dueOn: true,
        completedAt: true,
        client: { select: { displayName: true } },
      },
    });
    const names = await memberNames(
      c.tx,
      c.businessId,
      rows.map((r) => r.assignedUserId),
    );
    return rows.map((r) => {
      const due = r.dueOn?.toISOString().slice(0, 10) ?? null;
      return {
        id: r.id,
        cells: {
          title: r.title,
          client: liveClient(r.client).displayName,
          status: r.status,
          priority: r.priority,
          assignedTo: r.assignedUserId ? (names.get(r.assignedUserId) ?? null) : null,
          createdOn: localDay(r.createdAt, c.timezone),
          dueOn: due,
          completedOn: localDay(r.completedAt, c.timezone),
          overdue: !!due && due < today && r.status !== 'DONE' && r.status !== 'CANCELLED',
        },
        links: [link('TASK', r.id), link('CLIENT', liveClient(r.clientId))],
      };
    });
  },
};

// ---------- Staff & Team (SM3, Octavia's Staff Management review) ----------

/**
 * The firm's team as it stands: each member who has joined, their role, status, job title, the
 * clients assigned to them and their live tasks (open, overdue, completed). A roster, not a period:
 * it has no date to range by. Team data, so Owner and Admin (or Manage on Reports) only.
 */
const team: SourceDef = {
  key: 'team_members',
  category: 'TEAM_PRODUCTIVITY',
  label: 'Staff & Team',
  description: 'The team: role, status, job title, assigned clients and open work per person.',
  dateField: null,
  defaultColumns: ['name', 'role', 'jobTitle', 'status', 'clients', 'openTasks', 'overdueTasks'],
  supportsComparison: false,
  supportsTaxToggle: false,
  restricted: true,
  breakdownBy: 'role',
  fields: [
    field('name', 'Name', 'TEXT', { locked: true, groupable: false }),
    field('role', 'Role', 'STATUS', { options: MembershipRole.options }),
    field('status', 'Status', 'STATUS', { options: MembershipStatus.options }),
    field('jobTitle', 'Job Title', 'TEXT'),
    field('joinedOn', 'Joined', 'DATE', { groupable: false }),
    field('clients', 'Assigned Clients', 'NUMBER', { groupable: false }),
    field('openTasks', 'Open Tasks', 'NUMBER', { groupable: false }),
    field('overdueTasks', 'Overdue Tasks', 'NUMBER', { groupable: false }),
    field('completedTasks', 'Completed Tasks', 'NUMBER', { groupable: false }),
  ],
  async load(c) {
    const today = localDay(new Date(), c.timezone)!;
    const members = await c.tx.membership.findMany({
      where: { businessId: c.businessId, joinedAt: { not: null } },
      take: MAX_ROWS + 1,
      orderBy: { joinedAt: 'asc' },
      select: {
        id: true,
        userId: true,
        role: true,
        status: true,
        jobTitle: true,
        joinedAt: true,
        user: { select: { name: true } },
      },
    });
    const ids = members.map((m) => m.userId);
    const live = {
      businessId: c.businessId,
      archivedAt: null,
      ...LIVE_TASK,
      assignedUserId: { in: ids },
    };
    const [clients, byStatus, overdue] = await Promise.all([
      c.tx.client.groupBy({
        by: ['assignedUserId'],
        where: { businessId: c.businessId, archivedAt: null, assignedUserId: { in: ids } },
        _count: { _all: true },
      }),
      c.tx.task.groupBy({ by: ['assignedUserId', 'status'], where: live, _count: { _all: true } }),
      c.tx.task.groupBy({
        by: ['assignedUserId'],
        where: { ...live, status: 'OPEN', dueOn: { lt: new Date(`${today}T00:00:00.000Z`) } },
        _count: { _all: true },
      }),
    ]);
    const total = <T extends { assignedUserId: string | null; _count: { _all: number } }>(
      list: T[],
      userId: string,
      pick: (x: T) => boolean = () => true,
    ) =>
      list
        .filter((x) => x.assignedUserId === userId && pick(x))
        .reduce((n, x) => n + x._count._all, 0);
    return members.map((m) => ({
      id: m.id,
      cells: {
        name: m.user.name,
        role: m.role,
        status: m.status,
        jobTitle: m.jobTitle,
        joinedOn: localDay(m.joinedAt, c.timezone),
        clients: total(clients, m.userId),
        openTasks: total(byStatus, m.userId, (x) => x.status === 'OPEN'),
        overdueTasks: total(overdue, m.userId),
        completedTasks: total(byStatus, m.userId, (x) => x.status === 'DONE'),
      },
      links: [],
    }));
  },
};

export const SOURCES: readonly SourceDef[] = [
  clients,
  invoices,
  payments,
  leads,
  taxReturns,
  tasks,
  team,
];
const BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));
export const sourceOf = (key: string): SourceDef | undefined => BY_KEY.get(key);

/** A source as the contract's catalog shows it (no loader). */
export const toCatalog = (s: SourceDef, includeSensitive: boolean): ReportDataSource => ({
  key: s.key,
  category: s.category,
  label: s.label,
  description: s.description,
  fields: s.fields.filter((f) => includeSensitive || !f.sensitive),
  defaultColumns: s.defaultColumns.filter(
    (k) => includeSensitive || !s.fields.find((f) => f.key === k)?.sensitive,
  ),
  dateField: s.dateField,
  supportsComparison: s.supportsComparison,
  supportsTaxToggle: s.supportsTaxToggle,
});
