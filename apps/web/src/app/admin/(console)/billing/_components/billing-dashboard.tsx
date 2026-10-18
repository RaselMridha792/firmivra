'use client';

import {
  ActionMenu,
  DateRangePicker,
  FilterBar,
  FilterChip,
  FilterGroup,
  type DateRange,
} from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  CalendarBlank,
  CaretDown,
  Clock,
  CurrencyCircleDollar,
  FileText,
  MagnifyingGlass,
  NotePencil,
  Plus,
  Receipt,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import {
  adminBilling,
  INVOICE_STATUSES,
  INVOICE_TYPES,
  type BillingInvoice,
  type InvoiceQuery,
  type InvoiceSort,
  type InvoiceStatus,
  type InvoiceType,
} from '../../../../../mocks/admin-billing';
import { useApiQuery } from '../../../../../lib/query';
import { inputClass, SelectControl } from './billing-fields';
import {
  formatDate,
  formatMoney,
  parseMoney,
  periodRange,
  PERIODS,
  plural,
  type Period,
} from './billing-format';
import { INVOICE_STATUS_LABELS, INVOICE_TYPE_LABELS, optionsOf } from './billing-labels';
import { BillingKpiCard, BillingNotice, InvoiceStatusBadge, useNotice } from './billing-parts';
import { BillingHeader, BillingTabs, FirmSelect, useBillingFirm } from './billing-shell';
import {
  BillingPager,
  BillingTable,
  RowMenu,
  type BillingColumn,
  type BillingSort,
} from './billing-table';
import { useInvoiceActions } from './invoice-actions';
import { QuickActions } from './quick-actions';

/**
 * The Billing dashboard (modern-saas-billing-dashboard.jpg, docx §6): firm filter, Create
 * Invoice, the four totals, the Billing tabs, the invoice list with its filters and row actions,
 * and Quick Actions. The totals come from the same filters as the list.
 */

const PAGE_SIZE = 10;

interface MoreFilters {
  clientId: string;
  type: InvoiceType | '';
  due: DateRange;
  min: string;
  max: string;
}
const NO_MORE: MoreFilters = {
  clientId: '',
  type: '',
  due: { from: '', to: '' },
  min: '',
  max: '',
};

/** "+ Create Invoice" with its menu of the other create shortcuts (docx §6.1). */
function CreateInvoiceButton() {
  const router = useRouter();
  return (
    <div className="inline-flex h-12 items-stretch rounded-lg bg-action text-on-action shadow-sm">
      <Link
        href="/billing/invoices/new"
        className="inline-flex items-center gap-2 rounded-l-lg px-5 text-base font-semibold hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <Plus aria-hidden weight="bold" className="size-5" />
        Create Invoice
      </Link>
      <span aria-hidden className="my-2.5 w-px bg-on-action/40" />
      <ActionMenu
        label="More create options"
        align="right"
        trigger={<span className="sr-only">More create options</span>}
        sections={[
          {
            items: [
              {
                label: 'Create Estimate',
                icon: NotePencil,
                onSelect: () => router.push('/billing/estimates/new'),
              },
              {
                label: 'Create Credit Note',
                icon: Receipt,
                onSelect: () => router.push('/billing/credit-notes/new'),
              },
              {
                label: 'Set Up Recurring Invoice',
                icon: ArrowCounterClockwise,
                onSelect: () => router.push('/billing/recurring?create=1'),
              },
            ],
          },
        ]}
        className="flex [&>button]:h-full [&>button]:rounded-l-none [&>button]:rounded-r-lg [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-3 [&>button]:text-on-action [&>button]:hover:bg-action-hover"
      />
    </div>
  );
}

