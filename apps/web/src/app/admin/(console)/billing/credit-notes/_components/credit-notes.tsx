'use client';

import { FilterChip, Skeleton } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowUUpLeft,
  CalendarBlank,
  CaretDown,
  CheckCircle,
  Clock,
  CurrencyCircleDollar,
  FileText,
  MagnifyingGlass,
  Plus,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import {
  adminBilling,
  CREDIT_NOTE_STATUSES,
  type BillingCreditNote,
  type CreditNoteQuery,
  type CreditNoteSort,
  type CreditNoteStatus,
} from '../../../../../../mocks/admin-billing';
import { useApiQuery } from '../../../../../../lib/query';
import { formatDate, formatMoney } from '../../_components/billing-format';
import { CREDIT_NOTE_STATUS_LABELS, optionsOf } from '../../_components/billing-labels';
import {
  BillingNotice,
  BillingTile,
  CreditNoteStatusBadge,
  useNotice,
  type BillingTone,
} from '../../_components/billing-parts';
import { BillingHeader, useBillingFirm } from '../../_components/billing-shell';
import {
  BillingPager,
  BillingTable,
  RowMenu,
  type BillingColumn,
  type BillingSort,
} from '../../_components/billing-table';
import { useCreditNoteActions } from './credit-note-actions';
import { CreditNoteDrawer } from './credit-note-drawer';

/**
 * Credit Notes (firmivra-credit-notes-dashboard.jpg, docx §13): the history of every credit
 * note. Five totals, filters, the list and the Credit Note Details drawer. `openId` (`?note=`)
 * opens a note's drawer, `saved` (`?saved=`) says what Create Credit Note just did.
 */

const PAGE_SIZE = 10;

const SAVED: Record<string, string> = {
  issued: 'Credit note issued.',
  draft: 'Credit note saved as a draft.',
};

const field =
  'h-11 w-full min-w-0 rounded-lg border border-divider bg-surface text-base text-text focus:outline-2 focus:outline-focus';

/** One of the five totals: a soft tile, the label and the value (smaller than the dashboard's). */
function CreditKpi({
  icon,
  tone,
  label,
  value,
  note,
  loading,
  failed,
  testId,
}: {
  icon: Icon;
  tone: BillingTone;
  label: string;
  value: string;
  note?: string;
  loading: boolean;
  failed: boolean;
  testId: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className="flex min-w-0 items-center gap-3 rounded-xl bg-surface p-4 shadow-sm"
    >
      <BillingTile icon={icon} tone={tone} size="sm" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm text-muted">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p
            data-testid={`${testId}-value`}
            className="text-xl leading-tight font-bold text-heading 2xl:text-2xl"
          >
            {failed ? (
              <>
                <span aria-hidden>—</span>
                <span className="sr-only">Not available right now</span>
              </>
            ) : (
              value
            )}
          </p>
        )}
        {note && !loading && !failed ? <p className="text-xs text-muted">{note}</p> : null}
      </div>
    </section>
  );
}

/** One end of the date range: the placeholder text shows until a date is picked. */
function RangeEdge({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative flex min-w-0 flex-1 items-center sm:w-28 sm:flex-none">
      <span className="sr-only">{label}</span>
      <input
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => event.currentTarget.showPicker?.()}
        className={`peer min-h-0 w-full min-w-0 bg-transparent text-sm outline-none [&::-webkit-calendar-picker-indicator]:hidden ${value ? 'text-text' : 'text-transparent focus:text-text'}`}
      />
      {value ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 text-sm text-muted peer-focus:invisible"
        >
          {label}
        </span>
      )}
    </label>
  );
}

