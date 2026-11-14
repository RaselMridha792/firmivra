'use client';

import { DOCUMENT_ERRORS, type ClientListItem, type FirmDocument } from '@firmivra/types';
import { Card, Table, type Column, type TableSort } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { DocumentActionDialog, DocumentRowMenu, type RowAction } from './document-row-actions';
import { DocumentStatusBadge } from './document-status-badge';
import { FileIcon } from './file-icon';

function sizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function dateText(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * The library table, for the one selected client. Row actions (Clients C2-051, V-005): Download,
 * Share, Rename, Move, Request e-sign and Archive, in a menu that opens outside the table. The
 * columns keep readable widths and the table scrolls sideways inside its region (V-004).
 */
export function DocumentsTable({
  rows,
  client,
  sort,
  onSort,
  selected,
  onToggleSelect,
  onToggleSelectAll,
}: {
  rows: FirmDocument[];
  client: ClientListItem;
  sort?: TableSort;
  onSort: (sort: TableSort) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
}) {
  const [pending, setPending] = useState<{ action: RowAction; row: FirmDocument } | null>(null);
  const [done, setDone] = useState<string>();
  const download = useApiMutation(async (id: string) => {
    const link = await api.documents.download(id);
    window.location.assign(link.url);
  });
  const menu = (row: FirmDocument) => (
    <DocumentRowMenu
      row={row}
      client={client}
      onDownload={(id) => download.mutate(id)}
      onAction={(action, r) => {
        setDone(undefined);
        setPending({ action, row: r });
      }}
    />
  );
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const columns: Column<FirmDocument>[] = [
    {
      id: 'select',
      label: '',
      className: 'w-10',
      cell: (row) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.fileName}`}
          checked={selected.has(row.id)}
          onChange={() => onToggleSelect(row.id)}
          data-testid="document-select"
          className="size-5 rounded border-control-border"
        />
      ),
    },
    {
      id: 'name',
      label: 'Name',
      sortable: true,
      className: 'w-72',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          <FileIcon contentType={row.contentType} />
          <span className="min-w-0">
            <Link
              href={`/documents/${row.id}`}
              className="block truncate font-semibold text-heading hover:text-action hover:underline"
              data-testid="document-name"
              title={row.fileName}
            >
              {row.fileName}
            </Link>
            <span className="block text-xs text-muted">{sizeText(row.sizeBytes)}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'client',
      label: 'Client / Folder',
      className: 'w-44',
      cell: () => <span className="text-text">{client.displayName}</span>,
    },
    {
      id: 'type',
      label: 'Type',
      className: 'w-40',
      cell: (row) => <span className="text-text">{row.category?.name ?? 'Uncategorized'}</span>,
    },
    {
      id: 'date',
      label: 'Date Uploaded',
      className: 'w-36',
      cell: (row) => (
        <time dateTime={row.createdAt} className="text-text">
          {dateText(row.createdAt)}
        </time>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      className: 'w-32',
      cell: (row) => <DocumentStatusBadge status={row.scanStatus} />,
    },
    {
      id: 'actions',
      label: 'Actions',
      className: 'w-20 text-right',
      cell: (row) => menu(row),
    },
  ];
  // Column.label is typed as a string, but Table only ever renders it as JSX ({column.label}), so
  // a ReactNode works identically at runtime. packages/ui/table.tsx is Rasel's; widening its type
  // is outside this ticket, so the header's select-all checkbox is cast through, not built around.
  const withHeaderCheckbox = columns.map((column) =>
    column.id === 'select'
      ? {
          ...column,
          label: (
            <input
              type="checkbox"
              aria-label="Select all documents on this page"
              checked={allSelected}
              onChange={(event) => onToggleSelectAll(event.target.checked)}
              data-testid="document-select-all"
              className="size-5 rounded border-control-border"
            />
          ) as unknown as string,
        }
      : column,
  );

  return (
    <div data-testid="documents-table">
      {done ? (
        <p role="status" className="mb-3 text-sm text-success" data-testid="document-action-done">
          {done}
        </p>
      ) : null}
      {download.error ? (
        <p role="alert" className="mb-3 text-sm text-danger" data-testid="document-download-error">
          {errorMessage(download.error, DOCUMENT_ERRORS)}
        </p>
      ) : null}
      <div className="hidden md:block">
        <Table
          rows={rows}
          columns={withHeaderCheckbox}
          rowKey={(row) => row.id}
          caption="Documents"
          showPagination={false}
          tableClassName="table-fixed min-w-[60rem]"
          dense
          server={{
            page: 1,
            hasNext: false,
            hasPrevious: false,
            onNext: () => {},
            onPrevious: () => {},
            sort,
            onSort,
          }}
        />
      </div>
      <div className="flex flex-col gap-3 md:hidden" data-testid="documents-mobile-cards">
        {rows.map((row) => (
          <Card key={row.id} className="min-w-0 space-y-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label={`Select ${row.fileName}`}
                checked={selected.has(row.id)}
                onChange={() => onToggleSelect(row.id)}
                className="mt-1 size-5 shrink-0 rounded border-control-border"
              />
              <FileIcon contentType={row.contentType} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/documents/${row.id}`}
                  className="block truncate font-semibold text-heading hover:underline"
                  title={row.fileName}
                >
                  {row.fileName}
                </Link>
                <p className="text-xs text-muted">{sizeText(row.sizeBytes)}</p>
              </div>
              {menu(row)}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted">Client / Folder</dt>
                <dd className="text-text">{client.displayName}</dd>
              </div>
              <div>
                <dt className="text-muted">Type</dt>
                <dd className="text-text">{row.category?.name ?? 'Uncategorized'}</dd>
              </div>
              <div>
                <dt className="text-muted">Date Uploaded</dt>
                <dd>
                  <time dateTime={row.createdAt} className="text-text">
                    {dateText(row.createdAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt className="text-muted">Status</dt>
                <dd>
                  <DocumentStatusBadge status={row.scanStatus} />
                </dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>
      {pending ? (
        <DocumentActionDialog
          action={pending.action}
          row={pending.row}
          onClose={() => setPending(null)}
          onDone={(message) => {
            setPending(null);
            setDone(message);
          }}
        />
      ) : null}
    </div>
  );
}
