'use client';

import { DOCUMENT_ERRORS, type FirmDocument } from '@firmivra/types';
import { Button, Card, Table, type Column, type TableServerControl } from '@firmivra/ui';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { StatusPill } from './status-pill';
const date = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const columns: Column<FirmDocument>[] = [
  {
    id: 'name',
    label: 'Name',
    cell: (row) => (
      <span
        className="block min-w-0 wrap-anywhere"
        data-testid="document-name"
        title={row.fileName}
      >
        {row.fileName}
      </span>
    ),
  },
  {
    id: 'category',
    label: 'Category',
    cell: (row) => (
      <span className="block min-w-0 truncate" title={row.category?.name ?? 'Uncategorized'}>
        {row.category?.name ?? 'Uncategorized'}
      </span>
    ),
  },
  {
    id: 'year',
    label: 'Year',
    cell: (row) => <span>{row.taxYear ?? 'â€”'}</span>,
  },
  { id: 'status', label: 'Status', cell: (row) => <StatusPill status={row.scanStatus} /> },
  {
    id: 'date',
    label: 'Date',
    cell: (row) => (
      <time className="block" dateTime={row.createdAt}>
        {date.format(new Date(row.createdAt))}
      </time>
    ),
  },
];

type Pagination = Omit<TableServerControl, 'sort' | 'onSort'>;

export function DocumentList({
  rows,
  pagination,
}: {
  rows: FirmDocument[];
  pagination: Pagination;
}) {
  const download = useApiMutation(async (id: string) => {
    const link = await api.documents.download(id);
    window.location.assign(link.url);
  });
  const actions: Column<FirmDocument> = {
    id: 'download',
    label: 'Download',
    cell: (row) => (
      <Button
        variant="secondary"
        className="w-full min-w-0 px-1 text-xs whitespace-nowrap lg:px-2"
        data-testid="document-download"
        aria-label={`Download ${row.fileName}`}
        disabled={row.scanStatus !== 'CLEAN' || download.isPending}
        onClick={() => download.mutate(row.id)}
      >
        Download
      </Button>
    ),
  };
  return (
    <div className="min-w-0 max-w-full space-y-4" data-testid="client-documents-list">
      {download.error ? (
        <p role="alert" className="mb-3 text-sm text-danger" data-testid="document-download-error">
          {errorMessage(download.error, DOCUMENT_ERRORS)}
        </p>
      ) : null}
      <div className="min-w-0 space-y-4 md:hidden" data-testid="documents-mobile-cards">
        {rows.map((row) => (
          <Card key={row.id} className="min-w-0 space-y-3" data-testid="document-card">
            <h2 className="font-bold text-heading wrap-anywhere" data-testid="document-name">
              {row.fileName}
            </h2>
            <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
              <div className="min-w-0">
                <dt className="text-muted">Category</dt>
                <dd className="text-text wrap-anywhere">{row.category?.name ?? 'Uncategorized'}</dd>
              </div>
              <div>
                <dt className="text-muted">Year</dt>
                <dd className="text-text">{row.taxYear ?? 'â€”'}</dd>
              </div>
            </dl>
            <StatusPill status={row.scanStatus} />
            <p className="text-sm text-muted">
              Date: <time dateTime={row.createdAt}>{date.format(new Date(row.createdAt))}</time>
            </p>
            <Button
              variant="secondary"
              className="w-full"
              data-testid="document-download"
              aria-label={`Download ${row.fileName}`}
              disabled={row.scanStatus !== 'CLEAN' || download.isPending}
              onClick={() => download.mutate(row.id)}
            >
              Download
            </Button>
          </Card>
        ))}
      </div>
      <div className="hidden min-w-0 max-w-full md:block" data-testid="documents-table-scroll">
        <div
          className="min-w-0 [&>div>div:last-child]:hidden [&_table]:table-fixed [&_td]:px-1 [&_th]:px-1 [&_th:nth-child(2)]:w-16 [&_th:nth-child(3)]:w-10 [&_th:nth-child(4)]:w-28 [&_th:nth-child(5)]:w-16 [&_th:nth-child(6)]:w-20 lg:[&_td]:px-2 lg:[&_th]:px-2 lg:[&_th:nth-child(2)]:w-40 lg:[&_th:nth-child(3)]:w-16 lg:[&_th:nth-child(4)]:w-36 lg:[&_th:nth-child(5)]:w-28 lg:[&_th:nth-child(6)]:w-28"
          data-testid="client-documents-table"
        >
          <Table
            rows={rows}
            columns={[...columns, actions]}
            rowKey={(row) => row.id}
            caption="Client documents"
            server={{ ...pagination, onSort: () => {} }}
          />
        </div>
      </div>
      <nav aria-label="Document pages" className="space-y-2" data-testid="documents-pagination">
        <p className="text-sm text-muted" aria-live="polite">
          Page {pagination.page}
        </p>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <Button
            variant="secondary"
            data-testid="documents-previous"
            disabled={!pagination.hasPrevious}
            onClick={pagination.onPrevious}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            data-testid="documents-next"
            disabled={!pagination.hasNext}
            onClick={pagination.onNext}
          >
            Next
          </Button>
        </div>
      </nav>
    </div>
  );
}
