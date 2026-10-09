'use client';

import {
  ESIGN_STATUS_LABELS,
  EsignRequestStatus,
  type EsignQuickFilter,
  type EsignRequestRow,
  type ListEsignRequestsQuery,
} from '@firmivra/types';
import { Input, Select, Table, type Column } from '@firmivra/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ellipsis, FileText } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { shouldRetry, useApiQuery } from '../../lib/query';
import { shortDate } from './format';
import { StatusBadge } from './status-badge';

/** The status filter's choices: Delivered is shown as Sent, so it is not a choice of its own. */
const STATUSES = EsignRequestStatus.options.filter((s) => s !== 'DELIVERED');

const RANGES = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
  { value: 'all', label: 'All Time' },
];

/** The first of the last `days` calendar days (today included), as the list's `from` (UTC). */
const firstOfLast = (days: number) =>
  new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export interface RequestsFilters {
  q: string;
  status: EsignRequestStatus | '';
  clientId: string;
  range: string;
}

interface RequestsTableProps {
  /** Rows per page: 5 on the dashboard, more on All requests. */
  limit: number;
  /** The filters to start with (All requests reads them from its address). */
  initial?: Partial<RequestsFilters>;
  /** All requests' quick filter. It replaces the status filter, which it already narrows. */
  quickFilter?: EsignQuickFilter;
  /** A client's own tab: no client filter, always this client. */
  clientId?: string;
  caption: string;
}

/**
 * Signature requests with the mockup's search, status, client and date filters. The dashboard's
 * Recent Documents, All requests and a client's Signatures tab all use it.
 */
export function RequestsTable({
  limit,
  initial,
  clientId,
  caption,
  quickFilter,
}: RequestsTableProps) {
  const [filters, setFilters] = useState<RequestsFilters>({
    q: '',
    status: '',
    clientId: '',
    range: '30',
    ...initial,
  });
  // The cursors of the pages before this one, for Previous. Any new filter starts at page 1.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  const [shownQuick, setShownQuick] = useState(quickFilter);
  if (shownQuick !== quickFilter) {
    setShownQuick(quickFilter);
    setCursors([undefined]);
  }
  // Typing waits a moment before it searches.
  const [q, setQ] = useState(filters.q);
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.q === q ? f : { ...f, q }));
      setCursors((c) => (c.length > 1 ? [undefined] : c));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);
  const query: ListEsignRequestsQuery = {
    limit,
    ...(filters.q.trim() && { q: filters.q.trim() }),
    ...(filters.status && !quickFilter && { status: filters.status }),
    ...((clientId ?? filters.clientId) && { clientId: clientId ?? filters.clientId }),
    ...(filters.range !== 'all' && { from: firstOfLast(Number(filters.range)) }),
    ...(quickFilter && { quickFilter }),
    ...(cursor && { cursor }),
  };
  const list = useQuery({
    queryKey: ['esign', 'requests', 'list', query],
    queryFn: () => api.esign.list(query),
    // The old page stays while the next loads, so the table doesn't flash empty.
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });

  function change(next: Partial<RequestsFilters>) {
    setCursors([undefined]);
    setFilters((f) => ({ ...f, ...next }));
  }

  const columns: Column<EsignRequestRow>[] = [
    {
      id: 'title',
      label: 'Document Name',
      cell: (r) => (
        <Link
          href={`/firm-sign/requests/${r.id}`}
          className="inline-flex items-center gap-2 font-medium text-heading hover:underline"
        >
          <FileText aria-hidden className="size-5 shrink-0 text-danger" />
          {r.title}
        </Link>
      ),
    },
    ...(clientId
      ? []
      : [
          {
            id: 'client',
            label: 'Client',
            cell: (r: EsignRequestRow) => (
              <span className="font-medium text-text">{r.client?.displayName ?? '–'}</span>
            ),
          },
        ]),
    { id: 'status', label: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    { id: 'sent', label: 'Sent Date', cell: (r) => shortDate(r.sentAt) },
    {
      id: 'activity',
      label: 'Last Activity',
      // A draft or one waiting for approval has no activity since it was sent.
      cell: (r) => (r.sentAt ? shortDate(r.lastActivityAt) : '–'),
    },
    {
      id: 'actions',
      label: 'Actions',
      cell: (r) => (
        <Link
          href={`/firm-sign/requests/${r.id}`}
          aria-label={`Open ${r.title}`}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-heading hover:bg-brand-50"
        >
          <Ellipsis aria-hidden className="size-5" />
        </Link>
      ),
    },
  ];

  const page = cursors.length - 1;
  const next = list.data?.nextCursor ?? null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <Input
          label="Search documents"
          type="search"
          value={q}
          // The API's search takes 100 characters.
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          label="Status"
          disabled={!!quickFilter}
          value={quickFilter ? '' : filters.status}
          onChange={(e) => change({ status: e.target.value as RequestsFilters['status'] })}
          options={[
            { value: '', label: 'All Statuses' },
            ...STATUSES.map((s) => ({ value: s, label: ESIGN_STATUS_LABELS[s] })),
          ]}
        />
        {!clientId && (
          <ClientFilter value={filters.clientId} onChange={(id) => change({ clientId: id })} />
        )}
        <Select
          label="Last activity"
          value={filters.range}
          onChange={(e) => change({ range: e.target.value })}
          options={RANGES}
        />
      </div>
      {list.isError && !list.data ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(list.error)}
        </p>
      ) : (
        <Table
          caption={caption}
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          loading={list.isPending}
          pageSize={limit}
          emptyTitle="No signature requests"
          emptyText="Nothing matches these filters."
          // Pages come from the API (cursors); the columns don't sort.
          server={{
            page: page + 1,
            // Not while the next page loads: a second click would skip it.
            hasNext: !!next && !list.isPlaceholderData,
            hasPrevious: page > 0,
            onNext: () => next && setCursors((c) => [...c, next]),
            onPrevious: () => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)),
            onSort: () => undefined,
          }}
        />
      )}
    </div>
  );
}

/**
 * "All Clients" or one client: the first 100 clients the caller may see. A firm with more finds
 * the others with the search box, which also matches the client.
 */
function ClientFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const clients = useApiQuery(['clients', 'list', 'esign-filter'], () =>
    api.clients.list({ limit: 100 }),
  );
  return (
    <Select
      label="Client"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[
        { value: '', label: 'All Clients' },
        ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.displayName })),
      ]}
    />
  );
}
