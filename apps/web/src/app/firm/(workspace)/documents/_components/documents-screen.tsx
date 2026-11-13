'use client';

import type { FirmDocument } from '@firmivra/types';
import { Card, type TableSort } from '@firmivra/ui';
import { useMemo, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { DocumentRequestsCard } from './document-requests-card';
import { DocumentsFiltersBar } from './documents-filters-bar';
import { DocumentsHeader } from './documents-header';
import { DocumentsPagination } from './documents-pagination';
import { DocumentsStatCards } from './documents-stat-cards';
import { DocumentsTable } from './documents-table';
import { FoldersPanel } from './folders-panel';
import { QuickUploadCard } from './quick-upload-card';
import { RecentActivityCard } from './recent-activity-card';

function sortRows(rows: FirmDocument[], sort?: TableSort): FirmDocument[] {
  if (!sort) return rows;
  const sorted = [...rows].sort((a, b) =>
    sort.id === 'status'
      ? a.scanStatus.localeCompare(b.scanStatus)
      : a.fileName.localeCompare(b.fileName),
  );
  return sort.descending ? sorted.reverse() : sorted;
}

/**
 * The firm's Documents page (R34; the design in docs/mockups/firm-workspace/documents/). The API
 * has no firm-wide document list (apps/api/src/storage/documents.controller.ts lists one client's
 * documents at a time) — so the library needs a client chosen first, same data the client record's
 * own Documents tab already uses (clients/[id]/documents). Everything else is a quiet empty state
 * until its own module is built: the PR lists each one.
 */
export function DocumentsScreen() {
  const [clientId, setClientId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'' | FirmDocument['scanStatus']>('');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<TableSort>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const cursor = cursors[cursors.length - 1];

  const clients = useApiQuery(['documents', 'clients'], () => api.clients.list({ limit: 100 }));
  const categories = useApiQuery(['document-categories'], () => api.documents.categories());
  const documents = useApiQuery(
    ['documents', 'list', clientId, categoryId, search, cursor, pageSize],
    () =>
      api.documents.list(clientId, {
        categoryId: categoryId || undefined,
        search: search || undefined,
        cursor,
        limit: pageSize,
      }),
  );
  const client = clients.data?.items.find((c) => c.id === clientId);

  const filteredRows = useMemo(() => {
    const rows = documents.data?.items ?? [];
    const byStatus = status ? rows.filter((r) => r.scanStatus === status) : rows;
    return sortRows(byStatus, sort);
  }, [documents.data, status, sort]);

  const resetPaging = () => setCursors([undefined]);

  return (
    <div className="flex flex-col gap-4" data-testid="documents-screen">
      <DocumentsHeader />
      <DocumentsStatCards />
      {/* Clients V-003, V-004, V-009: slim side panels; the table gets the widest region. The
          right rail sits under it (three across) until the window is wide enough for it beside. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] 2xl:grid-cols-[13rem_minmax(0,1fr)_17rem]">
        <FoldersPanel
          categories={categories.data ?? []}
          selected={categoryId}
          onSelect={(id) => {
            setCategoryId(id);
            resetPaging();
          }}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-4 p-4">
            <DocumentsFiltersBar
              clients={clients.data?.items ?? []}
              clientId={clientId}
              onClientChange={(value) => {
                setClientId(value);
                setCategoryId('');
                setStatus('');
                setSelected(new Set());
                resetPaging();
              }}
              categories={categories.data ?? []}
              categoryId={categoryId}
              onCategoryChange={(value) => {
                setCategoryId(value);
                resetPaging();
              }}
              status={status}
              onStatusChange={setStatus}
              search={search}
              onSearchChange={(value) => {
                setSearch(value);
                resetPaging();
              }}
            />
            {!clientId ? (
              <p className="py-10 text-center text-sm text-muted" data-testid="documents-no-client">
                Select a client to view their documents.
              </p>
            ) : documents.isPending || !client ? (
              <p className="py-10 text-center text-sm text-muted">Loading documents…</p>
            ) : documents.isError ? (
              <p className="py-10 text-center text-sm text-danger" role="alert">
                Documents couldn&apos;t be loaded.
              </p>
            ) : (
              <>
                <DocumentsTable
                  rows={filteredRows}
                  client={client}
                  sort={sort}
                  onSort={setSort}
                  selected={selected}
                  onToggleSelect={(id) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                  onToggleSelectAll={(checked) =>
                    setSelected(checked ? new Set(filteredRows.map((r) => r.id)) : new Set())
                  }
                />
                <DocumentsPagination
                  count={filteredRows.length}
                  page={cursors.length}
                  hasPrevious={cursors.length > 1}
                  hasNext={documents.data.nextCursor !== null}
                  onPrevious={() => setCursors((prev) => prev.slice(0, -1))}
                  onNext={() => {
                    const next = documents.data.nextCursor;
                    if (next) setCursors((prev) => [...prev, next]);
                  }}
                  pageSize={pageSize}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    resetPaging();
                  }}
                />
              </>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2 lg:grid lg:grid-cols-3 lg:items-start 2xl:col-span-1 2xl:flex 2xl:flex-col">
          <QuickUploadCard />
          <DocumentRequestsCard />
          <RecentActivityCard />
        </div>
      </div>
    </div>
  );
}