export function BillingDashboard() {
  const [firmId, setFirmId] = useBillingFirm();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [period, setPeriod] = useState<Period>('all');
  const [more, setMore] = useState<MoreFilters>(NO_MORE);
  const [draft, setDraft] = useState<MoreFilters>(NO_MORE);
  const [sort, setSort] = useState<BillingSort | undefined>();
  const [page, setPage] = useState(1);
  const [notice, showNotice, clearNotice] = useNotice();
  const actions = useInvoiceActions(showNotice);

  const minCents = more.min ? parseMoney(more.min) : null;
  const maxCents = more.max ? parseMoney(more.max) : null;
  const filters: InvoiceQuery = {
    ...(firmId ? { firmId } : {}),
    ...(term ? { search: term } : {}),
    ...(status ? { status } : {}),
    ...periodRange(period),
    ...(more.clientId ? { clientId: more.clientId } : {}),
    ...(more.type ? { type: more.type } : {}),
    ...(more.due.from ? { dueFrom: more.due.from } : {}),
    ...(more.due.to ? { dueTo: more.due.to } : {}),
    ...(minCents !== null ? { minCents } : {}),
    ...(maxCents !== null ? { maxCents } : {}),
  };
  const summary = useApiQuery(['admin-billing', 'invoice-summary', filters], () =>
    adminBilling.invoiceSummary(filters),
  );
  const list = useApiQuery(['admin-billing', 'invoices', filters, sort ?? null, page], () =>
    adminBilling.invoices({
      ...filters,
      ...(sort ? { sort: sort.sort as InvoiceSort, descending: sort.descending } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const clients = useApiQuery(['admin-billing', 'clients', firmId || 'all'], () =>
    adminBilling.clients(firmId ? { firmId } : {}),
  );

  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const chips = [
    ...(more.clientId
      ? [
          {
            label: `Client: ${clients.data?.find((client) => client.id === more.clientId)?.name ?? '…'}`,
            clear: { clientId: '' },
          },
        ]
      : []),
    ...(more.type
      ? [{ label: `Type: ${INVOICE_TYPE_LABELS[more.type]}`, clear: { type: '' as const } }]
      : []),
    ...(more.due.from || more.due.to
      ? [
          {
            label: `Due: ${more.due.from ? formatDate(more.due.from) : '…'} – ${more.due.to ? formatDate(more.due.to) : '…'}`,
            clear: { due: { from: '', to: '' } },
          },
        ]
      : []),
    ...(minCents !== null || maxCents !== null
      ? [
          {
            label: `Amount: ${minCents !== null ? formatMoney(minCents) : 'any'} – ${maxCents !== null ? formatMoney(maxCents) : 'any'}`,
            clear: { min: '', max: '' },
          },
        ]
      : []),
  ];

  const columns: BillingColumn<BillingInvoice>[] = [
    {
      id: 'number',
      label: 'Invoice #',
      sort: 'number',
      cell: (row) => (
        <Link
          href={`/billing/invoices/${row.id}`}
          className="font-medium whitespace-nowrap text-heading hover:text-action hover:underline"
        >
          {row.number}
        </Link>
      ),
    },
    { id: 'client', label: 'Client / Event', sort: 'client', cell: (row) => row.clientName },
    { id: 'firm', label: 'Firm', sort: 'firm', cell: (row) => row.firmName },
    {
      id: 'issueDate',
      label: 'Issue Date',
      sort: 'issueDate',
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.issueDate)}</span>,
    },
    {
      id: 'dueDate',
      label: 'Due Date',
      sort: 'dueDate',
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.dueDate)}</span>,
    },
    {
      id: 'amount',
      label: 'Amount',
      sort: 'amount',
      cell: (row) => (
        <span className="whitespace-nowrap">{formatMoney(row.totalCents, row.currency)}</span>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      sort: 'status',
      cell: (row) => <InvoiceStatusBadge status={row.status} />,
    },
  ];

  const s = summary.data;
  const kpi = { loading: summary.isLoading, failed: summary.isError };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title="Billing"
        subtitle="Manage invoices, payments, subscriptions, estimates and credit notes across all firms."
        actions={
          <>
            <FirmSelect value={firmId} onChange={reset(setFirmId)} className="w-full sm:w-56" />
            <CreateInvoiceButton />
          </>
        }
      />

      <section aria-label="Billing totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <BillingKpiCard
          testId="kpi-invoiced"
          icon={FileText}
          tone="blue"
          label="Total Invoiced"
          value={formatMoney(s?.invoicedCents ?? 0)}
          trend={s?.invoicedTrend}
          note={`Across ${plural(s?.invoicedCount ?? 0, 'invoice')}`}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-paid"
          icon={CurrencyCircleDollar}
          tone="green"
          label="Total Paid"
          value={formatMoney(s?.paidCents ?? 0)}
          trend={s?.paidTrend}
          note={plural(s?.paidCount ?? 0, 'invoice')}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-outstanding"
          icon={Clock}
          tone="amber"
          label="Outstanding"
          value={formatMoney(s?.outstandingCents ?? 0)}
          note={plural(s?.outstandingCount ?? 0, 'invoice')}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-overdue"
          icon={WarningCircle}
          tone="red"
          label="Overdue"
          value={formatMoney(s?.overdueCents ?? 0)}
          note={plural(s?.overdueCount ?? 0, 'invoice')}
          {...kpi}
        />
      </section>

      <section aria-label="Invoices" className="flex min-w-0 flex-col gap-4">
        <BillingTabs active="invoices" />
        <div data-testid="invoice-filters" className="flex flex-col gap-3">
          <FilterBar
            onApply={() => {
              setMore(draft);
              setPage(1);
            }}
            onClear={() => {
              setDraft(NO_MORE);
              setMore(NO_MORE);
              setPage(1);
            }}
            more={
              <>
                <FilterGroup title="Client">
                  <SelectControl
                    aria-label="Client"
                    value={draft.clientId}
                    placeholder="All clients"
                    options={(clients.data ?? []).map((client) => ({
                      value: client.id,
                      label: client.name,
                    }))}
                    onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}
                  />
                </FilterGroup>
                <FilterGroup title="Invoice Type">
                  <SelectControl
                    aria-label="Invoice type"
                    value={draft.type}
                    placeholder="All types"
                    options={optionsOf(INVOICE_TYPES, INVOICE_TYPE_LABELS)}
                    onChange={(event) =>
                      setDraft({ ...draft, type: event.target.value as InvoiceType | '' })
                    }
                  />
                </FilterGroup>
                <FilterGroup title="Due Date">
                  <DateRangePicker
                    label="Due between"
                    value={draft.due}
                    onChange={(due) => setDraft({ ...draft, due })}
                  />
                </FilterGroup>
                <FilterGroup title="Amount">
                  <div className="flex gap-2">
                    <input
                      aria-label="Minimum amount"
                      inputMode="decimal"
                      placeholder="Min $"
                      value={draft.min}
                      onChange={(event) => setDraft({ ...draft, min: event.target.value })}
                      className={inputClass()}
                    />
                    <input
                      aria-label="Maximum amount"
                      inputMode="decimal"
                      placeholder="Max $"
                      value={draft.max}
                      onChange={(event) => setDraft({ ...draft, max: event.target.value })}
                      className={inputClass()}
                    />
                  </div>
                </FilterGroup>
              </>
            }
          >
            <label className="relative block w-full min-w-0 md:w-auto md:flex-1 xl:max-w-xl">
              <span className="sr-only">Search invoices</span>
              <MagnifyingGlass
                aria-hidden
                weight="bold"
                className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-heading"
              />
              <input
                type="search"
                maxLength={100}
                value={search}
                placeholder="Search invoices by client, number, or event..."
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="h-12 w-full min-w-0 rounded-lg border border-divider bg-surface pr-3 pl-12 text-base text-text placeholder:text-muted focus:outline-2 focus:outline-focus"
              />
            </label>
            <div className="flex w-full flex-wrap gap-3 md:w-auto xl:ml-auto">
              <label className="relative block min-w-0 flex-1 md:w-48 md:flex-none">
                <span className="sr-only">Status</span>
                <select
                  value={status}
                  onChange={(event) => reset(setStatus)(event.target.value as InvoiceStatus | '')}
                  className="h-12 w-full appearance-none rounded-lg border border-divider bg-surface pr-10 pl-4 text-base text-text focus:outline-2 focus:outline-focus"
                >
                  <option value="">All Statuses</option>
                  {optionsOf(INVOICE_STATUSES, INVOICE_STATUS_LABELS).map((option) => (
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
              <label className="relative block min-w-0 flex-1 md:w-48 md:flex-none">
                <span className="sr-only">Issue date</span>
                <CalendarBlank
                  aria-hidden
                  weight="fill"
                  className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-heading"
                />
                <select
                  value={period}
                  onChange={(event) => reset(setPeriod)(event.target.value as Period)}
                  className="h-12 w-full appearance-none rounded-lg border border-divider bg-surface pr-10 pl-12 text-base text-text focus:outline-2 focus:outline-focus"
                >
                  {PERIODS.map((option) => (
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
            </div>
          </FilterBar>
          {chips.length ? (
            <div aria-label="Active filters" className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <FilterChip
                  key={chip.label}
                  label={chip.label}
                  onRemove={() => {
                    const next = { ...more, ...chip.clear };
                    setMore(next);
                    setDraft(next);
                    setPage(1);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>

        <BillingTable
          testId="invoice-table"
          caption="Invoices"
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={list.isLoading}
          error={list.error}
          emptyText={
            Object.keys(filters).length ? 'No invoices match these filters.' : 'No invoices yet.'
          }
          sort={sort}
          onSort={(next) => {
            setSort(next);
            setPage(1);
          }}
          actions={(row) => (
            <RowMenu label={`Actions for ${row.number}`} sections={actions.menu(row)} />
          )}
        />
        <BillingPager
          page={list.data?.page ?? page}
          pageCount={list.data?.pageCount ?? 1}
          total={list.data?.total ?? 0}
          pageSize={PAGE_SIZE}
          noun="invoices"
          onPage={setPage}
          loading={list.isLoading}
        />
      </section>

      <QuickActions />
      {actions.dialogs}
      <BillingNotice notice={notice} onDismiss={clearNotice} />
    </div>
  );
}
