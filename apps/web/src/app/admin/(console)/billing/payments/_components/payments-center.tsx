'use client';

import { Button, FilterBar, FilterChip, FilterGroup, type ActionMenuSection } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  CalendarBlank,
  CaretDown,
  Cardholder,
  ChartBar,
  CreditCard,
  CurrencyCircleDollar,
  Eye,
  FileText,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useRef, useState, type SelectHTMLAttributes } from 'react';
import {
  adminBilling,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type BillingPayment,
  type PaymentMethod,
  type PaymentQuery,
  type PaymentSort,
  type PaymentStatus,
} from '../../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { RecordPaymentModal, RefundModal } from '../../_components/billing-actions';
import { SelectControl } from '../../_components/billing-fields';
import { formatDate, formatMoney, plural } from '../../_components/billing-format';
import {
  BILLING_ERRORS,
  INVOICE_STATUS_LABELS,
  optionsOf,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from '../../_components/billing-labels';
import { BillingKpiCard, BillingNotice, useNotice } from '../../_components/billing-parts';
import {
  BillingHeader,
  BillingTabs,
  FirmSelect,
  useBillingFirm,
} from '../../_components/billing-shell';
import {
  BillingPager,
  RowMenu,
  type BillingColumn,
  type BillingSort,
} from '../../_components/billing-table';
import { hasReceipt, PaymentPanel, type PanelState } from './payment-panel';
import { PaymentBadge, PaymentTable } from './payment-table';
import { ReceiptViewer } from './receipt-viewer';

/**
 * Payments (firmivra-payments-dashboard.jpg, docx §12): the payment transaction center. Totals,
 * the Billing tabs, filters, the payment list and the Payment Details side panel; Record
 * Payment, Issue Refund and the receipt viewer are dialogs on this page. From 1440 px the panel
 * sits beside the list, below that under it.
 */

const PAGE_SIZE = 10;
/** The width from which the details panel sits beside the list (min-[1440px]). */
const DOCKED = '(min-width: 90rem)';

interface MoreFilters {
  clientId: string;
  invoiceId: string;
}
const NO_MORE: MoreFilters = { clientId: '', invoiceId: '' };

const control =
  'h-10 w-full min-w-0 appearance-none rounded-lg border border-divider bg-surface text-sm text-text focus:outline-2 focus:outline-focus';

/** A filter select with the chevron, as drawn ("All Payment Methods"). */
function FilterSelect({
  label,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className={`relative block min-w-0 ${className}`}>
      <span className="sr-only">{label}</span>
      <select className={`${control} pr-10 pl-3`} {...props}>
        {children}
      </select>
      <CaretDown
        aria-hidden
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-heading"
      />
    </label>
  );
}

/** "Start Date" with the calendar icon; the date shows once picked (or while typing). */
function DateFilter({
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
    <label className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-sm text-text focus-within:outline-2 focus-within:outline-focus sm:w-52">
      <CalendarBlank aria-hidden weight="fill" className="size-5 shrink-0 text-heading" />
      <span className={value ? 'sr-only' : 'shrink-0 text-text'}>{label}</span>
      <input
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => event.currentTarget.showPicker?.()}
        className={`min-h-0 w-full min-w-0 bg-transparent outline-none [&::-webkit-calendar-picker-indicator]:hidden ${value ? 'text-text' : 'text-transparent focus:text-text'}`}
      />
    </label>
  );
}

