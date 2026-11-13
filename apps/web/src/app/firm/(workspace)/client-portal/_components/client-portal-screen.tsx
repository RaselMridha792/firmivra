'use client';

import type { ClientListRow, ClientStatus, RecentPortalClient } from '@firmivra/types';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  Pagination,
  SearchField,
  Select,
  Skeleton,
} from '@firmivra/ui';
import { CaretDown, CaretRight, Info, UsersThree } from '@phosphor-icons/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { STAGE_ORDER, STAGES } from '../../clients/_components/list-parts';
import { ClientPanel, PORTAL_TABS, type PortalTabId } from './client-panel';
import { headerKey, RECENT_KEY } from './keys';

const PAGE_SIZE = 8;

/**
 * The firm workspace's Client Portal (Client Portal developer instructions 1 to 6 and 10; Frame 1,
 * client-portal.jpg): one page for any client. Switch Client, Recent Clients or the list choose
 * the active client, kept in the address (`?client=`), so Back and a reload keep it; the page
 * reopens the member's last client. Switching remounts the client's panel, so nothing of the
 * previous client shows while the next one loads.
 */
export function ClientPortalScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const recent = useApiQuery(RECENT_KEY, () => api.clientPortal.recent());
  const fromUrl = params.get('client');
  const tabParam = params.get('tab');
  const tab: PortalTabId = PORTAL_TABS.some((t) => t.id === tabParam)
    ? (tabParam as PortalTabId)
    : 'overview';
  const active = fromUrl ?? recent.data?.items[0]?.id ?? null;

  const go = (client: string, next: PortalTabId = 'overview') => {
    const query = new URLSearchParams({ client });
    if (next !== 'overview') query.set('tab', next);
    router.push(`${pathname}?${query.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="client-portal">
      <header className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
          <UsersThree aria-hidden weight="fill" className="size-8" />
        </span>
        <div>
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            Client Portal
          </h1>
          <p className="text-base text-muted">
            View a client&apos;s portal, switch between clients, and access their records.
          </p>
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title="Switch Client" className="min-w-0">
          <ClientSwitcher activeId={active} onSelect={(id) => go(id)} />
        </Card>
        <Card title="Recent Clients" className="min-w-0">
          <RecentClients
            items={recent.isPending ? undefined : (recent.data?.items ?? [])}
            activeId={active}
            onSelect={(id) => go(id)}
          />
          <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
            <Info aria-hidden className="size-4 shrink-0" />
            Use the client dropdown or click a client in the list to switch the active client view.
          </p>
        </Card>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        <ClientList activeId={active} onSelect={(id) => go(id)} />
        {active ? (
          <ClientPanel
            key={active}
            clientId={active}
            tab={tab}
            onTab={(next) => go(active, next)}
          />
        ) : recent.isPending ? (
          <Skeleton className="h-96" />
        ) : (
          <EmptyState
            title="Select a client"
            description="Choose a client from Switch Client, Recent Clients or the list to see their portal."
          />
        )}
      </div>
    </div>
  );
}

/** Switch Client: the active client, and a search of the firm's clients to change it. */
function ClientSwitcher({
  activeId,
  onSelect,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const header = useApiQuery(headerKey(activeId ?? 'none'), () =>
    activeId ? api.clientPortal.get(activeId) : Promise.resolve(null),
  );
  useEffect(() => {
    const t = setTimeout(() => setQuery(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const results = useApiQuery(['client-portal', 'switch', query], () =>
    api.clients.list({ search: query || undefined, limit: 8 }),
  );
  const current = header.data?.client;
  return (
    <div ref={box} className="relative" data-testid="client-switcher">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-lg border border-divider bg-canvas px-3 py-2.5 text-left"
      >
        {current ? (
          <>
            <Avatar name={current.name} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-heading">{current.name}</span>
              <span className="block truncate text-sm text-muted">
                ID: {current.number}
                {current.email ? ` | ${current.email}` : ''}
              </span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-muted">Choose a client</span>
        )}
        <CaretDown aria-hidden className="size-4 text-muted" />
      </button>
      {open ? (
        <div
          className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-divider bg-surface p-2 shadow-card"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <SearchField
            label="Search clients"
            placeholder="Name, email, phone, company or Client ID"
            value={term}
            autoFocus
            onChange={(e) => setTerm(e.target.value)}
          />
          <ul role="listbox" aria-label="Clients" className="mt-2 max-h-72 overflow-y-auto">
            {results.isPending ? (
              <li className="p-2 text-sm text-muted">Searching…</li>
            ) : (results.data?.items.length ?? 0) === 0 ? (
              <li className="p-2 text-sm text-muted">No clients match.</li>
            ) : (
              results.data?.items.map((c) => (
                <li key={c.id} role="option" aria-selected={c.id === activeId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-canvas"
                    onClick={() => {
                      setOpen(false);
                      setTerm('');
                      onSelect(c.id);
                    }}
                  >
                    <Avatar name={c.displayName} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-heading">
                        {c.displayName}
                      </span>
                      <span className="block truncate text-xs text-muted">{c.email ?? '—'}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RecentClients({
  items,
  activeId,
  onSelect,
}: {
  items: RecentPortalClient[] | undefined;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (!items) return <Skeleton className="h-16" />;
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">Clients you open here show up for one-click switching.</p>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="recent-clients">
      {items.slice(0, 4).map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            aria-current={c.id === activeId ? 'true' : undefined}
            className="flex w-full items-center gap-3 rounded-lg border border-divider p-3 text-left hover:bg-canvas aria-[current]:border-action"
          >
            <Avatar name={c.name} size="lg" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-heading">{c.name}</span>
              <span className="block text-xs text-muted">{c.number}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The left panel: the firm's clients (the canonical list), filtered and paged. */
function ClientList({
  activeId,
  onSelect,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<ClientStatus | ''>('');
  const [serviceId, setServiceId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [term]);
  const summary = useApiQuery(['clients', 'summary'], () => api.clients.summary());
  const services = summary.data?.counts.byService ?? [];
  const list = useApiQuery(['client-portal', 'list', search, stage, serviceId, page], () =>
    api.clients.list({
      search: search || undefined,
      clientStatus: stage || undefined,
      serviceId: serviceId || undefined,
      page,
      limit: PAGE_SIZE,
    }),
  );
  return (
    <Card title="Clients" data-testid="portal-client-list" className="min-w-0">
      <div className="flex flex-col gap-3">
        <SearchField
          label="Search clients"
          placeholder="Search clients by name, email, or company..."
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Status"
            hideLabel
            value={stage}
            onChange={(e) => {
              setStage(e.target.value as ClientStatus | '');
              setPage(1);
            }}
            options={[
              { value: '', label: 'All Statuses' },
              ...STAGE_ORDER.map((s) => ({ value: s, label: STAGES[s].label })),
            ]}
          />
          <Select
            label="Service"
            hideLabel
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All Services' },
              ...services.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
        <PageState
          query={list}
          empty={
            search || stage || serviceId ? 'No clients match these filters.' : 'No clients yet.'
          }
          isEmpty={(data) => data.items.length === 0}
        >
          {(data) => (
            <>
              <ul className="-mx-2 flex flex-col">
                {data.items.map((c) => (
                  <ClientRow key={c.id} row={c} active={c.id === activeId} onSelect={onSelect} />
                ))}
              </ul>
              <Pagination
                page={page}
                onPage={setPage}
                pageCount={Math.max(1, Math.ceil(data.total / PAGE_SIZE))}
                summary={`Showing ${(page - 1) * PAGE_SIZE + 1} – ${Math.min(page * PAGE_SIZE, data.total)} of ${data.total} clients`}
              />
            </>
          )}
        </PageState>
      </div>
    </Card>
  );
}

function ClientRow({
  row,
  active,
  onSelect,
}: {
  row: ClientListRow;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const stage = STAGES[row.status];
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        aria-current={active ? 'true' : undefined}
        data-testid="portal-client-row"
        className="flex w-full items-center gap-3 rounded-md border-l-4 border-transparent px-2 py-2.5 text-left hover:bg-canvas aria-[current]:border-action aria-[current]:bg-canvas"
      >
        <Avatar name={row.displayName} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-heading">{row.displayName}</span>
          <span className="block truncate text-sm text-muted">{row.email ?? 'No email'}</span>
        </span>
        <span className="hidden text-xs text-muted sm:inline">
          {row.accountType === 'BUSINESS' ? 'Business' : 'Individual'}
        </span>
        <Badge tone={stage.tone} dot>
          {stage.label}
        </Badge>
        <CaretRight aria-hidden className="size-4 text-muted" />
      </button>
    </li>
  );
}
