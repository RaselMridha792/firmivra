'use client';

import { BulkBar, Button, FilterChip, Modal, type ActionMenuSection } from '@firmivra/ui';
import {
  ArrowSquareOut,
  Copy,
  Lightning,
  MagnifyingGlass,
  Pause,
  PencilSimple,
  Play,
  Plus,
  XCircle,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import {
  adminBilling,
  type BillingRecurring,
  type RecurringQuery,
  type RecurringSort,
  type RecurringStatus,
} from '../../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { formatDate, formatMoney, plural, todayIso } from '../../_components/billing-format';
import {
  BILLING_ERRORS,
  RECURRING_FREQUENCY_LABELS,
  RECURRING_STATUS_LABELS,
} from '../../_components/billing-labels';
import { BillingNotice, RecurringStatusBadge, useNotice } from '../../_components/billing-parts';
import { BillingHeader, useBillingFirm } from '../../_components/billing-shell';
import {
  BillingPager,
  BillingTable,
  RowMenu,
  type BillingColumn,
  type BillingSort,
} from '../../_components/billing-table';
import { RecurringDrawer, type RecurringDefaults } from '../../_components/recurring-drawer';
import { NO_FILTERS, RecurringFilter, type RecurringFilters } from './recurring-filter';

/**
 * Recurring Invoices (firmivra-recurring-invoices-dashboard.jpg, docx §9): the schedules by
 * status, search and filters, and the shared right-side drawer for create and edit
 * ("Recurring Invoice Details"). `create` (from `?create=1`) opens the drawer for a new one.
 */

const PAGE_SIZE = 10;

type StatusTab = RecurringStatus | '';
const STATUS_TABS: { id: StatusTab; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'PAUSED', label: 'Paused' },
  { id: 'CANCELED', label: 'Canceled' },
];

type Panel =
  | { mode: 'closed' }
  | { mode: 'edit'; schedule: BillingRecurring }
  | { mode: 'create'; defaults: RecurringDefaults };
const CLOSED: Panel = { mode: 'closed' };
const CREATE: Panel = { mode: 'create', defaults: {} };

/** The panel's filters besides the firm (the firm is the Billing pages' shared choice). */
type MoreFilters = Omit<RecurringFilters, 'firmId'>;
const NO_MORE: MoreFilters = { clientId: NO_FILTERS.clientId, next: NO_FILTERS.next };

const VERBS: Record<RecurringStatus, string> = {
  ACTIVE: 'resumed',
  PAUSED: 'paused',
  CANCELED: 'canceled',
};

/** "Monthly", or "Every 10 days" for a custom schedule. */
const frequencyText = (row: BillingRecurring) =>
  row.frequency === 'CUSTOM' && row.customIntervalDays
    ? `Every ${plural(row.customIntervalDays, 'day')}`
    : RECURRING_FREQUENCY_LABELS[row.frequency];

/** A new schedule's starting values, copied from an existing one. */
const copyOf = (row: BillingRecurring): RecurringDefaults => ({
  clientId: row.clientId,
  template: row.template,
  description: row.description,
  frequency: row.frequency,
  customIntervalDays: row.customIntervalDays,
  amountCents: row.amountCents,
  startDate: todayIso(),
  autoSend: row.autoSend,
  allowOnlinePayment: row.allowOnlinePayment,
  status: 'ACTIVE',
});

