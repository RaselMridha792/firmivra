'use client';

import type { ClientListRow, ListClientsQuery, TeamMember } from '@firmivra/types';
import { ActionMenu, Button, EmptyState, Tabs, Toast, type TabItem } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  Archive,
  CaretDown,
  Plus,
  ShieldCheck,
  Users,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { TEAM } from '../../../setup/_components/shared';
import { AddClientDialog, BulkDialog, type BulkKind } from './clients-dialogs';
import { ClientsFilterRow } from './clients-filters';
import { ClientsKpis } from './clients-kpis';
import { ClientCards, ClientsTable, type RowAction } from './clients-table';
import {
  type ClientFilters,
  CLIENTS_SUMMARY,
  clientsListKey,
  filtersForTab,
  NO_FILTERS,
  PAGE_SIZES,
  tabFor,
} from './list-parts';

/** Waits until typing pauses, so each key press doesn't send a request. */
function useSettled(value: string, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The API's query from the filters. A range whose start is after its end is left out. */
function listQuery(filters: ClientFilters, search: string, manager: boolean) {
  const range = filters.from && filters.to && filters.from > filters.to ? null : filters;
  return {
    status: filters.records,
    ...(search ? { search } : {}),
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...(filters.clientStatus ? { clientStatus: filters.clientStatus } : {}),
    ...(manager && filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
    ...(range?.from ? { lastActivityFrom: range.from } : {}),
    ...(range?.to ? { lastActivityTo: range.to } : {}),
  } satisfies ListClientsQuery;
}

type Pending = { kind: BulkKind; clients: { id: string; displayName: string }[] } | null;

/**
 * The firm's Clients list (clients.jpg): KPI cards, tabs by stage and service, filters, Add New
 * Client, Bulk Actions, the table and numbered pages. Owner and Admin see every client; Staff see
 * the clients assigned to them (the API decides) and no assignee filter, bulk or archive controls.
 */
export function ClientsScreen({ initialSearch = '' }: { initialSearch?: string }) {
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const [filters, setFilters] = useState<ClientFilters>({ ...NO_FILTERS, search: initialSearch });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZES[0] ?? 8);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState('');

  // The API refuses control characters and more than 100 characters (SearchText).
  const search = useSettled(filters.search.replace(/[\p{Cc}\p{Cs}]/gu, ' ').trim());
  const query = useMemo<ListClientsQuery>(
    () => ({ ...listQuery(filters, search, manager), page, limit }),
    [filters, search, manager, page, limit],
  );
  const summary = useApiQuery(CLIENTS_SUMMARY, () => api.clients.summary());
  const list = useApiQuery(clientsListKey(query), () => api.clients.list(query));
  // The firm's people for the staff filter and Assign: Owner and Admin only (403 for Staff).
  const team = useApiQuery(
    manager ? TEAM : [...TEAM, 'not-a-manager'],
    (): Promise<TeamMember[]> => (manager ? api.team.list() : Promise.resolve([])),
  );
  const members = (team.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ userId: m.user.id, name: m.user.name }));
  const services = summary.data?.counts.byService ?? [];

  // After an archive empties the last page, step back to the new last page.
  const lastPage = list.data ? Math.max(1, Math.ceil(list.data.total / limit)) : page;
  if (page > lastPage) setPage(lastPage);

  const change = (patch: Partial<ClientFilters>) => {
    setFilters((was) => ({ ...was, ...patch }));
    setPage(1);
    setSelected([]);
  };
  const reset = () => change(NO_FILTERS);
  const filtered =
    Boolean(search) ||
    Object.entries(NO_FILTERS).some(
      ([key, value]) => key !== 'search' && filters[key as keyof ClientFilters] !== value,
    );

  const counts = summary.data?.counts;
  const tabs: TabItem[] = [
    { id: 'all', label: 'All Clients', count: counts?.all },
    { id: 'active', label: 'Active', count: counts?.active },
    { id: 'new', label: 'New', count: counts?.new },
    ...services.map((s) => ({ id: `service:${s.id}`, label: s.name, count: s.count })),
    { id: 'inactive', label: 'Inactive', count: counts?.inactive },
  ];
  const selectTab = (id: string) => change(filtersForTab(id));

  // The list's states; its Try again reloads the cards and tabs too.
  const listAndSummary: typeof list = {
    ...list,
    refetch: (options) => {
      void summary.refetch();
      return list.refetch(options);
    },
  };

  const rows = list.data?.items ?? [];
  const chosen = (ids: string[]) =>
    rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, displayName: r.displayName }));
  const openBulk = (kind: BulkKind) => setPending({ kind, clients: chosen(selected) });
  const onRowAction = (client: ClientListRow, action: RowAction) =>
    setPending({ kind: action, clients: [{ id: client.id, displayName: client.displayName }] });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header>
        <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
          Clients
        </h1>
        <p className="mt-1 text-muted">
          Manage your clients, view their status, and stay on top of what&apos;s happening with your
          firm.
        </p>
      </header>

      <ClientsKpis summary={summary} onTab={selectTab} />

      <section aria-label="Client list" className="min-w-0">
        <div className="min-w-0 [&_[role=tab]]:min-h-10 [&_[role=tab]]:!text-xs [&_[role=tab]]:flex-1 [&_[role=tab]]:whitespace-nowrap [&_[role=tab]]:justify-center [&_[role=tab]]:rounded-b-none [&_[role=tab]]:px-3 [&_[role=tab][aria-selected=false]]:font-normal [&_[role=tab][aria-selected=true]]:font-semibold">
          <Tabs
            label="Client views"
            variant="pill"
            items={tabs}
            value={tabFor(filters)}
            onChange={selectTab}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4 rounded-b-xl bg-surface p-3 shadow-md">
          <ClientsFilterRow
            filters={filters}
            services={services}
            members={members}
            manager={manager}
            onChange={change}
            onReset={reset}
          />
          <div className="flex flex-wrap items-center justify-end gap-3">
            {manager ? (
              <p aria-live="polite" className="mr-auto text-sm font-semibold text-heading">
                {selected.length
                  ? `${selected.length} ${selected.length === 1 ? 'client' : 'clients'} selected`
                  : ''}
              </p>
            ) : null}
            <Button
              data-testid="add-client"
              onClick={() => setAdding(true)}
              className="!min-h-9 !bg-gold-light font-semibold !text-heading hover:brightness-95"
            >
              <Plus aria-hidden weight="bold" className="size-4" />
              Add New Client
            </Button>
            {manager ? (
              selected.length ? (
                <ActionMenu
                  label="Bulk Actions"
                  className="[&>button]:!min-h-9 [&>button]:!px-4"
                  trigger="Bulk Actions"
                  sections={[
                    {
                      title: 'Client Management',
                      items: [
                        {
                          label: 'Assign Staff Member',
                          icon: Users,
                          onSelect: () => openBulk('ASSIGN'),
                        },
                      ],
                    },
                    {
                      title: 'Data & Records (Restricted)',
                      items: [
                        {
                          label: 'Archive Clients',
                          icon: Archive,
                          restricted: 'Admin Only',
                          onSelect: () => openBulk('ARCHIVE'),
                        },
                        {
                          label: 'Restore Clients',
                          icon: ArrowCounterClockwise,
                          restricted: 'Admin Only',
                          onSelect: () => openBulk('RESTORE'),
                        },
                      ],
                    },
                  ]}
                  footer={
                    <span className="flex gap-2">
                      <ShieldCheck
                        aria-hidden
                        weight="fill"
                        className="size-5 shrink-0 text-danger"
                      />
                      <span>
                        <span className="block font-semibold text-danger">Restricted Actions</span>
                        Actions marked Admin Only need an Owner or Admin. This helps protect
                        sensitive client data.
                      </span>
                    </span>
                  }
                />
              ) : (
                <Button
                  variant="secondary"
                  disabled
                  title="Select clients first"
                  className="!min-h-9 border-divider font-semibold"
                >
                  Bulk Actions
                  <CaretDown aria-hidden weight="bold" className="size-3.5" />
                </Button>
              )
            ) : null}
          </div>
          {notice ? <Toast message={notice} onDismiss={() => setNotice('')} /> : null}
          <PageState query={listAndSummary}>
            {(data) => {
              if (!data.items.length) {
                return filtered || page > 1 ? (
                  <EmptyState
                    title="No matching clients"
                    description="No client matches these filters. Try another search, or reset the filters."
                    action={
                      <Button variant="secondary" onClick={reset}>
                        Reset Filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title="No clients yet"
                    description="Clients appear here when you approve their sign-up, convert a lead, or add them yourself."
                    action={
                      <Button onClick={() => setAdding(true)}>
                        <Plus aria-hidden weight="bold" className="size-4" />
                        Add New Client
                      </Button>
                    }
                  />
                );
              }
              const props = {
                rows: data.items,
                total: data.total,
                page,
                pageSize: limit,
                manager,
                selected,
                onSelect: setSelected,
                onPage: (next: number) => {
                  setPage(next);
                  setSelected([]);
                },
                onPageSize: (size: number) => {
                  setLimit(size);
                  setPage(1);
                  setSelected([]);
                },
                onAction: onRowAction,
              };
              return (
                <>
                  <div className="hidden min-w-0 xl:block">
                    <ClientsTable {...props} />
                  </div>
                  <div className="min-w-0 xl:hidden">
                    <ClientCards {...props} />
                  </div>
                </>
              );
            }}
          </PageState>
        </div>
      </section>

      {adding ? (
        <AddClientDialog manager={manager} members={members} onClose={() => setAdding(false)} />
      ) : null}
      {pending ? (
        <BulkDialog
          kind={pending.kind}
          clients={pending.clients}
          members={members}
          onClose={() => setPending(null)}
          onDone={(message) => {
            setPending(null);
            setSelected([]);
            setNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}
