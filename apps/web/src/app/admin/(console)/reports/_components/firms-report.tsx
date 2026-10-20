'use client';

import type { AdminFirmsReportQuery, BusinessStatus } from '@firmivra/types';
import {
  Badge,
  Button,
  Card,
  DateRangePicker,
  Pagination,
  SearchField,
  Select,
  Skeleton,
} from '@firmivra/ui';
import { CaretDown, CaretUp, DownloadSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  count,
  dateText,
  dateTimeText,
  loadError,
  moneyWhole,
  QuietLine,
  ReportsHeader,
  ReportsTabs,
  RP,
  saveFile,
  useRange,
} from './reports-common';

export const STATUS_LABELS: Record<BusinessStatus, string> = {
  PENDING_SETUP: 'Pending',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
};
export const STATUS_TONES = {
  PENDING_SETUP: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  CLOSED: 'neutral',
} as const;

type Sort = 'name' | 'joined' | 'revenue' | 'users';
const SORTS: { id: Sort; label: string }[] = [
  { id: 'name', label: 'Firm' },
  { id: 'joined', label: 'Joined' },
  { id: 'users', label: 'Users' },
  { id: 'revenue', label: 'Revenue' },
];
const PAGE_SIZES = [10, 25, 50];

/**
 * The Firms tab (docx §2): search, plan, status, date joined and location filters over every
 * firm, sorted and paged by the server; a row opens Firm Report Detail. Export is the Custom
 * Report Builder's FIRMS report with the same filters (CSV, audited). Location has no source yet
 * (no firm location column), so its filter is shown but cannot be set.
 */
