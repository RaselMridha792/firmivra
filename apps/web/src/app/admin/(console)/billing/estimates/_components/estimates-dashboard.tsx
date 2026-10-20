'use client';

import { Drawer, FilterBar, FilterChip, FilterGroup, Skeleton } from '@firmivra/ui';
import { CheckCircle, Clock, FileText, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import {
  ESTIMATE_STATUSES,
  type BillingEstimate,
  type EstimateQuery,
  type EstimateSort,
  type EstimateStatus,
} from '../../../../../../mocks/admin-billing';
import { useApiQuery } from '../../../../../../lib/query';
import { SelectControl } from '../../_components/billing-fields';
import {
  formatDate,
  formatMoney,
  periodRange,
  PERIODS,
  plural,
  type Period,
} from '../../_components/billing-format';
import { ESTIMATE_STATUS_LABELS, optionsOf } from '../../_components/billing-labels';
import {
  BillingKpiCard,
  BillingNotice,
  QuietLine,
  quietErrorText,
  useNotice,
  type Notice,
} from '../../_components/billing-parts';
import {
  BillingHeader,
  BillingTabs,
  FirmSelect,
  useBillingFirm,
} from '../../_components/billing-shell';
import { BillingPager, type BillingSort } from '../../_components/billing-table';
import { useEstimateActions } from './estimate-actions';
import { EstimateDetails } from './estimate-details';
import { DateBox, FilterSelect, SAVED_NOTICES, useWideLayout } from './estimate-parts';
import { EstimateTable } from './estimate-table';
import { adminBilling } from '../../_components/billing-api';

/**
 * Estimates (firmivra-estimates-dashboard.jpg, docx §10): the firm filter and Create Estimate,
 * the four totals, the Billing tabs, the filters, the estimate list with its row menu, and the
 * Estimate Details panel (a column at 1440 px, the kit's Drawer below). The totals come from the
 * same filters as the list.
 */

const PAGE_SIZE = 10;

export function EstimatesDashboard({
  estimateId,
  saved,
}: {
  /** Open the details on this estimate (after a save on Create or Edit Estimate). */
  estimateId: string | null;
  /** The save just made (`?saved=`), for the success line. */
  saved: string | null;
}) {
  const wide = useWideLayout();
  const [firmId, setFirmId] = useBillingFirm();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [status, setStatus] = useState<EstimateStatus | ''>('');
  const [period, setPeriod] = useState<Period>('all');
  const [range, setRange] = useState({ from: '', to: '' });
  const [clientId, setClientId] = useState('');
  const [clientDraft, setClientDraft] = useState('');
  const [sort, setSort] = useState<BillingSort | undefined>();
  const [page, setPage] = useState(1);
  // The panel: the estimate picked (else the first row), closed by its X; the drawer below 1440.
  const [picked, setPicked] = useState<string | null>(estimateId);
  const [closed, setClosed] = useState(false);
  const [drawer, setDrawer] = useState(estimateId !== null);
  const savedText = saved ? SAVED_NOTICES[saved] : undefined;
  const initial: Notice | null = savedText ? { tone: 'success', message: savedText } : null;
  const [notice, showNotice, clearNotice] = useNotice(initial);

  const open = (id: string) => {
    setPicked(id);
    setClosed(false);
    setDrawer(true);
  };
  const actions = useEstimateActions(showNotice, {
    onDetails: (estimate) => open(estimate.id),
    onDuplicated: (copy) => open(copy.id),
    onDeleted: (id) => {
      if (picked === id) setPicked(null);
      setDrawer(false);
    },
  });

  const dates = range.from || range.to ? range : periodRange(period);
  const filters: EstimateQuery = {
    ...(firmId ? { firmId } : {}),
    ...(term ? { search: term } : {}),
    ...(status ? { status } : {}),
    ...(dates.from ? { from: dates.from } : {}),
    ...(dates.to ? { to: dates.to } : {}),
    ...(clientId ? { clientId } : {}),
  };
  const summary = useApiQuery(['admin-billing', 'estimate-summary', filters], () =>
    adminBilling.estimateSummary(filters),
  );
  const list = useApiQuery(['admin-billing', 'estimates', filters, sort ?? null, page], () =>
    adminBilling.estimates({
      ...filters,
      ...(sort ? { sort: sort.sort as EstimateSort, descending: sort.descending } : {}),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const clients = useApiQuery(['admin-billing', 'clients', firmId || 'all'], () =>
    adminBilling.clients(firmId ? { firmId } : {}),
  );

  const rows = list.data?.items ?? [];
  const selectedId = closed ? null : (picked ?? rows[0]?.id ?? null);
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const filtered = Object.keys(filters).length > 0;
  const fallback = list.isLoading ? (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-8 w-40" />
      <Skeleton />
    </div>
  ) : (
    <QuietLine testId="estimate-details-empty">
      {list.error
        ? quietErrorText(list.error)
        : filtered
          ? 'No estimate matches these filters.'
          : 'No estimates yet.'}
    </QuietLine>
  );
  const details = <EstimateDetails estimateId={selectedId} fallback={fallback} actions={actions} />;

  const s = summary.data;
  const kpi = { loading: summary.isLoading, failed: summary.isError };
  const clientName = clients.data?.find((client) => client.id === clientId)?.name;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title="Estimates"
        subtitle="Create, send, and track estimates. Convert approved estimates to invoices."
        actions={
          <>
            <FirmSelect value={firmId} onChange={reset(setFirmId)} className="w-full sm:w-44" />
            <Link
              href="/billing/estimates/new"
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-action px-5 text-base font-semibold text-on-action shadow-sm hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <Plus aria-hidden weight="bold" className="size-5" />
              Create Estimate
            </Link>
          </>
        }
      />

      <section aria-label="Estimate totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <BillingKpiCard
          testId="kpi-total"
          icon={FileText}
          tone="blue"
          label="Total Estimates"
          value={formatMoney(s?.totalCents ?? 0)}
          note={plural(s?.totalCount ?? 0, 'estimate')}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-approved"
          icon={CheckCircle}
          tone="green"
          label="Approved"
          value={formatMoney(s?.approvedCents ?? 0)}
          note={plural(s?.approvedCount ?? 0, 'estimate')}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-pending"
          icon={Clock}
          tone="amber"
          label="Pending"
          value={formatMoney(s?.pendingCents ?? 0)}
          note={plural(s?.pendingCount ?? 0, 'estimate')}
          {...kpi}
        />
        <BillingKpiCard
          testId="kpi-declined"
          icon={X}
          tone="red"
          label="Declined"
          value={formatMoney(s?.declinedCents ?? 0)}
          note={plural(s?.declinedCount ?? 0, 'estimate')}
          {...kpi}
        />
      </section>

      <div className="flex min-w-0 flex-col gap-4 min-[1440px]:flex-row min-[1440px]:items-start">
        <section aria-label="Estimates" className="flex min-w-0 flex-1 flex-col gap-4">
          <BillingTabs active="estimates" icons={false} />
          <div data-testid="estimate-filters" className="flex flex-col gap-3">
            <FilterBar
              onApply={() => {
                setClientId(clientDraft);
                setPage(1);
              }}
              onClear={() => {
                setClientDraft('');
                setClientId('');
                setPage(1);
              }}
              more={
                <FilterGroup title="Client">
                  <SelectControl
                    aria-label="Client"
                    value={clientDraft}
                    placeholder="All clients"
                    options={(clients.data ?? []).map((client) => ({
                      value: client.id,
                      label: client.name,
                    }))}
                    onChange={(event) => setClientDraft(event.target.value)}
                  />
                </FilterGroup>
              }
            >
              <label className="relative block min-w-0 flex-1 basis-full sm:basis-60">
                <span className="sr-only">Search estimates</span>
                <MagnifyingGlass
                  aria-hidden
                  weight="bold"
                  className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted"
                />
                <input
                  type="search"
                  maxLength={100}
                  value={search}
                  placeholder="Search estimates by client, number, or event..."
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  className="h-10 w-full min-w-0 rounded-lg border border-divider bg-surface pr-3 pl-10 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-focus"
                />
              </label>
              <FilterSelect
                label="Filter by firm"
                value={firmId}
                onChange={reset(setFirmId)}
                options={[
                  { value: '', label: 'All Firms' },
                  ...(firms.data ?? []).map((firm) => ({ value: firm.id, label: firm.name })),
                ]}
              />
              <FilterSelect
                label="Status"
                testId="estimate-status-filter"
                value={status}
                onChange={(value) => reset(setStatus)(value as EstimateStatus | '')}
                options={[
                  { value: '', label: 'All Statuses' },
                  ...optionsOf(ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS),
                ]}
              />
              <FilterSelect
                label="Issue date"
                value={period}
                onChange={(value) => {
                  setPeriod(value as Period);
                  setRange({ from: '', to: '' });
                  setPage(1);
                }}
                options={PERIODS.map((option) => ({ value: option.value, label: option.label }))}
              />
              <DateBox
                label="Start Date"
                value={range.from}
                max={range.to}
                onChange={(from) => {
                  setRange({ ...range, from });
                  setPeriod('all');
                  setPage(1);
                }}
              />
              <DateBox
                label="End Date"
                value={range.to}
                min={range.from}
                onChange={(to) => {
                  setRange({ ...range, to });
                  setPeriod('all');
                  setPage(1);
                }}
              />
            </FilterBar>
            {clientId || range.from || range.to ? (
              <div aria-label="Active filters" className="flex flex-wrap gap-2">
                {clientId ? (
                  <FilterChip
                    label={`Client: ${clientName ?? '…'}`}
                    onRemove={() => {
                      setClientId('');
                      setClientDraft('');
                      setPage(1);
                    }}
                  />
                ) : null}
                {range.from || range.to ? (
                  <FilterChip
                    label={`Issued: ${range.from ? formatDate(range.from) : '…'} – ${range.to ? formatDate(range.to) : '…'}`}
                    onRemove={() => {
                      setRange({ from: '', to: '' });
                      setPage(1);
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <EstimateTable
            rows={rows}
            loading={list.isLoading}
            error={list.error}
            emptyText={filtered ? 'No estimates match these filters.' : 'No estimates yet.'}
            sort={sort}
            onSort={(next) => {
              setSort(next);
              setPage(1);
            }}
            selectedId={selectedId}
            onSelect={(row: BillingEstimate) => open(row.id)}
            menu={actions.menu}
          />
          <BillingPager
            page={list.data?.page ?? page}
            pageCount={list.data?.pageCount ?? 1}
            total={list.data?.total ?? 0}
            pageSize={PAGE_SIZE}
            noun="estimates"
            onPage={setPage}
            loading={list.isLoading}
          />
        </section>

        {wide && !closed ? (
          <aside
            aria-labelledby="estimate-details-title"
            data-testid="estimate-panel"
            className="flex w-full shrink-0 flex-col gap-4 rounded-xl border border-divider bg-surface p-5 shadow-sm min-[1440px]:w-68"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="estimate-details-title" className="text-lg font-bold text-heading">
                Estimate Details
              </h2>
              <button
                type="button"
                aria-label="Close estimate details"
                onClick={() => setClosed(true)}
                className="inline-flex size-9 items-center justify-center rounded-lg text-heading hover:bg-canvas"
              >
                <X aria-hidden weight="bold" className="size-5" />
              </button>
            </div>
            {details}
          </aside>
        ) : null}
      </div>

      {wide ? null : (
        <Drawer
          open={drawer && selectedId !== null}
          title="Estimate Details"
          onClose={() => setDrawer(false)}
        >
          {details}
        </Drawer>
      )}
      {actions.dialogs}
      <BillingNotice notice={notice} onDismiss={clearNotice} />
    </div>
  );
}
