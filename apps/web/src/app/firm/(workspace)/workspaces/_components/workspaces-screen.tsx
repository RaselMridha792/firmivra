'use client';
import { EngagementStatus, WorkspaceKind, type WorkspaceListItem } from '@firmivra/types';
import { Badge, Button, Card, Input, Select, Table, type Column } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
export function WorkspacesScreen() {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = useApiQuery(['workspaces', kind, status, search, cursors.at(-1)], () =>
    api.workspaces.list({
      kind: kind ? WorkspaceKind.parse(kind) : undefined,
      status: EngagementStatus.parse(status),
      search: search || undefined,
      cursor: cursors.at(-1),
    }),
  );
  const link = (row: WorkspaceListItem) => (
    <Link
      className="font-semibold text-brand-700 underline wrap-anywhere"
      href={`/workspaces/${row.engagementId}`}
    >
      {row.title}
    </Link>
  );
  const columns: Column<WorkspaceListItem>[] = [
    { id: 'title', label: 'Workspace', cell: link },
    { id: 'client', label: 'Client', cell: (row) => row.client.displayName },
    { id: 'status', label: 'Status', cell: (row) => <Badge>{row.status}</Badge> },
    { id: 'stage', label: 'Stage', cell: (row) => row.stage ?? '—' },
    { id: 'tasks', label: 'Open tasks', cell: (row) => row.openTasks },
    { id: 'due', label: 'Next due date', cell: (row) => row.nextDueOn ?? '—' },
  ];
  return (
    <div className="min-w-0 space-y-4" data-testid="workspaces-screen">
      <h1 className="text-2xl font-semibold text-heading" data-testid="page-title">
        Workspaces
      </h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Search workspaces"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCursors([undefined]);
          }}
        />
        <Select
          label="Service"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setCursors([undefined]);
          }}
          options={[
            { value: '', label: 'All services' },
            { value: 'BOOKKEEPING', label: 'Bookkeeping' },
            { value: 'TAX_PLANNING', label: 'Tax Planning' },
          ]}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursors([undefined]);
          }}
          options={EngagementStatus.options.map((value) => ({
            value,
            label: value.charAt(0) + value.slice(1).toLowerCase(),
          }))}
        />
      </div>
      <PageState
        query={query}
        empty="No workspaces match these filters."
        isEmpty={(data) => data.items.length === 0}
      >
        {(data) => (
          <>
            <div className="space-y-4 md:hidden" data-testid="workspace-cards">
              {data.items.map((row) => (
                <Card key={row.engagementId} className="space-y-3">
                  {link(row)}
                  <p>{row.client.displayName}</p>
                  <Badge>{row.status}</Badge>
                  <p className="text-sm text-muted">Stage: {row.stage ?? '—'}</p>
                  <p className="text-sm text-muted">
                    Open tasks: {row.openTasks} · Next due: {row.nextDueOn ?? '—'}
                  </p>
                </Card>
              ))}
            </div>
            <div
              className="hidden md:block [&_table]:table-fixed [&_td]:wrap-anywhere [&_td]:px-2 [&_th]:px-2"
              data-testid="workspace-table"
            >
              <Table
                rows={data.items}
                columns={columns}
                rowKey={(row) => row.engagementId}
                caption="Workspaces"
                server={{
                  page: cursors.length,
                  hasPrevious: cursors.length > 1,
                  hasNext: !!data.nextCursor,
                  onPrevious: () => setCursors((v) => v.slice(0, -1)),
                  onNext: () => {
                    if (data.nextCursor) setCursors((v) => [...v, data.nextCursor!]);
                  },
                  onSort: () => {},
                }}
              />
            </div>
            <nav aria-label="Workspace pages" className="grid grid-cols-2 gap-3 md:hidden">
              <Button
                variant="secondary"
                disabled={cursors.length === 1}
                onClick={() => setCursors((v) => v.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={!data.nextCursor}
                onClick={() => {
                  if (data.nextCursor) setCursors((v) => [...v, data.nextCursor!]);
                }}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </PageState>
    </div>
  );
}
