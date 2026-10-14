'use client';

import { DOCUMENT_ERRORS, type ClientListItem, type FirmDocument } from '@firmivra/types';
import { Card, Table, type Column, type TableSort } from '@firmivra/ui';
import { DotsThreeVertical } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
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

type Download = ReturnType<typeof useApiMutation<string, void>>;

/**
 * The row actions, shared by the table (desktop) and the card list (mobile, below 768px: the
 * design is a wide table, but a fixed-column table never reflows at 390px — apps/web/src/app/firm
 * /(workspace)/clients/[id]/documents already solves this the same way, cards under md:hidden).
 */
function ActionsMenu({
  row,
  open,
  onToggle,
  download,
}: {
  row: FirmDocument;
  open: boolean;
  onToggle: () => void;
  download: Download;
}) {
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${row.fileName}`}
        data-testid="document-actions"
        onClick={onToggle}
        className="inline-flex size-9 items-center justify-center rounded-control border border-border text-text hover:bg-canvas"
      >
        <DotsThreeVertical weight="bold" className="size-5" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-10 mt-1 w-56 rounded-md border border-border bg-surface py-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            disabled={row.scanStatus !== 'CLEAN' || download.isPending}
            data-testid="document-download"
            onClick={() => download.mutate(row.id)}
            className="block w-full px-3 py-2 text-left text-sm text-text hover:bg-canvas disabled:text-muted"
          >
            Download
          </button>
          {['Rename', 'Move', 'Share', 'Request e-sign', 'Archive'].map((label) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled
              title="Not built yet"
              className="block w-full px-3 py-2 text-left text-sm text-muted"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/**
 * The library table, for the one selected client (the API has no firm-wide list: R34 PR). Row
 * actions: Download is real (the same route every document screen uses). The rest — Rename, Move,
 * Share, E-sign, Review, Archive — have no endpoint yet, so the menu names them as not available
 * rather than inventing a working control (R34 PR).
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
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const toggleMenu = (id: string) => setOpenMenu((prev) => (prev === id ? null : id));
  const download = useApiMutation(async (id: string) => {
    setOpenMenu(null);
    const link = await api.documents.download(id);
    window.location.assign(link.url);
  });
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
      className: 'min-w-56',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-3">
          <FileIcon contentType={row.contentType} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-heading" data-testid="document-name">
              {row.fileName}
            </span>
            <span className="block text-xs text-muted">{sizeText(row.sizeBytes)}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'client',
      label: 'Client / Folder',
      cell: () => <span className="text-text">{client.displayName}</span>,
    },
    {
      id: 'type',
      label: 'Type',
      cell: (row) => <span className="text-text">{row.category?.name ?? 'Uncategorized'}</span>,
    },
    {
      id: 'date',
      label: 'Date Uploaded',
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
      cell: (row) => <DocumentStatusBadge status={row.scanStatus} />,
    },
    {
      id: 'actions',
      label: 'Actions',
      className: 'w-16 text-right',
      cell: (row) => (
        <ActionsMenu
          row={row}
          open={openMenu === row.id}
          onToggle={() => toggleMenu(row.id)}
          download={download}
        />
      ),
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
          tableClassName="table-fixed"
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
                <p className="truncate font-semibold text-heading">{row.fileName}</p>
                <p className="text-xs text-muted">{sizeText(row.sizeBytes)}</p>
              </div>
              <ActionsMenu
                row={row}
                open={openMenu === row.id}
                onToggle={() => toggleMenu(row.id)}
                download={download}
              />
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
    </div>
  );
}
