'use client';

import { FIRM_PLANS, type FirmStatusFilter } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { Building2, Clock3, Search, UsersRound, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import {
  cellClass,
  firstCellClass,
  formatPhone,
  ListPager,
  ListTable,
  SearchBox,
  StatCard,
} from '../../_components/list-parts';

const tabs: {
  value: FirmStatusFilter | undefined;
  label: string;
  count: 'total' | 'active' | 'pendingSetup' | 'inactive';
}[] = [
  { value: undefined, label: 'All Firms', count: 'total' },
  { value: 'ACTIVE', label: 'Active', count: 'active' },
  { value: 'PENDING_SETUP', label: 'Pending Setup', count: 'pendingSetup' },
  { value: 'INACTIVE', label: 'Inactive', count: 'inactive' },
];

const statusText = (status: string) =>
  status === 'PENDING_SETUP' ? 'Pending Setup' : status === 'ACTIVE' ? 'Active' : 'Inactive';

const dateText = (value: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(value),
  );

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
  const [status, setStatus] = useState<FirmStatusFilter>();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = useApiQuery(['admin-firms', status, appliedSearch, page], async () => {
    const [counts, result] = await Promise.all([
      api.firmApplications.firmCounts(),
      api.firmApplications.listFirms({
        status,
        search: appliedSearch || undefined,
        page,
        pageSize: 10,
      }),
    ]);
    return { ...result, counts };
  });

  function searchFirms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The API refuses control characters and more than 100 characters (SearchText).
    setAppliedSearch(search.replace(/[\p{Cc}\p{Cs}]/gu, ' ').trim());
    setPage(1);
  }

  function show(value: FirmStatusFilter | undefined) {
    setStatus(value);
    setPage(1);
  }

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
        <form onSubmit={searchFirms} className="flex flex-col gap-3 sm:flex-row xl:mt-2">
          <SearchBox
            label="Search firms"
            className="sm:w-96"
            placeholder="Search firms by name, owner, or email..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button type="submit" className="gap-2">
            <Search aria-hidden className="size-4" /> Search
          </Button>
          {search || appliedSearch ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearch('');
                setAppliedSearch('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>
      </header>

      <PageState query={query}>
        {(data) => {
          const first = data.total ? (page - 1) * data.pageSize + 1 : 0;
          const last = Math.min(page * data.pageSize, data.total);
          const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
          return (
            <>
              <section
                aria-label="Firm totals"
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              >
                <StatCard
                  label="Active Firms"
                  value={data.counts.active}
                  icon={Building2}
                  tone="success"
                  action={{ label: 'View Firms', onClick: () => show('ACTIVE') }}
                />
                <StatCard
                  label="Pending Setup"
                  value={data.counts.pendingSetup}
                  icon={Clock3}
                  tone="warning"
                  action={{ label: 'View Pending', onClick: () => show('PENDING_SETUP') }}
                />
                <StatCard
                  label="Inactive Firms"
                  value={data.counts.inactive}
                  icon={X}
                  tone="danger"
                  action={{ label: 'View Inactive', onClick: () => show('INACTIVE') }}
                />
                <StatCard
                  label="Total Firms"
                  value={data.counts.total}
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
                      {tab.label} ({data.counts[tab.count]})
                    </button>
                  );
                })}
              </div>

              {data.items.length ? (
                <>
                  <Card className="overflow-hidden !p-0">
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
                                  <span className="block break-all font-normal text-muted">
                                    {firm.owner.email}
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
                        </li>
                      ))}
                    </ul>
                    <div className="hidden sm:block">
                      <ListTable
                        head={[
                          '#',
                          'Business Name',
                          'Owner / Primary Contact',
                          'Email',
                          'Phone',
                          'Plan',
                          'Status',
                          'Date Approved',
                        ]}
                      >
                        {data.items.map((firm, index) => (
                          <tr key={firm.id} className="hover:bg-subtle">
                            <td className={firstCellClass}>{first + index}</td>
                            <th
                              scope="row"
                              className={`${cellClass} min-w-40 break-words font-semibold text-heading`}
                            >
                              {firm.name}
                            </th>
                            <td className={`${cellClass} break-words`}>
                              {firm.owner?.name ?? 'Not assigned'}
                            </td>
                            <td className={`${cellClass} whitespace-nowrap`}>
                              {firm.owner?.email ?? '—'}
                            </td>
                            <td className={`${cellClass} whitespace-nowrap`}>
                              {formatPhone(firm.owner?.phone)}
                            </td>
                            <td className={cellClass}>{firm.plan ? FIRM_PLANS[firm.plan] : '—'}</td>
                            <td className={cellClass}>
                              <StatusBadge status={firm.status} />
                            </td>
                            <td className={`${cellClass} whitespace-nowrap`}>
                              <ApprovedDate value={firm.approvedAt} />
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
                <Card data-testid="firms-empty" className="!p-10 text-center">
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