export function PaymentsCenter() {
  const router = useRouter();
  const [firmId, setFirmId] = useBillingFirm();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [more, setMore] = useState<MoreFilters>(NO_MORE);
  const [draft, setDraft] = useState<MoreFilters>(NO_MORE);
  const [sort, setSort] = useState<BillingSort | undefined>();
  const [page, setPage] = useState(1);
  // undefined: the list's first payment (as drawn); null: the panel was closed.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const [recording, setRecording] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<BillingPayment | null>(null);
  const [notice, showNotice, clearNotice] = useNotice();
  const panelRef = useRef<HTMLElement>(null);

  const filters: PaymentQuery = {
    ...(firmId ? { firmId } : {}),
    ...(term ? { search: term } : {}),
    ...(method ? { method } : {}),
    ...(status ? { status } : {}),
    ...(start ? { from: start } : {}),
    ...(end ? { to: end } : {}),
    ...(more.clientId ? { clientId: more.clientId } : {}),
    ...(more.invoiceId ? { invoiceId: more.invoiceId } : {}),
  };
  const summary = useApiQuery(['admin-billing', 'payment-summary', filters], () =>
    adminBilling.paymentSummary(filters),
  );
  const list = useApiQuery(['admin-billing', 'payments', filters, sort ?? null, page], () =>
    adminBilling.payments({
      ...filters,
      ...(sort ? { sort: sort.sort as PaymentSort, descending: sort.descending } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const rows = list.data?.items ?? [];
  const activeId = chosen === undefined ? (rows[0]?.id ?? null) : chosen;
  const detail = useApiQuery(['admin-billing', 'payment', activeId ?? 'none'], () =>
    activeId ? adminBilling.payment(activeId) : Promise.resolve(null),
  );
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const clients = useApiQuery(['admin-billing', 'clients', firmId || 'all'], () =>
    adminBilling.clients(firmId ? { firmId } : {}),
  );
  const draftInvoices = useApiQuery(
    ['admin-billing', 'client-invoices', draft.clientId || 'none'],
    () =>
      draft.clientId
        ? adminBilling
            .invoices({ clientId: draft.clientId, pageSize: 100 })
            .then((result) => result.items)
        : Promise.resolve([]),
  );
  const sendReceipt = useApiMutation(
    (payment: BillingPayment) => adminBilling.sendReceipt(payment.id),
    {
      invalidate: ['admin-billing'],
    },
  );
  const fail = (error: unknown) =>
    showNotice({ tone: 'error', message: errorMessage(error, BILLING_ERRORS) });

  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  /** Another firm: its clients differ, so the client and invoice filters go too. */
  function changeFirm(id: string) {
    setFirmId(id);
    setMore(NO_MORE);
    setDraft(NO_MORE);
    setPage(1);
  }

  /** Opens a payment's details; below 1440 px the panel is under the list, so scroll to it. */
  function show(id: string) {
    setChosen(id);
    if (!window.matchMedia(DOCKED).matches) panelRef.current?.scrollIntoView({ block: 'start' });
  }

  function send(payment: BillingPayment) {
    sendReceipt.mutate(payment, {
      onSuccess: (sent) =>
        showNotice({
          tone: 'success',
          message: `Receipt ${sent.number} was sent to ${sent.clientName}.`,
        }),
      onError: fail,
    });
  }

  const menu = (row: BillingPayment): ActionMenuSection[] => {
    const receipt = hasReceipt(row);
    return [
      {
        items: [
          { label: 'View Details', icon: Eye, onSelect: () => show(row.id) },
          ...(receipt
            ? [
                { label: 'View Receipt', icon: FileText, onSelect: () => setReceiptFor(row) },
                { label: 'Send Receipt', icon: PaperPlaneTilt, onSelect: () => send(row) },
              ]
            : []),
        ],
      },
      {
        items: [
          ...(row.refundableCents > 0
            ? [
                {
                  label: 'Issue Refund',
                  icon: ArrowCounterClockwise,
                  onSelect: () => setRefunding(row.id),
                },
              ]
            : []),
          {
            label: 'View Invoice',
            icon: ArrowSquareOut,
            onSelect: () => router.push(`/billing/invoices/${row.invoiceId}`),
          },
        ],
      },
    ];
  };

  const columns: BillingColumn<BillingPayment>[] = [
    {
      id: 'paidOn',
      label: 'Payment Date',
      sort: 'paidOn',
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.paidOn)}</span>,
    },
    {
      id: 'client',
      label: 'Client / Event',
      sort: 'client',
      cell: (row) => (
        <button
          type="button"
          aria-pressed={row.id === activeId}
          title="Show the payment details"
          onClick={() => show(row.id)}
          className="text-left text-text hover:text-action hover:underline"
        >
          {row.clientName}
        </button>
      ),
    },
    { id: 'firm', label: 'Firm', sort: 'firm', cell: (row) => row.firmName },
    {
      id: 'invoice',
      label: 'Invoice #',
      sort: 'invoice',
      cell: (row) => <span className="whitespace-nowrap">{row.invoiceNumber}</span>,
    },
    {
      id: 'amount',
      label: 'Amount',
      sort: 'amount',
      cell: (row) => (
        <span className="whitespace-nowrap">{formatMoney(row.amountCents, row.currency)}</span>
      ),
    },
    {
      id: 'method',
      label: 'Payment Method',
      sort: 'method',
      cell: (row) => PAYMENT_METHOD_LABELS[row.method],
    },
    {
      id: 'reference',
      label: 'Reference / Transaction ID',
      cell: (row) => <span className="whitespace-nowrap">{row.reference}</span>,
    },
    {
      id: 'status',
      label: 'Status',
      sort: 'status',
      cell: (row) => <PaymentBadge status={row.status} />,
    },
  ];

  /** What the details panel shows: the open payment (the list row until it has loaded). */
  function panelState(): PanelState {
    if (chosen === undefined && list.isLoading) return { kind: 'loading' };
    if (chosen === undefined && list.error) return { kind: 'error', error: list.error };
    if (activeId === null)
      return {
        kind: 'none',
        text: rows.length ? 'Select a payment to see its details.' : 'No payment to show yet.',
      };
    if (detail.data) return { kind: 'ready', payment: detail.data };
    if (detail.error) return { kind: 'error', error: detail.error };
    const row = rows.find((payment) => payment.id === activeId);
    return row ? { kind: 'ready', payment: row } : { kind: 'loading' };
  }

  const clientName = clients.data?.find((client) => client.id === more.clientId)?.name;
  const invoiceNumber = draftInvoices.data?.find(
    (invoice) => invoice.id === more.invoiceId,
  )?.number;
  const chips: { label: string; clear: Partial<MoreFilters> }[] = [
    ...(more.clientId
      ? [{ label: `Client: ${clientName ?? '…'}`, clear: { clientId: '', invoiceId: '' } }]
      : []),
    ...(more.invoiceId
      ? [{ label: `Invoice: ${invoiceNumber ?? '…'}`, clear: { invoiceId: '' } }]
      : []),
  ];
  const s = summary.data;
  const kpi = { loading: summary.isLoading, failed: summary.isError };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title="Payments"
        subtitle="View, manage, and track all payments across your firms. Record payments, issue refunds, and download receipts."
        actions={
          <>
            <FirmSelect value={firmId} onChange={changeFirm} className="w-full sm:w-52" />
            <Button onClick={() => setRecording(true)} className="w-full sm:w-auto">
              <Plus aria-hidden weight="bold" className="size-5" />
              Record Payment
            </Button>
          </>
        }
      />

      <section aria-label="Payment totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <BillingKpiCard
          testId="kpi-total"
          icon={CurrencyCircleDollar}
          tone="green"
          label="Total Payments"
          value={formatMoney(s?.totalCents ?? 0)}
          trend={s?.totalTrend}
          note={plural(s?.totalCount ?? 0, 'payment')}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-month"
          icon={CreditCard}
          tone="blue"
          label="This Month"
          value={formatMoney(s?.monthCents ?? 0)}
          trend={s?.monthTrend}
          note={plural(s?.monthCount ?? 0, 'payment')}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-refunds"
          icon={Cardholder}
          tone="purple"
          label="Refunds Issued"
          value={formatMoney(s?.refundsCents ?? 0)}
          note={plural(s?.refundsCount ?? 0, 'refund')}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-average"
          icon={ChartBar}
          tone="grey"
          label="Average Payment"
          value={formatMoney(s?.averageCents ?? 0)}
          {...kpi}
        />
      </section>

      <div className="flex min-w-0 flex-col gap-6 min-[1440px]:flex-row min-[1440px]:items-start">
        <section aria-label="Payments" className="flex min-w-0 flex-1 flex-col gap-4">
          <BillingTabs active="payments" />
          <div data-testid="payment-filters" className="flex flex-col gap-3">
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
                      onChange={(event) =>
                        setDraft({ clientId: event.target.value, invoiceId: '' })
                      }
                    />
                  </FilterGroup>
                  <FilterGroup title="Invoice">
                    <SelectControl
                      aria-label="Invoice"
                      value={draft.invoiceId}
                      disabled={!draft.clientId}
                      placeholder={draft.clientId ? 'All invoices' : 'Pick a client first'}
                      options={(draftInvoices.data ?? []).map((invoice) => ({
                        value: invoice.id,
                        label: `${invoice.number} · ${INVOICE_STATUS_LABELS[invoice.status]}`,
                      }))}
                      onChange={(event) => setDraft({ ...draft, invoiceId: event.target.value })}
                    />
                  </FilterGroup>
                </>
              }
            >
              <label className="relative block w-full min-w-0 md:w-auto md:flex-1">
                <span className="sr-only">Search payments</span>
                <MagnifyingGlass
                  aria-hidden
                  weight="bold"
                  className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-heading"
                />
                <input
                  type="search"
                  maxLength={100}
                  value={search}
                  placeholder="Search payments by client, invoice, or reference..."
                  onChange={(event) => reset(setSearch)(event.target.value)}
                  className="h-10 w-full min-w-0 rounded-lg border border-divider bg-surface pr-3 pl-11 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-focus"
                />
              </label>
              <FilterSelect
                label="Filter by firm"
                value={firmId}
                onChange={(event) => changeFirm(event.target.value)}
                className="w-full sm:w-40 2xl:w-44"
              >
                <option value="">All Firms</option>
                {(firms.data ?? []).map((firm) => (
                  <option key={firm.id} value={firm.id}>
                    {firm.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Payment method"
                value={method}
                onChange={(event) => reset(setMethod)(event.target.value as PaymentMethod | '')}
                className="w-full sm:w-48"
              >
                <option value="">All Payment Methods</option>
                {optionsOf(PAYMENT_METHODS, PAYMENT_METHOD_LABELS).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Status"
                value={status}
                onChange={(event) => reset(setStatus)(event.target.value as PaymentStatus | '')}
                className="w-full sm:w-40"
              >
                <option value="">All Statuses</option>
                {optionsOf(PAYMENT_STATUSES, PAYMENT_STATUS_LABELS).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FilterSelect>
              <div aria-hidden className="hidden basis-full md:block" />
              <DateFilter label="Start Date" value={start} max={end} onChange={reset(setStart)} />
              <DateFilter label="End Date" value={end} min={start} onChange={reset(setEnd)} />
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

          <PaymentTable
            testId="payment-table"
            caption="Payments"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            activeKey={activeId}
            loading={list.isLoading}
            error={list.error}
            emptyText={
              Object.keys(filters).length ? 'No payments match these filters.' : 'No payments yet.'
            }
            sort={sort}
            onSort={reset(setSort)}
            actions={(row) => (
              <RowMenu
                label={`Actions for ${row.number}, ${row.clientName}`}
                sections={menu(row)}
              />
            )}
          />
          <BillingPager
            page={list.data?.page ?? page}
            pageCount={list.data?.pageCount ?? 1}
            total={list.data?.total ?? 0}
            pageSize={PAGE_SIZE}
            noun="payments"
            onPage={setPage}
            loading={list.isLoading}
          />
        </section>

        <PaymentPanel
          ref={panelRef}
          state={panelState()}
          sending={sendReceipt.isPending}
          onClose={() => setChosen(null)}
          onViewReceipt={setReceiptFor}
          onSendReceipt={send}
          onRefund={(payment) => setRefunding(payment.id)}
        />
      </div>

      <RecordPaymentModal
        open={recording}
        onClose={() => setRecording(false)}
        onRecorded={(payment) => {
          setChosen(payment.id);
          showNotice({
            tone: 'success',
            message: `Payment of ${formatMoney(payment.amountCents, payment.currency)} recorded on ${payment.invoiceNumber}.`,
          });
        }}
      />
      <RefundModal
        open={refunding !== null}
        paymentId={refunding}
        onClose={() => setRefunding(null)}
        onRefunded={(payment) =>
          showNotice({ tone: 'success', message: `Refund issued on ${payment.number}.` })
        }
      />
      <ReceiptViewer payment={receiptFor} onClose={() => setReceiptFor(null)} onFailed={fail} />
      <BillingNotice notice={notice} onDismiss={clearNotice} />
    </div>
  );
}