export function FirmsReport() {
  const { range, keep } = useRange();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const get = (k: string) => params.get(k) ?? '';
  const sort = (SORTS.find((s) => s.id === get('sort'))?.id ?? 'name') as Sort;
  const descending = get('descending') === 'true';
  const page = Math.max(1, Number(get('page')) || 1);
  const pageSize = PAGE_SIZES.includes(Number(get('pageSize'))) ? Number(get('pageSize')) : 10;
  const [search, setSearch] = useState(() => get('search'));

  const update = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    if (!('page' in next)) q.delete('page');
    router.replace(`${path}?${q.toString()}`);
  };
  // The search box writes to the URL a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== get('search')) update({ search: search.trim() || null });
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query: AdminFirmsReportQuery = {
    ...range,
    ...(get('search') ? { search: get('search') } : {}),
    ...(get('status') ? { status: get('status') as BusinessStatus } : {}),
    ...(get('plan') ? { planCode: get('plan') } : {}),
    ...(get('joinedFrom') ? { joinedFrom: get('joinedFrom') } : {}),
    ...(get('joinedTo') ? { joinedTo: get('joinedTo') } : {}),
    sort,
    descending,
    page,
    pageSize,
  };
  const list = useApiQuery([...RP, 'firms', query], () => api.adminReports.firms(query));
  const catalog = useApiQuery([...RP, 'fields', 'FIRMS'], () => api.adminReports.fields('FIRMS'));
  const plans = catalog.data?.filters.find((f) => f.key === 'plan')?.options ?? [];
  const exporter = useApiMutation(async () => {
    const filters: Record<string, string> = {};
    for (const [k, from] of [
      ['search', 'search'],
      ['status', 'status'],
      ['plan', 'plan'],
      ['joinedFrom', 'joinedFrom'],
      ['joinedTo', 'joinedTo'],
    ] as const)
      if (get(from)) filters[k] = get(from);
    return api.adminReports.export({
      type: 'FIRMS',
      fields: catalog.data?.defaultFields ?? ['firm.name'],
      filters,
      dateRange: range ?? { preset: 'LAST_30_DAYS' },
      sort: [],
      format: 'CSV',
      title: 'Firms report',
    });
  });

  const header = (s: { id: Sort; label: string }) => {
    const active = sort === s.id;
    const Arrow = active && descending ? CaretDown : CaretUp;
    return (
      <button
        type="button"
        onClick={() => update({ sort: s.id, descending: active && !descending ? 'true' : null })}
        className="inline-flex items-center gap-1 font-medium"
        aria-label={`Sort by ${s.label}`}
      >
        {s.label}
        <Arrow
          aria-hidden
          weight="bold"
          className={`size-3 ${active ? 'text-action' : 'text-muted'}`}
        />
      </button>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReportsHeader
        title="Reports & Analytics"
        subtitle="Insights and data to help you monitor growth, performance, and platform activity."
        actions={
          <Button
            variant="secondary"
            disabled={exporter.isPending || !catalog.data}
            onClick={() => exporter.mutate(undefined, { onSuccess: saveFile })}
          >
            <span className="inline-flex items-center gap-2 text-action">
              <DownloadSimple aria-hidden weight="bold" className="size-4" />
              {exporter.isPending ? 'Exporting…' : 'Export'}
            </span>
          </Button>
        }
      />
      <ReportsTabs />
      {exporter.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(exporter.error)}
        </p>
      ) : null}

      <Card className="flex flex-col gap-4 p-5!">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]">
          <SearchField
            label="Search firms"
            placeholder="Search by firm name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            label="Plan"
            hideLabel
            value={get('plan')}
            onChange={(e) => update({ plan: e.target.value || null })}
            options={[{ value: '', label: 'All Plans' }, ...plans]}
          />
          <Select
            label="Status"
            hideLabel
            value={get('status')}
            onChange={(e) => update({ status: e.target.value || null })}
            options={[
              { value: '', label: 'All Statuses' },
              ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <Select
            label="Location"
            hideLabel
            value=""
            disabled
            title="Firms have no location on record yet"
            onChange={() => undefined}
            options={[{ value: '', label: 'All Locations' }]}
          />
        </div>
        <div className="max-w-md">
          <DateRangePicker
            label="Date joined"
            value={{ from: get('joinedFrom'), to: get('joinedTo') }}
            onChange={(r) => update({ joinedFrom: r.from || null, joinedTo: r.to || null })}
          />
        </div>

        <div className="overflow-x-auto" data-testid="firms-table">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-table-head text-text">
              <tr>
                <th scope="col" className="px-3 py-3">
                  {header(SORTS[0]!)}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Plan
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-3">
                  {header(SORTS[1]!)}
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Primary Contact
                </th>
                <th scope="col" className="px-3 py-3 text-right">
                  {header(SORTS[2]!)}
                </th>
                <th scope="col" className="px-3 py-3 text-right">
                  {header(SORTS[3]!)}
                </th>
                <th scope="col" className="px-3 py-3 text-right font-medium">
                  Open Tickets
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Last Login
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {list.data?.items.map((f) => (
                <tr key={f.id} className="hover:bg-canvas">
                  <td className="px-3 py-3">
                    <Link
                      href={keep(`/reports/firms/${f.id}`)}
                      className="font-semibold text-heading hover:text-action"
                    >
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-text">{f.planName ?? 'No plan'}</td>
                  <td className="px-3 py-3">
                    <Badge tone={STATUS_TONES[f.status]}>{STATUS_LABELS[f.status]}</Badge>
                  </td>
                  <td className="px-3 py-3 text-text">{dateText(f.joinedAt)}</td>
                  <td className="px-3 py-3 text-text">
                    {f.contactName ?? '—'}
                    {f.contactEmail ? (
                      <span className="block text-xs text-muted">{f.contactEmail}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right text-text">
                    {f.totalUsers === null ? '—' : count(f.totalUsers)}
                  </td>
                  <td className="px-3 py-3 text-right text-text">{moneyWhole(f.revenueCents)}</td>
                  <td className="px-3 py-3 text-right text-text">{count(f.openTickets)}</td>
                  <td className="px-3 py-3 text-text">
                    {f.lastLoginAt ? dateTimeText(f.lastLoginAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.isPending ? (
            <div className="flex flex-col gap-2 p-3" role="status" aria-label="Loading">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : list.isError ? (
            <QuietLine>{loadError(list.error)}</QuietLine>
          ) : !list.data?.items.length ? (
            <QuietLine>No firms match these filters.</QuietLine>
          ) : null}
        </div>
        {list.data ? (
          <Pagination
            page={list.data.page}
            pageCount={Math.max(1, Math.ceil(list.data.total / list.data.pageSize))}
            onPage={(p) => update({ page: String(p) })}
            summary={`Showing ${list.data.total ? (list.data.page - 1) * list.data.pageSize + 1 : 0} – ${Math.min(list.data.total, list.data.page * list.data.pageSize)} of ${count(list.data.total)} firms`}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            onPageSize={(s) => update({ pageSize: String(s) })}
          />
        ) : null}
        <p className="text-xs text-muted">
          Users come from the daily usage rollup (— until it has run); revenue is payments received
          in the reporting period.
        </p>
      </Card>
    </div>
  );
}
