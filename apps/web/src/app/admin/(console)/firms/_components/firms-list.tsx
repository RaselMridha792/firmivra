'use client';

import { FIRM_PLANS, FirmPlan, FirmSort, FirmStatusFilter } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { Building2, Clock3, Search, UsersRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { pageOf } from '../../../../../lib/list-query';
import { withOrigin } from '../../../../../lib/origin';
import { useApiQuery } from '../../../../../lib/query';
import {
  cellClass,
  EmailText,
  emailCellClass,
  firstCellClass,
  formatPhone,
  ListPager,
  ListTable,
  SearchBox,
  selectClass,
  StatCard,
} from '../../_components/list-parts';

const tabs: {
  value: FirmStatusFilter | undefined;
  label: string;
  count: 'total' | 'active' | 'pendingSetup' | 'inactive';
}[] = [
  // SA-FRM-F01: Active first, and the tab a firm list opens on.
  { value: 'ACTIVE', label: 'Active', count: 'active' },
  { value: 'PENDING_SETUP', label: 'Pending Setup', count: 'pendingSetup' },
  { value: 'INACTIVE', label: 'Inactive', count: 'inactive' },
  { value: undefined, label: 'All Firms', count: 'total' },
];

/** SA-FRM-F01: the tab in the address, `?status=ACTIVE` … or `ALL`; Active when it has none. */
const statusOf = (value: string | null): FirmStatusFilter | undefined =>
  value === 'ALL' ? undefined : (FirmStatusFilter.safeParse(value).data ?? 'ACTIVE');

/** SA-FRM-Y06: each firm's own status; the Inactive tab holds Suspended and Closed. */
const STATUS_TEXT: Record<string, string> = {
  PENDING_SETUP: 'Pending Setup',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
};
const statusText = (status: string) => STATUS_TEXT[status] ?? 'Inactive';

/** The API refuses control characters and more than 100 characters (SearchText). */
const cleanSearch = (value: string) =>
  value
    .replace(/[\p{Cc}\p{Cs}]/gu, ' ')
    .trim()
    .slice(0, 100);

/** The approval moment on the viewer's own calendar, as on the firm's page. */
const dateText = (value: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value));

