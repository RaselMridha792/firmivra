'use client';

import { FIRM_PLANS, type FirmStatusFilter } from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { Building2, CircleCheck, Clock3, Search, UsersRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

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

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Building2;
  tone: 'blue' | 'green' | 'amber' | 'violet';
}) {
  const tones = {
    blue: 'bg-info-soft text-info',
    green: 'bg-success-soft text-success',
    amber: 'bg-warning-soft text-warning',
    violet: 'bg-accent-soft text-accent',
  };
  return (
    <Card className="flex min-h-28 items-center gap-4 p-4 shadow-sm sm:p-5">
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-2xl ${tones[tone]}`}
      >
        <Icon aria-hidden className="size-7" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold tracking-tight text-heading">{value}</span>
        <span className="mt-1 block text-sm text-muted">{label}</span>
      </span>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE'
      ? 'bg-success-soft text-success'
      : status === 'PENDING_SETUP'
        ? 'bg-warning-soft text-warning'
        : 'bg-subtle text-muted';
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${tone}`}
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
    setAppliedSearch(search.trim());
    setPage(1);
  }

  return (
    <div className="mx-auto flex w-full max-w-content flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-link">Super Admin Portal</p>
          <h1
            data-testid="page-title"
            className="mt-1 font-serif text-4xl font-bold tracking-tight text-heading"
          >
            Firms
          </h1>
          <p className="mt-2 text-base text-muted">
            Manage businesses and see their current platform status.
          </p>
        </div>
      </header>

      <PageState query={query}>
        {(data) => {
          const first = data.total ? (page - 1) * data.pageSize + 1 : 0;
          const last = Math.min(page * data.pageSize, data.total);
          return (
            <>
              <section
                aria-label="Firm totals"
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
              >
                <StatCard
                  label="Total Firms"
                  value={data.counts.total}
                  icon={Building2}
                  tone="blue"
                />
                <StatCard
                  label="Active Firms"
                  value={data.counts.active}
                  icon={CircleCheck}
                  tone="green"
                />
                <StatCard
                  label="Pending Setup"
                  value={data.counts.pendingSetup}
                  icon={Clock3}
                  tone="amber"
                />
                <StatCard
                  label="Inactive Firms"
                  value={data.counts.inactive}
                  icon={UsersRound}
                  tone="violet"
                />
              </section>

              <Card className="overflow-hidden p-0 shadow-sm">
                <div className="border-b border-border px-5 pt-2 sm:px-6">
                  <div
                    role="tablist"
                    aria-label="Filter firms by status"
                    className="flex gap-5 overflow-x-auto"
                  >
                    {tabs.map((tab) => {
                      const selected = status === tab.value;
                      return (
                        <button
                          key={tab.label}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          onClick={() => {
                            setStatus(tab.value);
                            setPage(1);
                          }}
                          className={`-mb-px min-h-12 shrink-0 border-b-2 px-1 text-sm font-semibold transition-colors ${selected ? 'border-action text-action' : 'border-transparent text-muted hover:text-heading'}`}
                        >
                          {tab.label} <span className="ml-1">({data.counts[tab.count]})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <form
                  onSubmit={searchFirms}
                  className="flex flex-wrap items-end gap-3 border-b border-border p-4 sm:p-5"
                >
                  <div className="min-w-56 flex-1">
                    <Input
                      label="Search firms"
                      type="search"
                      placeholder="Business name, owner, or email"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
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

                {data.items.length ? (
                  <>
                    <ul data-testid="firm-list" className="divide-y divide-border sm:hidden">
                      {data.items.map((firm) => (
                        <li key={firm.id} data-testid="firm-row" className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-heading">{firm.name}</p>
                              <p className="mt-1 break-all text-xs text-muted">{firm.slug}</p>
                            </div>
                            <StatusBadge status={firm.status} />
                          </div>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-sm">
                            <div>
                              <dt className="text-xs text-muted">Owner / Contact</dt>
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
                                {firm.plan ? FIRM_PLANS[firm.plan] : 'No plan'}
                              </dd>
                            </div>
                            <div className="col-span-2">
                              <dt className="text-xs text-muted">Created</dt>
                              <dd className="mt-1 text-text">
                                <time dateTime={firm.createdAt}>{dateText(firm.createdAt)}</time>
                              </dd>
                            </div>
                          </dl>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full min-w-4xl border-collapse text-left">
                        <thead className="bg-canvas text-sm text-heading">
                          <tr>
                            <th scope="col" className="px-5 py-4 font-semibold">
                              Business Name
                            </th>
                            <th scope="col" className="px-5 py-4 font-semibold">
                              Owner / Contact
                            </th>
                            <th scope="col" className="px-5 py-4 font-semibold">
                              Plan
                            </th>
                            <th scope="col" className="px-5 py-4 font-semibold">
                              Created
                            </th>
                            <th scope="col" className="px-5 py-4 font-semibold">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {data.items.map((firm) => (
                            <tr key={firm.id} className="transition-colors hover:bg-canvas/70">
                              <td className="px-5 py-4">
                                <p className="font-semibold text-heading">{firm.name}</p>
                                <p className="mt-1 text-sm text-muted">{firm.slug}</p>
                              </td>
                              <td className="px-5 py-4">
                                <p className="text-sm font-medium text-text">
                                  {firm.owner?.name ?? 'Not assigned'}
                                </p>
                                {firm.owner?.email ? (
                                  <p className="mt-1 text-sm text-muted">{firm.owner.email}</p>
                                ) : null}
                              </td>
                              <td className="px-5 py-4 text-sm text-text">
                                {firm.plan ? FIRM_PLANS[firm.plan] : 'No plan'}
                              </td>
                              <td className="px-5 py-4 text-sm text-text">
                                <time dateTime={firm.createdAt}>{dateText(firm.createdAt)}</time>
                              </td>
                              <td className="px-5 py-4">
                                <StatusBadge status={firm.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-6">
                      <p aria-live="polite" className="text-sm text-muted">
                        Showing {first}–{last} of {data.total} firms
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          aria-label="Previous firms page"
                          disabled={page === 1}
                          onClick={() => setPage((value) => value - 1)}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="secondary"
                          aria-label="Next firms page"
                          disabled={last >= data.total}
                          onClick={() => setPage((value) => value + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </footer>
                  </>
                ) : (
                  <div data-testid="firms-empty" className="p-10 text-center">
                    <Building2 aria-hidden className="mx-auto size-9 text-muted" />
                    <p className="mt-3 font-semibold text-heading">No firms found</p>
                    <p className="mt-1 text-sm text-muted">
                      Try a different search or status filter.
                    </p>
                  </div>
                )}
              </Card>
            </>
          );
        }}
      </PageState>
    </div>
  );
}