export function RecurringInvoices({ create }: { create: boolean }) {
  const router = useRouter();
  const [firmId, setFirmId] = useBillingFirm();
  const [status, setStatus] = useState<StatusTab>('');
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [more, setMore] = useState<MoreFilters>(NO_MORE);
  const [sort, setSort] = useState<BillingSort | undefined>();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [panel, setPanel] = useState<Panel>(create ? CREATE : CLOSED);
  const [createParam, setCreateParam] = useState(create);
  const [canceling, setCanceling] = useState<BillingRecurring[] | null>(null);
  const [notice, showNotice, clearNotice] = useNotice();

  // `?create=1` again while this page is open (the prop changes, the state stays).
  if (create !== createParam) {
    setCreateParam(create);
    if (create) setPanel(CREATE);
  }

  const filters: RecurringQuery = {
    ...(firmId ? { firmId } : {}),
    ...(term ? { search: term } : {}),
    ...(more.clientId ? { clientId: more.clientId } : {}),
    ...(more.next.from ? { from: more.next.from } : {}),
    ...(more.next.to ? { to: more.next.to } : {}),
  };
  const list = useApiQuery(
    ['admin-billing', 'recurring', filters, status, sort ?? null, page],
    () =>
      adminBilling.recurringSchedules({
        ...filters,
        ...(status ? { status } : {}),
        ...(sort ? { sort: sort.sort as RecurringSort, descending: sort.descending } : {}),
        page,
        pageSize: PAGE_SIZE,
      }),
  );
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const clients = useApiQuery(['admin-billing', 'clients', firmId || 'all'], () =>
    adminBilling.clients(firmId ? { firmId } : {}),
  );
  const fail = (error: unknown) =>
    showNotice({ tone: 'error', message: errorMessage(error, BILLING_ERRORS) });
  const statusChange = useApiMutation(
    ({ rows, next }: { rows: BillingRecurring[]; next: RecurringStatus }) =>
      Promise.all(rows.map((row) => adminBilling.setRecurringStatus(row.id, next))),
    { invalidate: ['admin-billing'] },
  );
  const generate = useApiMutation((row: BillingRecurring) => adminBilling.runRecurring(row.id), {
    invalidate: ['admin-billing'],
  });

  const rows = list.data?.items ?? [];
  const picked = rows.filter((row) => selected.includes(row.id));
  /** Changes a filter: back to page 1 with nothing selected. */
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
      setSelected([]);
    };

  function changeStatus(targets: BillingRecurring[], next: RecurringStatus) {
    if (targets.length === 0) {
      showNotice({
        tone: 'error',
        message: `None of the selected recurring invoices can be ${VERBS[next]}.`,
      });
      return;
    }
    statusChange.mutate(
      { rows: targets, next },
      {
        onSuccess: () => {
          setSelected([]);
          setCanceling(null);
          const [only] = targets;
          const message =
            targets.length === 1 && only
              ? `${only.template} for ${only.clientName} was ${VERBS[next]}.`
              : `${plural(targets.length, 'recurring invoice')} were ${VERBS[next]}.`;
          showNotice({ tone: 'success', message });
        },
        onError: fail,
      },
    );
  }

  function runNow(row: BillingRecurring) {
    generate.mutate(row, {
      onSuccess: (invoice) =>
        showNotice({
          tone: 'success',
          message: `${invoice.number} was generated from ${row.template}.`,
        }),
      onError: fail,
    });
  }

  function closePanel() {
    setPanel(CLOSED);
    if (create) router.replace('/billing/recurring', { scroll: false });
  }

  const menu = (row: BillingRecurring): ActionMenuSection[] => {
    const latest = row.invoiceIds[row.invoiceIds.length - 1];
    const sections: ActionMenuSection[] = [
      {
        items: [
          ...(row.status === 'CANCELED'
            ? []
            : [
                {
                  label: 'Edit',
                  icon: PencilSimple,
                  onSelect: () => setPanel({ mode: 'edit', schedule: row }),
                },
              ]),
          ...(latest
            ? [
                {
                  label: 'View Latest Invoice',
                  icon: ArrowSquareOut,
                  onSelect: () => router.push(`/billing/invoices/${latest}`),
                },
              ]
            : []),
          {
            label: 'Copy to New Schedule',
            icon: Copy,
            onSelect: () => setPanel({ mode: 'create', defaults: copyOf(row) }),
          },
        ],
      },
      {
        items: [
          ...(row.status === 'ACTIVE'
            ? [
                { label: 'Generate Invoice Now', icon: Lightning, onSelect: () => runNow(row) },
                { label: 'Pause', icon: Pause, onSelect: () => changeStatus([row], 'PAUSED') },
              ]
            : []),
          ...(row.status === 'PAUSED'
            ? [{ label: 'Resume', icon: Play, onSelect: () => changeStatus([row], 'ACTIVE') }]
            : []),
        ],
      },
      {
        items:
          row.status === 'CANCELED'
            ? []
            : [
                {
                  label: 'Cancel Schedule',
                  icon: XCircle,
                  danger: true,
                  onSelect: () => setCanceling([row]),
                },
              ],
      },
    ];
    return sections.filter((section) => section.items.length > 0);
  };

  const columns: BillingColumn<BillingRecurring>[] = [
    {
      id: 'client',
      label: 'Client',
      sort: 'client',
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          {row.status === 'CANCELED' ? (
            <span className="font-medium text-heading">{row.clientName}</span>
          ) : (
            <button
              type="button"
              title="Open the recurring invoice details"
              onClick={() => setPanel({ mode: 'edit', schedule: row })}
              className="text-left font-medium text-heading hover:text-action hover:underline"
            >
              {row.clientName}
            </button>
          )}
          <span className="text-muted">Client #{row.clientNumber}</span>
        </div>
      ),
    },
    {
      id: 'template',
      label: 'Template / Description',
      sort: 'template',
      cell: (row) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-heading">{row.template}</span>
          {row.description ? <span className="text-muted">{row.description}</span> : null}
        </div>
      ),
    },
    { id: 'frequency', label: 'Frequency', sort: 'frequency', cell: frequencyText },
    {
      id: 'amount',
      label: 'Amount',
      sort: 'amount',
      cell: (row) => (
        <span className="whitespace-nowrap">{formatMoney(row.amountCents, row.currency)}</span>
      ),
    },
    {
      id: 'next',
      label: 'Next Invoice',
      sort: 'nextInvoiceDate',
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.nextInvoiceDate)}</span>,
    },
    {
      id: 'status',
      label: 'Status',
      sort: 'status',
      cell: (row) => <RecurringStatusBadge status={row.status} />,
    },
  ];

  const firmName = firms.data?.find((firm) => firm.id === firmId)?.name;
  const clientName = clients.data?.find((client) => client.id === more.clientId)?.name;
  const chips = [
    ...(firmId ? [{ label: `Firm: ${firmName ?? '…'}`, clear: () => setFirmId('') }] : []),
    ...(more.clientId
      ? [{ label: `Client: ${clientName ?? '…'}`, clear: () => setMore({ ...more, clientId: '' }) }]
      : []),
    ...(more.next.from || more.next.to
      ? [
          {
            label: `Next invoice: ${more.next.from ? formatDate(more.next.from) : '…'} – ${more.next.to ? formatDate(more.next.to) : '…'}`,
            clear: () => setMore({ ...more, next: { from: '', to: '' } }),
          },
        ]
      : []),
  ];
  const filtered = Boolean(term) || chips.length > 0;
  const emptyText = filtered
    ? 'No recurring invoices match these filters.'
    : status
      ? `No ${RECURRING_STATUS_LABELS[status].toLowerCase()} recurring invoices.`
      : 'No recurring invoices yet.';

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title="Recurring Invoices"
        subtitle="Set up and manage automatic invoices for your clients."
        breadcrumbs={[{ label: 'Billing', href: '/billing' }, { label: 'Recurring Invoices' }]}
        actions={
          <Button onClick={() => setPanel(CREATE)}>
            <Plus aria-hidden weight="bold" className="size-5" />
            Create Recurring Invoice
          </Button>
        }
      />

      <section
        aria-label="Recurring invoices"
        className="flex min-w-0 flex-col gap-4 rounded-xl bg-surface p-4 shadow-sm md:p-5"
      >
        <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            role="group"
            aria-label="Show recurring invoices by status"
            className="flex flex-wrap gap-1"
          >
            {STATUS_TABS.map((tab) => {
              const on = status === tab.id;
              return (
                <button
                  key={tab.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => reset(setStatus)(tab.id)}
                  className={`min-h-11 rounded-lg px-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-focus ${on ? 'bg-info-soft text-action' : 'text-text hover:bg-canvas'}`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative block w-full min-w-0 sm:w-72">
              <span className="sr-only">Search recurring invoices</span>
              <MagnifyingGlass
                aria-hidden
                weight="bold"
                className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-heading"
              />
              <input
                type="search"
                maxLength={100}
                value={search}
                placeholder="Search recurring invoices..."
                onChange={(event) => reset(setSearch)(event.target.value)}
                className="h-11 w-full min-w-0 rounded-lg border border-divider bg-surface pr-3 pl-12 text-base text-text placeholder:text-muted focus:outline-2 focus:outline-focus"
              />
            </label>
            <RecurringFilter
              value={{ firmId, ...more }}
              onApply={({ firmId: nextFirm, ...rest }) => {
                setFirmId(nextFirm);
                reset(setMore)(rest);
              }}
            />
          </div>
        </div>

        {chips.length ? (
          <div aria-label="Active filters" className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <FilterChip
                key={chip.label}
                label={chip.label}
                onRemove={() => {
                  chip.clear();
                  setPage(1);
                  setSelected([]);
                }}
              />
            ))}
          </div>
        ) : null}

        {picked.length ? (
          <BulkBar
            count={picked.length}
            noun={picked.length === 1 ? 'recurring invoice' : 'recurring invoices'}
            actions={[
              {
                label: 'Pause',
                icon: Pause,
                onClick: () =>
                  changeStatus(
                    picked.filter((row) => row.status === 'ACTIVE'),
                    'PAUSED',
                  ),
              },
              {
                label: 'Resume',
                icon: Play,
                onClick: () =>
                  changeStatus(
                    picked.filter((row) => row.status === 'PAUSED'),
                    'ACTIVE',
                  ),
              },
              {
                label: 'Cancel',
                icon: XCircle,
                danger: true,
                onClick: () => {
                  const open = picked.filter((row) => row.status !== 'CANCELED');
                  if (open.length) setCanceling(open);
                  else changeStatus([], 'CANCELED');
                },
              },
            ]}
          />
        ) : null}

        <BillingTable
          testId="recurring-table"
          caption="Recurring invoices"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={list.isLoading}
          error={list.error}
          emptyText={emptyText}
          sort={sort}
          onSort={reset(setSort)}
          selection={{
            selected,
            onChange: setSelected,
            label: (row) => `${row.clientName}, ${row.template}`,
          }}
          actions={(row) => (
            <RowMenu
              label={`Actions for ${row.clientName}, ${row.template}`}
              sections={menu(row)}
            />
          )}
        />
        <BillingPager
          page={list.data?.page ?? page}
          pageCount={list.data?.pageCount ?? 1}
          total={list.data?.total ?? 0}
          pageSize={PAGE_SIZE}
          noun="recurring invoices"
          onPage={reset(setPage)}
          loading={list.isLoading}
        />
      </section>

      <RecurringDrawer
        open={panel.mode !== 'closed'}
        schedule={panel.mode === 'edit' ? panel.schedule : null}
        defaults={panel.mode === 'create' ? panel.defaults : undefined}
        onClose={closePanel}
        onSaved={(saved) =>
          showNotice({
            tone: 'success',
            message:
              panel.mode === 'edit'
                ? `Changes to ${saved.template} were saved.`
                : `Recurring invoice ${saved.template} for ${saved.clientName} was created.`,
          })
        }
      />

      <Modal
        open={canceling !== null}
        title="Cancel recurring invoice?"
        onClose={() => setCanceling(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCanceling(null)}>
              Keep Schedule
            </Button>
            <Button
              disabled={statusChange.isPending}
              onClick={() => canceling && changeStatus(canceling, 'CANCELED')}
            >
              {statusChange.isPending ? 'Canceling…' : 'Cancel Schedule'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {canceling?.length === 1 && canceling[0]
            ? `${canceling[0].template} for ${canceling[0].clientName} stops creating invoices.`
            : `${plural(canceling?.length ?? 0, 'recurring invoice')} stop creating invoices.`}{' '}
          A canceled schedule can&apos;t be restarted. The invoices it already created stay as they
          are.
        </p>
      </Modal>

      <BillingNotice notice={notice} onDismiss={clearNotice} />
    </div>
  );
}
