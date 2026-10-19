'use client';

import { INVOICE_ERRORS, type InvoiceListItem } from '@firmivra/types';
import {
  ActionMenu,
  type ActionMenuSection,
  BulkBar,
  DonutChart,
  Input,
  KpiCard,
  type KpiTrend,
  Pagination,
  Select,
  Tabs,
  Toast,
} from '@firmivra/ui';
import {
  ArrowSquareOut,
  CalendarBlank,
  ChartBar,
  CheckCircle,
  Coins,
  CreditCard,
  DotsThreeVertical,
  Eye,
  FileText,
  Gear,
  Invoice as InvoiceIcon,
  Lifebuoy,
  ListBullets,
  Lightning,
  MagnifyingGlass,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Prohibit,
  Receipt,
  User,
  ChatCircleDots,
  WarningDiamond,
  Copy,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { RequireRole } from '../../../../../components/require-role';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { InvoiceCancelForm } from './invoice-cancel-form';
import {
  card,
  dayText,
  DUE_SOON_DAYS,
  INV_KEY,
  invoiceDay,
  linkBtn,
  localToday,
  money,
  moneyWhole,
  outlined,
  paidCents,
  primary,
  quiet,
  useAllInvoices,
  VIEW_CHART,
  VIEW_LABEL,
  VIEW_ORDER,
  type InvoiceView,
  viewOf,
  ViewPill,
} from './inv-shared';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** /invoices: the design's Invoices & Payments page, every number from the firm's invoices. */
export function InvoicesOverview() {
  const all = useAllInvoices();
  const items = useMemo(() => all.data?.items ?? [], [all.data]);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' }>();
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="invoices-page">
      <Header />
      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(undefined)} />
      ) : null}
      {all.isError ? (
        <p role="alert" className={quiet}>
          Invoices could not be loaded right now. The page shows again once they load.
        </p>
      ) : null}
      {all.data?.capped ? (
        <p className="text-sm text-muted">
          Showing the newest {items.length} invoices; older ones are not counted here.
        </p>
      ) : null}
      <Kpis items={items} loading={all.isPending} ready={!!all.data} />
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid min-w-0 gap-5 lg:grid-cols-3">
            <ActivityChart items={items} />
            <StatusChart items={items} />
            <MethodsChart />
          </div>
          <InvoiceTable
            items={items}
            loading={all.isPending}
            failed={all.isError}
            onNotice={(text, tone) => setNotice({ text, tone })}
          />
        </div>
        <Side paymentsEnabled={all.data?.paymentsEnabled} loaded={!!all.data} />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
        >
          <InvoiceIcon weight="fill" className="size-10" />
        </span>
        <div className="min-w-0">
          <h1
            data-testid="page-title"
            className="font-display text-3xl font-bold text-heading sm:text-4xl"
          >
            Invoices &amp; Payments
          </h1>
          <p className="text-base text-link">
            Create invoices, get paid, and track payments – all in one place.
          </p>
        </div>
      </div>
      <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
        <RequireRole roles={['OWNER', 'ADMIN']}>
          <Link href="/invoices/new" className={primary}>
            <Plus aria-hidden weight="bold" className="size-5" /> Create Invoice
          </Link>
          <Link href="/invoices/record-payment" className={outlined}>
            <Receipt aria-hidden weight="fill" className="size-5 text-action" /> Record Payment
          </Link>
        </RequireRole>
        <Link href="/reports" className={outlined}>
          <ChartBar aria-hidden weight="fill" className="size-5 text-action" /> View Reports
        </Link>
        <RequireRole roles={['OWNER', 'ADMIN']}>
          <Link href="/settings/payments" className={outlined}>
            <Gear aria-hidden weight="fill" className="size-5 text-action" /> Payment Settings
          </Link>
        </RequireRole>
      </div>
    </header>
  );
}

