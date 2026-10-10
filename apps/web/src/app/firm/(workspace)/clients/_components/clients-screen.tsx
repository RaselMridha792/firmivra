'use client';

import type { ClientListItem, ListClientsQuery } from '@firmivra/types';
import { Badge, Button, EmptyState, Select, Table, type Column } from '@firmivra/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { ACCOUNT_TYPES, CLIENTS, dateText, formatPhone, PortalBadge } from './client-parts';

type Status = NonNullable<ListClientsQuery['status']>;
const STATUSES: { value: Status; label: string }[] = [
  { value: 'active', label: 'Active clients' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All clients' },
];

const columns: Column<ClientListItem>[] = [
  {
    id: 'name',
    label: 'Client',
    cell: (client) => (
      <span className="block min-w-40">
        <Link
          href={`/clients/${client.id}`}
          className="font-medium text-link hover:underline"
          data-testid="client-link"
        >
          {client.displayName}
        </Link>
        <span className="block text-xs text-muted">{ACCOUNT_TYPES[client.accountType]}</span>
      </span>
    ),
  },
  {
    id: 'contact',
    label: 'Contact',
    cell: (client) => (
      <span className="block min-w-48">
        <span className="block">{client.email ?? '—'}</span>
        {client.phone ? (
          <span className="block whitespace-nowrap text-xs text-muted">
            {formatPhone(client.phone)}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'assigned',
    label: 'Assigned to',
    cell: (client) => client.assignedTo?.name ?? <span className="text-muted">Unassigned</span>,
  },
  {
    id: 'portal',
    label: 'Portal',
    cell: (client) => (
      <span className="flex flex-wrap gap-1 whitespace-nowrap">
        <PortalBadge status={client.portalStatus} />
        {client.archivedAt ? <Badge>Archived</Badge> : null}
      </span>
    ),
  },
  {
    id: 'added',
    label: 'Added',
    cell: (client) => (
      <time dateTime={client.createdAt} className="whitespace-nowrap">
        {dateText(client.createdAt)}
      </time>
    ),
  },
];

/** One client on a phone: the table's columns stacked in a row. */
function ClientCard({ client }: { client: ClientListItem }) {
  return (
    <li data-testid="client-card" className="flex flex-col gap-2 p-4">
      <span className="flex items-start justify-between gap-3">
        <Link href={`/clients/${client.id}`} className="font-medium text-link hover:underline">
          {client.displayName}
        </Link>
        <span className="flex flex-wrap justify-end gap-1">
          <PortalBadge status={client.portalStatus} />
          {client.archivedAt ? <Badge>Archived</Badge> : null}
        </span>
      </span>
      <span className="text-sm text-text">
        <span className="block wrap-anywhere">{client.email ?? '—'}</span>
        {client.phone ? <span className="block">{formatPhone(client.phone)}</span> : null}
      </span>
      <span className="text-xs text-muted">
        {ACCOUNT_TYPES[client.accountType]} · {client.assignedTo?.name ?? 'Unassigned'} · Added{' '}
        {dateText(client.createdAt)}
      </span>
    </li>
  );
}

/** Waits until typing pauses, so each key press doesn't send a request. */
function useSettled(value: string, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The firm's clients, newest first, 25 a page. Owner and Admin see every client; Staff see the
 * clients assigned to them (the API decides). Search matches name, email and phone.
 */
export function ClientsScreen() {
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<Status>('active');
  // The cursors of the pages after the first, so Previous can step back.
  const [cursors, setCursors] = useState<string[]>([]);
  // The API refuses control characters and more than 100 characters (SearchText).
  const search = useSettled(typed.replace(/[\p{Cc}\p{Cs}]/gu, ' ').trim());
  const cursor = cursors.at(-1);
  const query: ListClientsQuery = {
    status,
    ...(search ? { search } : {}),
    ...(cursor ? { cursor } : {}),
  };
  const clients = useApiQuery([...CLIENTS, 'list', query], () => api.clients.list(query));
  const filtered = Boolean(search) || status !== 'active';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
            Clients
          </h1>
          <p className="text-sm text-muted">
            Everyone your firm works for. Open a client to see their record.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-col gap-1 sm:w-80">
            <span className="text-sm font-medium text-text">Search clients</span>
            <span className="relative block">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                maxLength={100}
                value={typed}
                placeholder="Name, email or phone"
                onChange={(event) => {
                  setTyped(event.target.value);
                  setCursors([]);
                }}
                className="w-full rounded-control border border-border bg-surface py-2 pl-11 pr-3 text-base text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500"
              />
            </span>
          </label>
          <div className="sm:w-48">
            <Select
              label="Show"
              value={status}
              options={STATUSES}
              onChange={(event) => {
                setStatus(event.target.value as Status);
                setCursors([]);
              }}
            />
          </div>
        </div>
      </div>
      <PageState query={clients}>
        {(page) => {
          const server = {
            page: cursors.length + 1,
            hasPrevious: cursors.length > 0,
            hasNext: page.nextCursor !== null,
            onPrevious: () => setCursors(cursors.slice(0, -1)),
            onNext: () => page.nextCursor && setCursors([...cursors, page.nextCursor]),
            onSort: () => undefined,
          };
          if (!page.items.length) {
            return (
              <EmptyState
                title={filtered ? 'No matching clients' : 'No clients yet'}
                description={
                  filtered
                    ? 'Try another name, email or phone, or change the filter.'
                    : 'Clients appear here when you approve their sign-up, or when your team adds them.'
                }
              />
            );
          }
          return (
            <>
              <div className="hidden md:block">
                <Table
                  caption="Clients"
                  rows={page.items}
                  columns={columns}
                  rowKey={(client) => client.id}
                  server={server}
                />
              </div>
              <div className="flex flex-col gap-4 md:hidden">
                <ul className="divide-y divide-border rounded-card border border-border bg-surface">
                  {page.items.map((client) => (
                    <ClientCard key={client.id} client={client} />
                  ))}
                </ul>
                <div className="flex items-center gap-3 text-sm text-muted">
                  <p aria-live="polite">Page {server.page}</p>
                  <Button
                    variant="secondary"
                    disabled={!server.hasPrevious}
                    onClick={server.onPrevious}
                  >
                    Previous
                  </Button>
                  <Button variant="secondary" disabled={!server.hasNext} onClick={server.onNext}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          );
        }}
      </PageState>
    </div>
  );
}
