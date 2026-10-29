'use client';
import {
  type InvoiceListItem,
  INVOICE_ERRORS,
  PAYMENT_METHOD_LABELS,
  type PaymentRow,
  type RecurringInvoiceRow,
} from '@firmivra/types';
import { Badge, Button, Input, Select, Table, type Column } from '@firmivra/ui';
import {
  ArrowsClockwise,
  type Icon,
  LinkSimple,
  ListBullets,
  Receipt,
  Scroll,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  card,
  dayText,
  INV_KEY,
  localToday,
  money,
  outlined,
  quiet,
  useAllInvoices,
  ViewPill,
} from './inv-shared';

// IP-F17 (Octavia, Oct 27): the routes Invoices & Payments lacked: View All Payments, Client
// Statement, Recurring Invoices and the Payment Link Generator. Each reads what the firm has;
// nothing here sends, charges or schedules anything.

function SubHeader({
  icon: Glyph,
  title,
  subtitle,
  children,
}: {
  icon: Icon;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-link">
        <Link href="/invoices">Invoices &amp; Payments</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">{title}</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <Glyph weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1
              data-testid="page-title"
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
            >
              {title}
            </h1>
            <p className="text-base text-link">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {children}
          <Link href="/invoices" className={outlined}>
            Back to Invoices
          </Link>
        </div>
      </header>
    </>
  );
}

// ---------- View All Payments ----------

const STATUS_TONE = { RECEIVED: 'success', REFUNDED: 'warning', VOIDED: 'neutral' } as const;
const STATUS_LABEL = { RECEIVED: 'Received', REFUNDED: 'Refunded', VOIDED: 'Voided' } as const;