export function CreditNotes({ openId, saved }: { openId: string | null; saved: string | null }) {
  const router = useRouter();
  const [firmId, setFirmId] = useBillingFirm();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [status, setStatus] = useState<CreditNoteStatus | ''>('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<BillingSort | undefined>();
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<string | null>(openId);
  const [noteParam, setNoteParam] = useState(openId);
  const savedText = saved ? SAVED[saved] : undefined;
  const [notice, showNotice, clearNotice] = useNotice(
    savedText ? { tone: 'success', message: savedText } : null,
  );
  const actions = useCreditNoteActions(showNotice, (note) => setViewing(note.id));

  // `?note=` again while this page is open (the prop changes, the state stays).
  if (openId !== noteParam) {
    setNoteParam(openId);
    if (openId) setViewing(openId);
  }

  const filters: CreditNoteQuery = {
    ...(firmId ? { firmId } : {}),
    ...(term ? { search: term } : {}),
    ...(status ? { status } : {}),
    ...(clientId ? { clientId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const summary = useApiQuery(['admin-billing', 'credit-note-summary', filters], () =>
    adminBilling.creditNoteSummary(filters),
  );
  const list = useApiQuery(['admin-billing', 'credit-notes', filters, sort ?? null, page], () =>
    adminBilling.creditNotes({
      ...filters,
      ...(sort ? { sort: sort.sort as CreditNoteSort, descending: sort.descending } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const clients = useApiQuery(['admin-billing', 'clients', firmId || 'all'], () =>
    adminBilling.clients(firmId ? { firmId } : {}),
  );

  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  function clearAll() {
    setSearch('');
    setStatus('');
    setClientId('');
    setFrom('');
    setTo('');
    setFirmId('');
    setPage(1);
  }
  function closeDrawer() {
    setViewing(null);
    if (openId) router.replace('/billing/credit-notes', { scroll: false });
  }

  const columns: BillingColumn<BillingCreditNote>[] = [
    {
      id: 'number',
      label: 'Credit Note #',
      sort: 'number',
      cell: (row) => (
        <button
          type="button"
          onClick={() => setViewing(row.id)}
          className="font-medium whitespace-nowrap text-link underline hover:text-action-hover"
        >
          {row.number}
        </button>
      ),
    },
    { id: 'client', label: 'Customer', sort: 'client', cell: (row) => row.clientName },
    {
      id: 'invoice',
      label: 'Related Invoice',
      sort: 'invoice',
      cell: (row) =>
        row.invoiceId && row.invoiceNumber ? (
          <Link
            href={`/billing/invoices/${row.invoiceId}`}
            className="whitespace-nowrap text-link underline hover:text-action-hover"
          >
            {row.invoiceNumber}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: 'date',
      label: 'Date Issued',
      sort: 'date',
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.date)}</span>,
    },
    {
      id: 'amount',
      label: 'Original Amount',
      sort: 'amount',
      align: 'right',
      cell: (row) => (
        <span className="whitespace-nowrap">{formatMoney(row.totalCents, row.currency)}</span>
      ),
    },
    {
      id: 'applied',
      label: 'Applied Amount',
      sort: 'applied',
      align: 'right',
      cell: (row) => (
        <span className="whitespace-nowrap">{formatMoney(row.appliedCents, row.currency)}</span>
      ),
    },
    {
      id: 'remaining',
      label: 'Remaining Credit',
      sort: 'remaining',
      align: 'right',
      cell: (row) => (
        <span className="whitespace-nowrap">{formatMoney(row.remainingCents, row.currency)}</span>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      sort: 'status',
      cell: (row) => <CreditNoteStatusBadge status={row.status} />,
    },
  ];

  const firmName = firms.data?.find((firm) => firm.id === firmId)?.name;
  const filtered = Object.keys(filters).length > 0;
  const s = summary.data;
  const kpi = { loading: summary.isLoading, failed: summary.isError };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title="Credit Notes"
        subtitle="View and manage all credit notes issued to your customers."
        breadcrumbs={[{ label: 'Billing', href: '/billing' }, { label: 'Credit Notes' }]}
        actions={
          <Link
            href="/billing/credit-notes/new"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Plus aria-hidden weight="bold" className="size-5" />
            Create Credit Note
          </Link>
        }
      />

      <section
        aria-label="Credit note totals"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-5"
      >
        <CreditKpi
          testId="kpi-count"
          icon={FileText}
          tone="blue"
          label="Total Credit Notes"
          value={String(s?.count ?? 0)}
          note={from || to ? 'In the selected dates' : 'All time'}
          {...kpi}
        />
        <CreditKpi
          testId="kpi-issued"
          icon={CurrencyCircleDollar}
          tone="green"
          label="Total Amount Issued"
          value={formatMoney(s?.issuedCents ?? 0)}
          {...kpi}
        />
        <CreditKpi
          testId="kpi-applied"
          icon={CheckCircle}
          tone="green"
          label="Applied Amount"
          value={formatMoney(s?.appliedCents ?? 0)}
          {...kpi}
        />
        <CreditKpi
          testId="kpi-available"
          icon={Clock}
          tone="amber"
          label="Available Credit"
          value={formatMoney(s?.availableCents ?? 0)}
          {...kpi}
        />
        <CreditKpi
          testId="kpi-refunded"
          icon={ArrowUUpLeft}
          tone="red"
          label="Refunded Amount"
          value={formatMoney(s?.refundedCents ?? 0)}
          {...kpi}
        />
      </section>

      <section
        aria-label="Credit note filters"
        data-testid="credit-note-filters"
        className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative block w-full min-w-0 lg:w-auto lg:flex-1">
            <span className="sr-only">Search credit notes</span>
            <MagnifyingGlass
              aria-hidden
              weight="bold"
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-heading"
            />
            <input
              type="search"
              maxLength={100}
              value={search}
              placeholder="Search credit notes..."
              onChange={(event) => reset(setSearch)(event.target.value)}
              className={`${field} pr-3 pl-12 placeholder:text-muted`}
            />
          </label>
          <label className="relative block min-w-0 flex-1 sm:w-44 sm:flex-none">
            <span className="sr-only">Status</span>
            <select
              value={status}
              onChange={(event) => reset(setStatus)(event.target.value as CreditNoteStatus | '')}
              className={`${field} appearance-none pr-10 pl-4`}
            >
              <option value="">All Statuses</option>
              {optionsOf(CREDIT_NOTE_STATUSES, CREDIT_NOTE_STATUS_LABELS).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <CaretDown
              aria-hidden
              weight="bold"
              className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-heading"
            />
          </label>
          <label className="relative block min-w-0 flex-1 sm:w-56 sm:flex-none">
            <span className="sr-only">Customer</span>
            <select
              value={clientId}
              onChange={(event) => reset(setClientId)(event.target.value)}
              className={`${field} appearance-none pr-10 pl-4`}
            >
              <option value="">All Customers</option>
              {(clients.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            <CaretDown
              aria-hidden
              weight="bold"
              className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-heading"
            />
          </label>
          <div
            role="group"
            aria-label="Date issued"
            className="flex h-11 w-full min-w-0 items-center gap-3 rounded-lg border border-divider bg-surface px-4 focus-within:outline-2 focus-within:outline-focus sm:w-auto"
          >
            <CalendarBlank aria-hidden weight="fill" className="size-5 shrink-0 text-heading" />
            <RangeEdge label="Start date" value={from} max={to} onChange={reset(setFrom)} />
            <ArrowRight aria-hidden weight="bold" className="size-4 shrink-0 text-muted" />
            <RangeEdge label="End date" value={to} min={from} onChange={reset(setTo)} />
          </div>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-divider bg-surface px-5 text-base font-semibold text-action hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-focus lg:ml-auto"
          >
            Clear
          </button>
        </div>
        {firmId ? (
          <div aria-label="Active filters" className="flex flex-wrap gap-2">
            <FilterChip
              label={`Firm: ${firmName ?? '…'}`}
              onRemove={() => {
                setFirmId('');
                setClientId('');
                setPage(1);
              }}
            />
          </div>
        ) : null}
      </section>

      <section
        aria-label="Credit notes"
        className="flex min-w-0 flex-col gap-4 rounded-xl bg-surface p-4 shadow-sm"
      >
        <BillingTable
          testId="credit-note-table"
          caption="Credit notes"
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={list.isLoading}
          error={list.error}
          emptyText={
            filtered ? 'No credit notes match these filters.' : 'No credit notes issued yet.'
          }
          sort={sort}
          onSort={reset(setSort)}
          actions={(row) => (
            <RowMenu label={`Actions for ${row.number}`} sections={actions.menu(row)} />
          )}
        />
        <BillingPager
          page={list.data?.page ?? page}
          pageCount={list.data?.pageCount ?? 1}
          total={list.data?.total ?? 0}
          pageSize={PAGE_SIZE}
          noun="credit notes"
          onPage={setPage}
          loading={list.isLoading}
        />
      </section>

      <CreditNoteDrawer noteId={viewing} actions={actions} onClose={closeDrawer} />
      {actions.dialogs}
      <BillingNotice notice={notice} onDismiss={clearNotice} />
    </div>
  );
}