function ApprovedDate({ value }: { value: string | null }) {
  return value ? <time dateTime={value}>{dateText(value)}</time> : <>—</>;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE'
      ? 'bg-success-soft text-success'
      : status === 'PENDING_SETUP'
        ? 'bg-warning-soft text-warning'
        : 'bg-danger-soft text-danger';
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-pill px-3 py-1 text-sm font-medium ${tone}`}
    >
      {statusText(status)}
    </span>
  );
}

export function FirmsList() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  // SA-FRM-F01, Y05: the address is the view (tab, search, plan, sort, page), so a link to the
  // list (the menu, the dashboard) sets it again, even from this page, and Back from a firm
  // reopens the list exactly as it was.
  const status = statusOf(params.get('status'));
  const appliedSearch = cleanSearch(params.get('search') ?? '');
  const plan = FirmPlan.safeParse(params.get('plan')).data;
  const sort = FirmSort.safeParse(params.get('sort')).data;
  const order = params.get('order') === 'desc' ? 'desc' : 'asc';
  const page = pageOf(params.get('page') ?? '1');
  // The search box's text: what was typed, until the address's search changes (a link, Clear).
  const [draft, setDraft] = useState({ for: appliedSearch, text: appliedSearch });
  const search = draft.for === appliedSearch ? draft.text : appliedSearch;
  const query = useApiQuery(
    ['admin-firms', status, appliedSearch, plan, sort, order, page],
    async () => {
      const [counts, result] = await Promise.all([
        api.firmApplications.firmCounts(),
        api.firmApplications.listFirms({
          status,
          search: appliedSearch || undefined,
          plan,
          sort,
          order,
          page,
          pageSize: 10,
        }),
      ]);
      return { ...result, counts };
    },
  );

  const counts = query.data?.counts;
  /** The list's place now, for a firm's Back. */
  const current = params.toString();
  const here = `/firms${current ? `?${current}` : ''}`;

  /**
   * Changes the view in the address without a new history entry. Anything but a page change
   * starts again at page 1.
   */
  function update(next: Record<string, string | undefined>) {
    const q = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) q.set(key, value);
      else q.delete(key);
    }
    if (!('page' in next)) q.delete('page');
    const text = q.toString();
    router.replace(text ? `${path}?${text}` : path, { scroll: false });
  }
  const setPage = (next: number) => update({ page: next > 1 ? String(next) : undefined });

  function searchFirms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update({ search: cleanSearch(search) || undefined });
  }

  function show(value: FirmStatusFilter | undefined) {
    update({ status: value ?? 'ALL' });
  }

  /** SA-FRM-Y08: a column's sort: A to Z (or oldest first), then the other way round. */
  const sortBy = (key: FirmSort) => ({
    sorted:
      sort === key
        ? order === 'desc'
          ? ('descending' as const)
          : ('ascending' as const)
        : undefined,
    onSort: () =>
      update({ sort: key, order: sort === key && order === 'asc' ? 'desc' : undefined }),
  });

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1
            data-testid="page-title"
            className="font-display text-4xl font-bold tracking-tight text-heading md:text-5xl"
          >
            Firms
          </h1>
          <p className="mt-1 text-lg text-muted">
            Manage approved firms and their access to the platform.
          </p>
        </div>
        <form onSubmit={searchFirms} className="flex shrink-0 flex-col gap-3 sm:flex-row xl:mt-2">
          <SearchBox
            label="Search firms"
            className="sm:w-96 xl:w-80 2xl:w-96"
            placeholder="Search firms by name, owner, or email..."
            value={search}
            onChange={(event) => setDraft({ for: appliedSearch, text: event.target.value })}
          />
          <Button type="submit" className="gap-2">
            <Search aria-hidden className="size-4" /> Search
          </Button>
          {search || appliedSearch ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDraft({ for: '', text: '' });
                update({ search: undefined });
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>
      </header>

      {/* The totals and tabs keep their frames in every state (design-match rule 2). */}
      <section aria-label="Firm totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Firms"
          value={counts?.active ?? null}
          icon={Building2}
          tone="success"
          action={{ label: 'View Firms', onClick: () => show('ACTIVE') }}
        />
        <StatCard
          label="Pending Setup"
          value={counts?.pendingSetup ?? null}
          icon={Clock3}
          tone="warning"
          action={{ label: 'View Pending', onClick: () => show('PENDING_SETUP') }}
        />
        <StatCard
          label="Inactive Firms"
          value={counts?.inactive ?? null}
          icon={X}
          tone="danger"
          action={{ label: 'View Inactive', onClick: () => show('INACTIVE') }}
        />
        <StatCard
          label="Total Firms"
          value={counts?.total ?? null}
          icon={UsersRound}
          tone="purple"
          action={{ label: 'View All', onClick: () => show(undefined) }}
        />
      </section>

      <div
        role="tablist"
        aria-label="Filter firms by status"
        className="flex gap-6 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => {
          const selected = status === tab.value;
          return (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => show(tab.value)}
              className={`-mb-px shrink-0 border-b-2 px-1 py-3 text-sm ${selected ? 'border-action font-semibold text-action' : 'border-transparent text-muted hover:text-heading'}`}
            >
              {tab.label}
              {counts ? ` (${counts[tab.count]})` : ''}
            </button>
          );
        })}
      </div>

      {/* SA-FRM-Y08: the plan the firm's application asked for. */}
      <label className="flex flex-col gap-1 text-sm font-medium text-heading sm:w-64">
        Plan
        <select
          className={selectClass}
          value={plan ?? ''}
          onChange={(event) => update({ plan: event.target.value || undefined })}
        >
          <option value="">All plans</option>
          {Object.entries(FIRM_PLANS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <PageState query={query}>
        {(data) => {
          const first = data.total ? (page - 1) * data.pageSize + 1 : 0;
          const last = Math.min(page * data.pageSize, data.total);
          const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
          return (
            <>
              {data.items.length ? (
                <>
                  <Card variant="elevated" className="overflow-hidden !p-0">
                    <ul data-testid="firm-list" className="divide-y divide-border sm:hidden">
                      {data.items.map((firm) => (
                        <li key={firm.id} data-testid="firm-row" className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 font-semibold text-heading">{firm.name}</p>
                            <StatusBadge status={firm.status} />
                          </div>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-sm">
                            <div className="col-span-2">
                              <dt className="text-xs text-muted">Owner / Primary Contact</dt>
                              <dd className="mt-1 break-words font-medium text-text">
                                {firm.owner?.name ?? 'Not assigned'}
                                {firm.owner?.email ? (
                                  <span className="block font-normal text-muted wrap-anywhere">
                                    <EmailText value={firm.owner.email} />
                                  </span>
                                ) : null}
                                {firm.owner?.phone ? (
                                  <span className="block font-normal text-muted">
                                    {formatPhone(firm.owner.phone)}
                                  </span>
                                ) : null}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted">Plan</dt>
                              <dd className="mt-1 text-text">
                                {firm.plan ? FIRM_PLANS[firm.plan] : '—'}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted">Date Approved</dt>
                              <dd className="mt-1 text-text">
                                <ApprovedDate value={firm.approvedAt} />
                              </dd>
                            </div>
                          </dl>
                          <Link
                            aria-label={`Open firm ${firm.name}`}
                            href={withOrigin(`/firms/${firm.id}`, here)}
                            className="flex justify-center rounded-control bg-platform-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-platform-navy-raised"
                          >
                            Open Firm
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden sm:block">
                      <ListTable
                        head={[
                          { label: '#', center: true },
                          { label: 'Business Name', sort: sortBy('name') },
                          { label: 'Owner / Primary Contact' },
                          { label: 'Email' },
                          { label: 'Phone', className: 'hidden 2xl:table-cell' },
                          { label: 'Plan' },
                          { label: 'Status' },
                          { label: 'Date Approved', sort: sortBy('approved') },
                          {
                            label: 'Actions',
                            center: true,
                            className: 'hidden min-[85rem]:table-cell',
                          },
                        ]}
                      >
                        {data.items.map((firm, index) => (
                          <tr key={firm.id} className="hover:bg-subtle">
                            <td className={firstCellClass}>{first + index}</td>
                            <th
                              scope="row"
                              className={`${cellClass} min-w-40 break-words font-semibold text-heading`}
                            >
                              {/* Below 1360 px there is no Actions column: the name opens the firm. */}
                              <Link
                                href={withOrigin(`/firms/${firm.id}`, here)}
                                className="hover:text-link"
                              >
                                {firm.name}
                              </Link>
                            </th>
                            <td className={`${cellClass} break-words`}>
                              {firm.owner?.name ?? 'Not assigned'}
                              {firm.owner?.phone ? (
                                <span className="block whitespace-nowrap text-muted 2xl:hidden">
                                  {formatPhone(firm.owner.phone)}
                                </span>
                              ) : null}
                            </td>
                            <td className={`${cellClass} ${emailCellClass}`}>
                              {firm.owner?.email ? <EmailText value={firm.owner.email} /> : '—'}
                            </td>
                            <td className={`${cellClass} hidden whitespace-nowrap 2xl:table-cell`}>
                              {firm.owner?.phone ? formatPhone(firm.owner.phone) : '—'}
                            </td>
                            <td className={cellClass}>{firm.plan ? FIRM_PLANS[firm.plan] : '—'}</td>
                            <td className={cellClass}>
                              <StatusBadge status={firm.status} />
                            </td>
                            <td className={`${cellClass} whitespace-nowrap`}>
                              <ApprovedDate value={firm.approvedAt} />
                            </td>
                            <td
                              className={`${cellClass} hidden text-center min-[85rem]:table-cell`}
                            >
                              <Link
                                aria-label={`Open firm ${firm.name}`}
                                href={withOrigin(`/firms/${firm.id}`, here)}
                                className="inline-flex whitespace-nowrap rounded-control bg-platform-navy px-3 py-2 text-sm font-semibold text-white hover:bg-platform-navy-raised 2xl:px-4 2xl:py-2.5"
                              >
                                Open Firm
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </ListTable>
                    </div>
                  </Card>
                  <ListPager
                    noun="firms"
                    first={first}
                    last={last}
                    total={data.total}
                    page={page}
                    pageCount={pageCount}
                    onPage={setPage}
                  />
                </>
              ) : (
                <Card variant="elevated" data-testid="firms-empty" className="!p-10 text-center">
                  <Building2 aria-hidden className="mx-auto size-9 text-muted" />
                  <p className="mt-3 font-semibold text-heading">No firms found</p>
                  <p className="mt-1 text-sm text-muted">
                    Try a different search or status filter.
                  </p>
                </Card>
              )}
            </>
          );
        }}
      </PageState>
    </div>
  );
}
