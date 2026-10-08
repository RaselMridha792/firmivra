'use client';

import { FIRM_PLANS, type FirmStatusFilter } from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { useState, type FormEvent } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

const tabs: {
  value: FirmStatusFilter | undefined;
  label: string;
  count: 'total' | 'active' | 'pendingSetup' | 'inactive';
}[] = [
  { value: undefined, label: 'All firms', count: 'total' },
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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <header>
        <p className="text-sm font-medium text-link">Super Admin</p>
        <h1 data-testid="page-title" className="mt-1 text-2xl font-semibold text-text">
          Firms
        </h1>
        <p className="mt-1 text-sm text-muted">
          Search businesses and review their current status.
        </p>
      </header>
      <PageState query={query}>
        {(data) => {
          const first = data.total ? (page - 1) * data.pageSize + 1 : 0;
          const last = Math.min(page * data.pageSize, data.total);
          return (
            <>
              <section
                aria-label="Firm totals"
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                {tabs.map((tab) => (
                  <Card key={tab.label} className="p-4">
                    <p className="text-sm text-muted">{tab.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-text">
                      {data.counts[tab.count]}
                    </p>
                  </Card>
                ))}
              </section>
              <div
                role="tablist"
                aria-label="Filter firms by status"
                className="flex flex-wrap gap-2"
              >
                {tabs.map((tab) => (
                  <Button
                    key={tab.label}
                    role="tab"
                    aria-selected={status === tab.value}
                    variant={status === tab.value ? 'primary' : 'secondary'}
                    onClick={() => {
                      setStatus(tab.value);
                      setPage(1);
                    }}
                  >
                    {tab.label} ({data.counts[tab.count]})
                  </Button>
                ))}
              </div>
              <form onSubmit={searchFirms} className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <Input
                    label="Search firms"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <Button type="submit">Search</Button>
                {search || appliedSearch ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch('');
                      setAppliedSearch('');
                      setPage(1);
                    }}
                  >
                    Clear search
                  </Button>
                ) : null}
              </form>
              {data.items.length ? (
                <ul data-testid="firm-list" className="flex flex-col gap-3">
                  {data.items.map((firm) => (
                    <li key={firm.id} data-testid="firm-row">
                      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-center">
                        <div>
                          <h2 className="font-semibold text-text">{firm.name}</h2>
                          <p className="text-sm text-muted">portal.dev.firmivra.com/{firm.slug}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted">Owner / contact</p>
                          <p className="text-sm text-text">{firm.owner?.name ?? 'Not assigned'}</p>
                          {firm.owner?.email ? (
                            <p className="break-all text-sm text-muted">{firm.owner.email}</p>
                          ) : null}
                        </div>
                        <div>
                          <p className="text-xs text-muted">Status · Plan</p>
                          <p className="text-sm text-text">
                            {statusText(firm.status)} ·{' '}
                            {firm.plan ? FIRM_PLANS[firm.plan] : 'No plan'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted">Created</p>
                          <time dateTime={firm.createdAt} className="text-sm text-text">
                            {dateText(firm.createdAt)}
                          </time>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              ) : (
                <Card data-testid="firms-empty">
                  <p className="text-sm text-muted">No firms match this search.</p>
                </Card>
              )}
              <footer className="flex flex-wrap items-center justify-between gap-3">
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
          );
        }}
      </PageState>
    </main>
  );
}