const monthOf = (date: string) => date.slice(0, 7);
const shiftMonth = (ym: string, by: number) => {
  const [y = 0, m = 1] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** "12%" up or down against last month; none when last month had nothing to compare. */
function trendOf(now: number, before: number, goodWhenUp: boolean): KpiTrend | undefined {
  if (before <= 0) return undefined;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: '0%', direction: 'flat' };
  return {
    text: `${Math.abs(pct)}%`,
    direction: pct > 0 ? 'up' : 'down',
    good: goodWhenUp ? pct > 0 : pct < 0,
  };
}

function Kpis({
  items,
  loading,
  ready,
}: {
  items: InvoiceListItem[];
  loading: boolean;
  /** False when the invoices did not load: every tile shows a dash, never a made-up $0. */
  ready: boolean;
}) {
  const show = (cents: number) => (ready ? moneyWhole(cents) : '—');
  const today = localToday();
  const thisMonth = monthOf(today);
  const lastMonth = shiftMonth(thisMonth, -1);
  const open = items.filter((i) => i.status === 'OPEN');
  const sum = (list: InvoiceListItem[], f: (i: InvoiceListItem) => number) =>
    list.reduce((n, i) => n + f(i), 0);
  const paidIn = (ym: string) =>
    sum(
      items.filter((i) => i.status === 'PAID' && i.paidAt && monthOf(i.paidAt) === ym),
      (i) => i.totalCents,
    );
  const overdue = open.filter((i) => i.overdue);
  const soonEnd = addDays(today, DUE_SOON_DAYS);
  const dueSoon = open.filter((i) => !i.overdue && i.dueOn && i.dueOn <= soonEnd);
  const count = (n: number) => `${n} invoice${n === 1 ? '' : 's'}`;
  return (
    <section
      aria-label="Invoice totals"
      className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      data-testid="invoice-kpis"
    >
      <KpiCard
        icon={FileText}
        tone="blue"
        value={show(sum(open, (i) => i.balanceDueCents))}
        label="Total Outstanding"
        note={ready ? count(open.length) : undefined}
        loading={loading}
      />
      <KpiCard
        icon={CheckCircle}
        tone="green"
        value={show(paidIn(thisMonth))}
        label="Paid This Month"
        trend={trendOf(paidIn(thisMonth), paidIn(lastMonth), true)}
        note="vs last month"
        loading={loading}
      />
      <KpiCard
        icon={WarningDiamond}
        tone="red"
        value={show(sum(overdue, (i) => i.balanceDueCents))}
        label="Overdue"
        note={ready ? count(overdue.length) : undefined}
        loading={loading}
      />
      <KpiCard
        icon={CalendarBlank}
        tone="amber"
        value={show(sum(dueSoon, (i) => i.balanceDueCents))}
        label="Due Soon"
        note={`next ${DUE_SOON_DAYS} days`}
        loading={loading}
      />
      <KpiCard
        icon={Coins}
        tone="purple"
        value={show(sum(items, paidCents))}
        label="Total Collected"
        note="all invoices"
        loading={loading}
      />
    </section>
  );
}

const SERIES = [
  { key: 'sent', label: 'Invoices Sent', bar: 'bg-chart-blue' },
  { key: 'paid', label: 'Paid', bar: 'bg-chart-green' },
  { key: 'overdue', label: 'Overdue', bar: 'bg-chart-red' },
] as const;