/** /invoices/payments: every payment of every invoice in the range, Stripe's and recorded ones. */
export function AllPaymentsScreen() {
  const year = localToday().slice(0, 4);
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(localToday());
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const bad = from && to && from > to;
  const q = useApiQuery([...INV_KEY, 'payments', from, to, search, page], () =>
    bad
      ? Promise.resolve(null)
      : api.invoices.payments({
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          page,
          pageSize: 25,
        }),
  );
  const data = q.data;
  const columns: Column<PaymentRow>[] = [
    { id: 'on', label: 'Date', cell: (r) => dayText(r.receivedOn) },
    {
      id: 'invoice',
      label: 'Invoice',
      cell: (r) => (
        <Link href={`/invoices/${r.invoice.id}`} className="font-medium text-link hover:underline">
          {r.invoice.number}
        </Link>
      ),
    },
    { id: 'client', label: 'Client', cell: (r) => r.client.displayName },
    { id: 'method', label: 'Method', cell: (r) => PAYMENT_METHOD_LABELS[r.method] },
    {
      id: 'source',
      label: 'Source',
      cell: (r) => (r.source === 'STRIPE' ? 'Online (Stripe)' : 'Recorded'),
    },
    {
      id: 'amount',
      label: 'Amount',
      className: 'text-right',
      cell: (r) => money(r.amountCents),
    },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="all-payments">
      <SubHeader
        icon={ListBullets}
        title="All Payments"
        subtitle="Every payment received on your invoices: online and recorded."
      >
        <Link href="/invoices/record-payment" className={outlined}>
          <Receipt aria-hidden weight="fill" className="size-5" /> Record Payment
        </Link>
      </SubHeader>
      <section className={`${card} flex flex-col gap-3`} aria-label="Payments">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="From"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
          <Input
            label="To"
            type="date"
            value={to}
            error={bad ? 'The start date is after the end date.' : undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
          <Input
            label="Search"
            placeholder="Invoice number or client"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <div className="flex flex-col justify-end text-sm text-muted" data-testid="received">
            Received in the range
            <span className="font-display text-2xl font-bold text-heading">
              {data ? money(data.receivedCents) : '—'}
            </span>
          </div>
        </div>
        <Table
          rows={data?.items ?? []}
          columns={columns}
          rowKey={(r) => `${r.source}-${r.id}`}
          caption="Payments"
          dense
          noun="payments"
          pageSize={25}
          loading={q.isPending}
          keepHeaderWhenEmpty
          emptyTitle={q.isError ? 'Payments are not available' : 'No payments in this range'}
          emptyText={
            q.isError
              ? errorMessage(q.error, INVOICE_ERRORS)
              : 'Payments appear here once they are recorded or paid online.'
          }
          server={{
            page: data?.page ?? 1,
            total: data?.total ?? 0,
            hasNext: (data?.page ?? 1) * 25 < (data?.total ?? 0),
            hasPrevious: (data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (n: number) => setPage(n),
            onSort: () => undefined,
          }}
        />
      </section>
    </div>
  );
}

// ---------- Client Statement ----------

/** /invoices/statement: one client's invoices in a range, what was paid and what is still due. */
export function ClientStatementScreen() {
  const all = useAllInvoices();
  const items = all.data?.items ?? [];
  const today = all.data?.today ?? localToday();
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const clients = [...new Map(items.map((i) => [i.client.id, i.client.displayName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
  const day = (i: InvoiceListItem) => (i.issuedAt ?? i.createdAt).slice(0, 10);
  // Drafts are not billed yet: a statement shows what the client was sent.
  const rows = items.filter(
    (i) => i.client.id === clientId && i.status !== 'DRAFT' && day(i) >= from && day(i) <= to,
  );
  const billed = rows.filter((i) => i.status !== 'CANCELED');
  const sum = (f: (i: InvoiceListItem) => number) => billed.reduce((n, i) => n + f(i), 0);
  const columns: Column<InvoiceListItem>[] = [
    {
      id: 'number',
      label: 'Invoice',
      cell: (i) => (
        <Link href={`/invoices/${i.id}`} className="font-medium text-link hover:underline">
          {i.number}
        </Link>
      ),
    },
    { id: 'issued', label: 'Issued', cell: (i) => dayText(i.issuedAt ?? i.scheduledFor) },
    { id: 'due', label: 'Due', cell: (i) => dayText(i.dueOn) },
    { id: 'total', label: 'Total', className: 'text-right', cell: (i) => money(i.totalCents) },
    {
      id: 'paid',
      label: 'Paid',
      className: 'text-right',
      cell: (i) =>
        money(i.status === 'PAID' ? i.totalCents : Math.max(0, i.totalCents - i.balanceDueCents)),
    },
    {
      id: 'balance',
      label: 'Balance',
      className: 'text-right',
      cell: (i) => money(i.status === 'CANCELED' ? 0 : i.balanceDueCents),
    },
    { id: 'status', label: 'Status', cell: (i) => <ViewPill invoice={i} /> },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="client-statement">
      <SubHeader
        icon={Scroll}
        title="Client Statement"
        subtitle="One client's invoices, what they paid and what is still due."
      >
        <Button variant="secondary" disabled={!clientId} onClick={() => window.print()}>
          Print
        </Button>
      </SubHeader>
      <section className={`${card} flex flex-col gap-3`} aria-label="Statement">
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={[{ value: '', label: 'Choose a client' }, ...clients]}
          />
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {!clientId ? (
          <p className={quiet}>Choose a client to see their statement.</p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3" data-testid="statement-totals">
              {(
                [
                  ['Billed', sum((i) => i.totalCents)],
                  ['Paid', sum((i) => Math.max(0, i.totalCents - i.balanceDueCents))],
                  ['Balance due', sum((i) => i.balanceDueCents)],
                ] as const
              ).map(([label, cents]) => (
                <div key={label} className="rounded-lg bg-canvas p-3">
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="font-display text-2xl font-bold text-heading">{money(cents)}</dd>
                </div>
              ))}
            </dl>
            <Table
              rows={rows}
              columns={columns}
              rowKey={(i) => i.id}
              caption="Statement invoices"
              dense
              noun="invoices"
              pageSize={25}
              loading={all.isPending}
              keepHeaderWhenEmpty
              emptyTitle="No invoices in this range"
              emptyText="Change the dates, or choose another client."
            />
          </>
        )}
      </section>
    </div>
  );
}

// ---------- Recurring Invoices ----------

const FREQUENCY: Record<RecurringInvoiceRow['frequency'], string> = {
  ONE_TIME: 'One time',
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every two weeks',
  SEMI_MONTHLY: 'Twice a month',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMIANNUAL: 'Every six months',
  ANNUAL: 'Yearly',
  CUSTOM: 'Custom',
};
const UNIT = { WEEK: 'week', MONTH: 'month', YEAR: 'year' } as const;
/** "Monthly", or a custom schedule's "Every 3 weeks". */
const frequencyText = (r: RecurringInvoiceRow) =>
  r.interval
    ? r.interval.count === 1
      ? `Every ${UNIT[r.interval.unit]}`
      : `Every ${r.interval.count} ${UNIT[r.interval.unit]}s`
    : FREQUENCY[r.frequency];
const RECURRING_TONE = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'neutral',
  ENDED: 'neutral',
} as const;
const RECURRING_LABEL = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ENDED: 'Ended',
} as const;

/** /invoices/recurring: the firm's recurring invoice schedules (read only). */
export function RecurringInvoicesScreen() {
  const q = useApiQuery([...INV_KEY, 'recurring'], () => api.invoices.recurring());
  const columns: Column<RecurringInvoiceRow>[] = [
    { id: 'name', label: 'Schedule', cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: 'client', label: 'Client', cell: (r) => r.client.displayName },
    { id: 'frequency', label: 'Frequency', cell: frequencyText },
    { id: 'next', label: 'Next Invoice', cell: (r) => dayText(r.nextSendOn) },
    { id: 'amount', label: 'Amount', className: 'text-right', cell: (r) => money(r.amountCents) },
    { id: 'send', label: 'Sends', cell: (r) => (r.autoSend ? 'Automatically' : 'After review') },
    {
      id: 'status',
      label: 'Status',
      cell: (r) => <Badge tone={RECURRING_TONE[r.status]}>{RECURRING_LABEL[r.status]}</Badge>,
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="recurring-invoices">
      <SubHeader
        icon={ArrowsClockwise}
        title="Recurring Invoices"
        subtitle="Invoices that repeat on a schedule, and when the next one goes out."
      />
      <section className={card} aria-label="Recurring invoices">
        <Table
          rows={q.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          caption="Recurring invoices"
          dense
          noun="schedules"
          pageSize={25}
          loading={q.isPending}
          keepHeaderWhenEmpty
          emptyTitle={
            q.isError ? 'Recurring invoices are not available' : 'No recurring invoices yet'
          }
          emptyText={
            q.isError
              ? errorMessage(q.error, INVOICE_ERRORS)
              : 'A recurring schedule appears here once it is set up.'
          }
        />
      </section>
    </div>
  );
}

// ---------- Payment Link Generator ----------

/**
 * /invoices/payment-links: the link to an open invoice in the client's portal, where the client
 * signs in and pays it (Pay Now, when online payments are on). The link shows nothing to anyone
 * who is not that client's login.
 */
export function PaymentLinksScreen({ portalBase }: { portalBase: string }) {
  const { firm } = useFirm();
  const all = useAllInvoices();
  const open = (all.data?.items ?? []).filter((i) => i.status === 'OPEN' && i.balanceDueCents > 0);
  const [invoiceId, setInvoiceId] = useState('');
  const [copied, setCopied] = useState(false);
  const chosen = open.find((i) => i.id === invoiceId);
  const link =
    chosen && portalBase && firm
      ? `${portalBase.replace(/\/$/, '')}/${firm.slug}/invoices/${chosen.id}`
      : '';
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="payment-links">
      <SubHeader
        icon={LinkSimple}
        title="Payment Link Generator"
        subtitle="A secure link to an invoice in the client's portal, where they pay it."
      />
      <section className={`${card} flex flex-col gap-3`} aria-label="Payment link">
        {all.data && !all.data.paymentsEnabled ? (
          <p role="status" className="rounded-lg bg-canvas p-3 text-sm text-heading">
            Online payments are not set up yet: the client can see the invoice but cannot pay it
            online until Stripe is connected in{' '}
            <Link href="/settings/payments" className="text-link">
              Settings › Payments
            </Link>
            .
          </p>
        ) : null}
        <Select
          label="Invoice"
          value={invoiceId}
          onChange={(e) => {
            setInvoiceId(e.target.value);
            setCopied(false);
          }}
          options={[
            {
              value: '',
              label: open.length ? 'Choose an open invoice' : 'No open invoices with a balance',
            },
            ...open.map((i) => ({
              value: i.id,
              label: `${i.number} · ${i.client.displayName} · ${money(i.balanceDueCents)}`,
            })),
          ]}
        />
        {chosen ? (
          <div className="flex flex-col gap-2">
            <Input label="Payment link" readOnly value={link} data-testid="payment-link" />
            <p className="text-xs text-muted">
              Only {chosen.client.displayName}&apos;s portal login opens it; anyone else sees the
              sign-in page.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!link}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy Link'}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