/** Invoice Activity: by month of the chosen year, the amounts sent, paid and now overdue. */
function ActivityChart({ items }: { items: InvoiceListItem[] }) {
  const year = Number(localToday().slice(0, 4));
  const [chosen, setChosen] = useState(year);
  const months = MONTHS.map((_, m) => `${chosen}-${String(m + 1).padStart(2, '0')}`);
  const at = (ym: string) => ({
    sent: items
      .filter((i) => i.issuedAt && monthOf(i.issuedAt) === ym)
      .reduce((n, i) => n + i.totalCents, 0),
    paid: items
      .filter((i) => i.status === 'PAID' && i.paidAt && monthOf(i.paidAt) === ym)
      .reduce((n, i) => n + i.totalCents, 0),
    overdue: items
      .filter((i) => i.overdue && i.dueOn && monthOf(i.dueOn) === ym)
      .reduce((n, i) => n + i.balanceDueCents, 0),
  });
  const data = months.map(at);
  const max = Math.max(0, ...data.flatMap((d) => [d.sent, d.paid, d.overdue]));
  // Round the top of the axis up to a tidy step so the ticks read well.
  const step = max <= 0 ? 0 : 10 ** Math.floor(Math.log10(max / 4));
  const top = max <= 0 ? 0 : Math.ceil(max / 4 / step) * step * 4;
  const ticks = [4, 3, 2, 1, 0].map((n) => (top * n) / 4);
  return (
    <section className={card} aria-labelledby="inv-activity" data-testid="invoice-activity">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="inv-activity" className="font-display text-lg font-bold text-heading">
          Invoice Activity
        </h2>
        <Select
          label="Year"
          hideLabel
          value={String(chosen)}
          onChange={(e) => setChosen(Number(e.target.value))}
          options={[
            { value: String(year), label: 'This Year' },
            { value: String(year - 1), label: 'Last Year' },
          ]}
        />
      </div>
      <p className="mb-2 flex flex-wrap gap-4 text-xs text-text">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2.5 rounded-full ${s.bar}`} /> {s.label}
          </span>
        ))}
      </p>
      {top === 0 ? (
        <p className={quiet}>No invoices sent or paid in {chosen}.</p>
      ) : (
        <div className="flex gap-2">
          <ul className="flex h-40 flex-col justify-between text-right text-[10px] text-muted">
            {ticks.map((t) => (
              <li key={t} className="leading-none">
                {compact.format(t / 100)}
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1">
            <ul
              className="flex h-40 items-end gap-1 border-b border-divider"
              role="img"
              aria-label={`Invoice activity in ${chosen}`}
            >
              {data.map((d, i) => (
                <li key={months[i]} className="flex h-full flex-1 items-end justify-center gap-px">
                  {SERIES.map((s) => (
                    <span
                      key={s.key}
                      className={`w-1.5 rounded-t-sm ${s.bar}`}
                      style={{ height: `${(d[s.key] / top) * 100}%` }}
                      title={`${MONTHS[i]} ${s.label}: ${money(d[s.key])}`}
                    />
                  ))}
                </li>
              ))}
            </ul>
            <ul className="mt-1 flex gap-1 text-[10px] text-muted">
              {MONTHS.map((m) => (
                <li key={m} className="flex-1 text-center">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

/** Payment Status: how many invoices are in each status. */
function StatusChart({ items }: { items: InvoiceListItem[] }) {
  const [range, setRange] = useState<'all' | 'year'>('all');
  const year = localToday().slice(0, 4);
  const list = range === 'all' ? items : items.filter((i) => invoiceDay(i).startsWith(year));
  const segments = VIEW_ORDER.map((v) => ({
    label: VIEW_LABEL[v],
    value: list.filter((i) => viewOf(i) === v).length,
    tone: VIEW_CHART[v],
  }));
  return (
    <section className={card} aria-labelledby="inv-status" data-testid="invoice-status-chart">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="inv-status" className="font-display text-lg font-bold text-heading">
          Payment Status
        </h2>
        <Select
          label="Invoices counted"
          hideLabel
          value={range}
          onChange={(e) => setRange(e.target.value === 'year' ? 'year' : 'all')}
          options={[
            { value: 'all', label: 'All Invoices' },
            { value: 'year', label: 'This Year' },
          ]}
        />
      </div>
      {/* The legend drops under the ring when the card is narrow, as eight rows do not fit beside it. */}
      <div className="[&_figure>ul]:min-w-44 [&_figure>ul]:gap-1.5 [&_li]:text-xs">
        <DonutChart
          segments={segments}
          centerValue={list.length}
          centerLabel="Invoices"
          size="sm"
          legend
          showPercent
          emptyText="No invoices yet."
        />
      </div>
    </section>
  );
}

/** Payment Methods: the contract's invoice list carries no payment method, so it stays empty. */
function MethodsChart() {
  return (
    <section className={card} aria-labelledby="inv-methods" data-testid="invoice-methods-chart">
      <h2 id="inv-methods" className="mb-3 font-display text-lg font-bold text-heading">
        Payment Methods
      </h2>
      <DonutChart
        segments={[]}
        centerValue="—"
        centerLabel="Collected"
        legend
        emptyText="No payment-method breakdown yet. Each invoice shows how it was paid."
      />
    </section>
  );
}

type Tab = 'ALL' | InvoiceView;

function InvoiceTable({
  items,
  loading,
  failed,
  onNotice,
}: {
  items: InvoiceListItem[];
  loading: boolean;
  failed: boolean;
  onNotice: (text: string, tone: 'success' | 'error') => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { role } = useFirm();
  const canChange = role === 'OWNER' || role === 'ADMIN';
  const [tab, setTab] = useState<Tab>('ALL');
  const [clientId, setClientId] = useState('');
  const [service, setService] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [canceling, setCanceling] = useState<InvoiceListItem>();
  const [busy, setBusy] = useState(false);

  const clients = [...new Map(items.map((i) => [i.client.id, i.client.displayName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
  const services = [...new Set(items.map((i) => i.service?.title ?? i.title))].sort();
  const term = search.trim().toLowerCase();
  const filtered = items.filter((i) => {
    const day = invoiceDay(i);
    return (
      (!clientId || i.client.id === clientId) &&
      (!service || (i.service?.title ?? i.title) === service) &&
      (!status || viewOf(i) === status) &&
      (!from || day >= from) &&
      (!to || day <= to) &&
      (!term || `${i.number} ${i.client.displayName} ${i.title}`.toLowerCase().includes(term))
    );
  });
  const rows = tab === 'ALL' ? filtered : filtered.filter((i) => viewOf(i) === tab);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * size, current * size);
  const tabs = [
    { id: 'ALL', label: 'All Invoices', count: filtered.length },
    ...VIEW_ORDER.map((v) => ({
      id: v,
      label: VIEW_LABEL[v],
      count: filtered.filter((i) => viewOf(i) === v).length,
    })),
  ];
  const clear = () => {
    setClientId('');
    setService('');
    setStatus('');
    setFrom('');
    setTo('');
    setSearch('');
    setPage(1);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: [...INV_KEY] });
  const drafts = items.filter((i) => selected.includes(i.id) && i.status === 'DRAFT');
  const sendDrafts = async () => {
    setBusy(true);
    let sent = 0;
    let problem = '';
    for (const d of drafts) {
      try {
        await api.invoices.send(d.id);
        sent += 1;
      } catch (e) {
        problem ||= `${d.number}: ${errorMessage(e, INVOICE_ERRORS)}`;
      }
    }
    setBusy(false);
    setSelected([]);
    await refresh();
    onNotice(
      problem ? `Sent ${sent}. ${problem}` : `Sent ${sent} invoice${sent === 1 ? '' : 's'}.`,
      problem ? 'error' : 'success',
    );
  };
  const send = async (i: InvoiceListItem) => {
    try {
      await api.invoices.send(i.id);
      await refresh();
      onNotice(`${i.number} sent.`, 'success');
    } catch (e) {
      onNotice(errorMessage(e, INVOICE_ERRORS), 'error');
    }
  };
  const menu = (i: InvoiceListItem): ActionMenuSection[] => {
    const open = i.status === 'OPEN';
    const draft = i.status === 'DRAFT';
    const cancelable = (draft || i.status === 'SCHEDULED' || open) && paidCents(i) === 0;
    return [
      {
        title: 'Invoice',
        items: [
          { label: 'View Invoice', icon: Eye, onSelect: () => router.push(`/invoices/${i.id}`) },
          ...(canChange && draft
            ? [
                {
                  label: 'Edit Invoice',
                  icon: PencilSimple,
                  onSelect: () => router.push(`/invoices/${i.id}/edit`),
                },
              ]
            : []),
          ...(canChange
            ? [
                {
                  label: 'Duplicate Invoice',
                  icon: Copy,
                  onSelect: () => router.push(`/invoices/new?from=${i.id}`),
                },
              ]
            : []),
        ],
      },
      ...(canChange && draft
        ? [
            {
              title: 'Send & Collect',
              items: [
                { label: 'Send Invoice', icon: PaperPlaneTilt, onSelect: () => void send(i) },
              ],
            },
          ]
        : []),
      {
        title: 'Payments',
        items: [
          ...(canChange && open
            ? [
                {
                  label: 'Record Payment',
                  icon: Receipt,
                  onSelect: () => router.push(`/invoices/record-payment?invoice=${i.id}`),
                },
              ]
            : []),
          {
            label: 'View Payments',
            icon: ListBullets,
            onSelect: () => router.push(`/invoices/${i.id}#payments`),
          },
        ],
      },
      {
        title: 'Client & Follow-Up',
        items: [
          {
            label: 'View Client Profile',
            icon: User,
            onSelect: () => router.push(`/clients/${i.client.id}`),
          },
          { label: 'Send Message', icon: ChatCircleDots, onSelect: () => router.push('/messages') },
        ],
      },
      ...(canChange && cancelable
        ? [
            {
              title: 'Manage Invoice',
              items: [
                {
                  label: 'Cancel Invoice',
                  icon: Prohibit,
                  danger: true,
                  onSelect: () => setCanceling(i),
                },
              ],
            },
          ]
        : []),
    ];
  };
  const actions = (i: InvoiceListItem) => (
    <ActionMenu
      label={`Actions for ${i.number}`}
      align="right"
      trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
      sections={menu(i)}
    />
  );
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allShown = shown.length > 0 && shown.every((i) => selected.includes(i.id));

  return (
    <section className={card} aria-label="Invoices" data-testid="invoice-list">
      <Tabs
        variant="underline"
        label="Invoice views"
        items={tabs}
        value={tab}
        onChange={(id) => {
          setTab(id as Tab);
          setPage(1);
        }}
      />
      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)_auto]">
        <Select
          label="Client"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setPage(1);
          }}
          options={[{ value: '', label: 'All Clients' }, ...clients]}
        />
        <Select
          label="Service Type"
          value={service}
          onChange={(e) => {
            setService(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Services' },
            ...services.map((s) => ({ value: s, label: s })),
          ]}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All Statuses' },
            ...VIEW_ORDER.map((v) => ({ value: v, label: VIEW_LABEL[v] })),
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
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
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <label className="relative flex flex-col gap-1 self-end">
          <span className="sr-only">Search invoices</span>
          <MagnifyingGlass
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search invoices, clients, or invoice #..."
            className="min-h-11 w-full rounded-control border border-control-border bg-surface pr-3 pl-9 text-sm"
          />
        </label>
        <button type="button" className={`${linkBtn} self-end pb-3 text-danger!`} onClick={clear}>
          Clear
        </button>
      </div>
      {canChange && selected.length > 0 ? (
        <div className="mt-3">
          <BulkBar
            count={selected.length}
            noun="invoices"
            actions={
              drafts.length > 0 && !busy
                ? [
                    {
                      label: `Send ${drafts.length} draft${drafts.length === 1 ? '' : 's'}`,
                      icon: PaperPlaneTilt,
                      onClick: () => void sendDrafts(),
                    },
                  ]
                : []
            }
          />
        </div>
      ) : null}
      {loading ? (
        <p className={`${quiet} mt-4`}>Loading invoices…</p>
      ) : rows.length === 0 ? (
        <p className={`${quiet} mt-4`}>
          {failed
            ? 'Invoices could not be loaded.'
            : items.length === 0
              ? 'No invoices yet.'
              : 'No invoices match these filters.'}
        </p>
      ) : (
        <>
          <div className="mt-4 hidden overflow-x-auto xl:block">
            <table
              className="w-full text-left text-xs 2xl:text-sm [&_td]:px-1.5 [&_th]:px-1.5"
              data-testid="invoices-table"
            >
              <caption className="sr-only">Invoices</caption>
              <thead className="bg-canvas text-xs text-heading">
                <tr>
                  <th className="p-2">
                    <input
                      type="checkbox"
                      aria-label="Select every invoice on this page"
                      checked={allShown}
                      onChange={() =>
                        setSelected(
                          allShown
                            ? selected.filter((id) => !shown.some((i) => i.id === id))
                            : [...new Set([...selected, ...shown.map((i) => i.id)])],
                        )
                      }
                      className="size-4"
                    />
                  </th>
                  <th className="p-2 font-semibold">Invoice #</th>
                  <th className="p-2 font-semibold">Client Name</th>
                  <th className="p-2 font-semibold">Service</th>
                  <th className="p-2 font-semibold">Invoice Date</th>
                  <th className="p-2 font-semibold">Due Date</th>
                  <th className="p-2 text-right font-semibold">Amount</th>
                  <th className="p-2 text-right font-semibold">Paid</th>
                  <th className="p-2 text-right font-semibold">Balance</th>
                  <th className="p-2 font-semibold">Status</th>
                  <th className="p-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="border-b border-divider" data-testid="invoice-row">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${i.number}`}
                        checked={selected.includes(i.id)}
                        onChange={() => toggle(i.id)}
                        className="size-4"
                      />
                    </td>
                    <td className="p-2 font-semibold whitespace-nowrap">
                      <Link href={`/invoices/${i.id}`} className="text-link">
                        {i.number}
                      </Link>
                    </td>
                    <td className="p-2">{i.client.displayName}</td>
                    <td className="p-2">{i.service?.title ?? i.title}</td>
                    <td className="p-2 whitespace-nowrap">{dayText(invoiceDay(i))}</td>
                    <td className="p-2 whitespace-nowrap">{dayText(i.dueOn)}</td>
                    <td className="p-2 text-right">{money(i.totalCents, i.currency)}</td>
                    <td className={`p-2 text-right ${paidCents(i) > 0 ? 'text-success' : ''}`}>
                      {money(paidCents(i), i.currency)}
                    </td>
                    <td className="p-2 text-right">{money(i.balanceDueCents, i.currency)}</td>
                    <td className="p-2">
                      <ViewPill invoice={i} />
                    </td>
                    <td className="p-2">{actions(i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 flex flex-col gap-3 xl:hidden" data-testid="invoices-cards">
            {shown.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-2 rounded-lg border border-divider p-3"
                data-testid="invoice-card"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/invoices/${i.id}`} className="font-semibold text-link">
                    {i.number}
                  </Link>
                  {actions(i)}
                </div>
                <p className="wrap-anywhere">
                  <span className="font-medium text-heading">{i.client.displayName}</span> ·{' '}
                  {i.service?.title ?? i.title}
                </p>
                <p className="text-sm text-muted">
                  Due {dayText(i.dueOn)} · {money(i.totalCents, i.currency)} · Balance{' '}
                  {money(i.balanceDueCents, i.currency)}
                </p>
                <ViewPill invoice={i} />
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <Pagination
              page={current}
              onPage={setPage}
              pageCount={pages}
              summary={`Showing ${(current - 1) * size + 1}–${Math.min(current * size, rows.length)} of ${rows.length} invoices`}
              pageSize={size}
              pageSizes={[10, 25, 50]}
              onPageSize={(n) => {
                setSize(n);
                setPage(1);
              }}
            />
          </div>
        </>
      )}
      {canceling ? (
        <InvoiceCancelForm invoice={canceling} onClose={() => setCanceling(undefined)} />
      ) : null}
    </section>
  );
}

function Side({ paymentsEnabled, loaded }: { paymentsEnabled?: boolean; loaded: boolean }) {
  const links = [
    { href: '/invoices/new', label: 'Create Invoice', icon: FileText, change: true },
    { href: '/invoices/record-payment', label: 'Record Payment', icon: Receipt, change: true },
    { href: '/templates', label: 'Invoice Templates', icon: Copy, change: false },
    { href: '/services-pricing', label: 'Services & Pricing', icon: ListBullets, change: false },
    { href: '/reports', label: 'Payment Reports', icon: ChartBar, change: false },
  ];
  return (
    <aside
      className="grid min-w-0 content-start gap-5 sm:grid-cols-2 xl:grid-cols-1"
      aria-label="Invoice tools"
    >
      <section className={card} aria-labelledby="inv-quick">
        <h2 id="inv-quick" className="mb-2 font-display text-lg font-bold text-heading">
          Quick Links
        </h2>
        <ul className="flex flex-col gap-1">
          {links.map((l) => {
            const item = (
              <li key={l.href}>
                <Link href={l.href} className="flex min-h-9 items-center gap-3 text-sm text-link">
                  <l.icon aria-hidden weight="fill" className="size-5 text-action" />
                  {l.label}
                </Link>
              </li>
            );
            return l.change ? (
              <RequireRole key={l.href} roles={['OWNER', 'ADMIN']}>
                {item}
              </RequireRole>
            ) : (
              item
            );
          })}
        </ul>
      </section>
      <section className={card} aria-labelledby="inv-gateway" data-testid="payment-gateway">
        <h2 id="inv-gateway" className="mb-2 font-display text-lg font-bold text-heading">
          Payment Gateway
        </h2>
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-display text-2xl font-bold text-action">
            <CreditCard aria-hidden weight="fill" className="size-6" /> Stripe
          </span>
          {loaded ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${paymentsEnabled ? 'bg-success-soft text-success' : 'bg-warning-soft text-gold'}`}
            >
              {paymentsEnabled ? 'Connected' : 'Not set up'}
            </span>
          ) : null}
        </div>
        <p className="mb-3 text-xs text-muted">
          {!loaded
            ? 'The payment status shows once invoices load.'
            : paymentsEnabled
              ? 'Clients can pay invoices online by card or bank transfer.'
              : 'Clients cannot pay online yet. You can still create and send invoices.'}
        </p>
        <RequireRole roles={['OWNER', 'ADMIN']}>
          <Link href="/settings/payments" className={`${outlined} w-full`}>
            Manage Payment Settings
          </Link>
        </RequireRole>
      </section>
      <section className={card} aria-labelledby="inv-auto">
        <h2 id="inv-auto" className="mb-2 font-display text-lg font-bold text-heading">
          Automations
        </h2>
        <p className="mb-3 text-sm text-muted">
          Payment reminders, overdue notices and receipts run as firm automations.
        </p>
        <Link href="/automations" className={`${outlined} w-full`}>
          <Lightning aria-hidden weight="fill" className="size-5 text-action" /> Manage Automations
        </Link>
      </section>
      <section className={card} aria-labelledby="inv-help">
        <h2
          id="inv-help"
          className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading"
        >
          <Lifebuoy aria-hidden weight="fill" className="size-6 text-danger" /> Need Help?
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <Link href="/settings/payments" className={linkBtn}>
              Setting Up Payments <ArrowSquareOut aria-hidden className="size-3.5" />
            </Link>
          </li>
          <li>
            <Link href="/services-pricing" className={linkBtn}>
              Services &amp; Pricing <ArrowSquareOut aria-hidden className="size-3.5" />
            </Link>
          </li>
        </ul>
      </section>
    </aside>
  );
}
