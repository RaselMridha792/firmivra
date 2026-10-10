'use client';
import { DOCUMENT_ERRORS, type FirmDocumentRequest } from '@firmivra/types';
import { Badge, Button, Card, Table, type Column } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { MarkMissingForm } from './mark-missing-form';
import { RequestDocumentForm } from './request-document-form';
const labels = {
  REQUESTED: 'Requested',
  SUBMITTED: 'Received',
  ACCEPTED: 'Accepted',
  REJECTED: 'Missing',
  NOT_AVAILABLE: 'Missing',
  CANCELLED: 'Cancelled',
};

function RequestStatus({ row }: { row: FirmDocumentRequest }) {
  return (
    <div className="space-y-2" data-testid="request-status">
      <Badge
        tone={
          row.status === 'ACCEPTED'
            ? 'success'
            : row.status === 'REJECTED' || row.status === 'NOT_AVAILABLE'
              ? 'warning'
              : 'info'
        }
      >
        {labels[row.status]}
      </Badge>
      {(row.status === 'REJECTED' || row.status === 'NOT_AVAILABLE') && row.statusNote ? (
        <p className="text-sm text-muted wrap-anywhere" data-testid="request-status-reason">
          {row.status === 'NOT_AVAILABLE' ? 'Client’s reason: ' : 'Firm’s reason: '}
          {row.statusNote}
        </p>
      ) : null}
    </div>
  );
}

export function RequestList({ clientId }: { clientId: string }) {
  const requests = useApiQuery(['document-requests', clientId], () =>
    api.documents.requests(clientId),
  );
  const [creating, setCreating] = useState(false);
  const [missing, setMissing] = useState<string>();
  const accept = useApiMutation((id: string) => api.documents.acceptRequest(id), {
    invalidate: ['document-requests', clientId],
  });
  const actions = (row: FirmDocumentRequest) =>
    row.status === 'SUBMITTED' ? (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={accept.isPending}
          data-testid="request-accept"
          aria-label={`Accept ${row.title}`}
          onClick={() => accept.mutate(row.id)}
        >
          Accept
        </Button>
        <Button
          variant="secondary"
          disabled={accept.isPending}
          data-testid="request-mark-missing"
          aria-label={`Mark ${row.title} missing`}
          onClick={() => setMissing(row.id)}
        >
          Mark missing
        </Button>
      </div>
    ) : null;
  const columns: Column<FirmDocumentRequest>[] = [
    {
      id: 'title',
      label: 'Request',
      cell: (row) => (
        <span className="wrap-anywhere" data-testid="request-title">
          {row.title}
        </span>
      ),
    },
    {
      id: 'service',
      label: 'Service',
      cell: (row) => <span className="wrap-anywhere">{row.service.title}</span>,
    },
    { id: 'status', label: 'Status', cell: (row) => <RequestStatus row={row} /> },
    { id: 'due', label: 'Due date', cell: (row) => row.dueOn ?? '—' },
    { id: 'actions', label: 'Actions', cell: actions },
  ];
  return (
    <section className="min-w-0 space-y-4" data-testid="document-requests">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-heading">Document requests</h2>
        <Button onClick={() => setCreating(true)} data-testid="request-document-open">
          Request a document
        </Button>
      </div>
      {accept.error ? (
        <p role="alert" className="text-sm text-danger" data-testid="request-accept-error">
          {errorMessage(accept.error, DOCUMENT_ERRORS)}
        </p>
      ) : null}
      <PageState query={requests} empty="No document requests yet.">
        {(rows) => (
          <>
            <div className="space-y-4 md:hidden" data-testid="requests-mobile-cards">
              {rows.map((row) => (
                <Card key={row.id} className="min-w-0 space-y-3" data-testid="request-card">
                  <h3 className="font-bold text-heading wrap-anywhere">{row.title}</h3>
                  <p className="text-sm text-muted wrap-anywhere">{row.service.title}</p>
                  <RequestStatus row={row} />
                  <p className="text-sm text-muted">Due date: {row.dueOn ?? '—'}</p>
                  {actions(row)}
                </Card>
              ))}
            </div>
            <div
              className="hidden min-w-0 md:block [&_table]:table-fixed [&_td]:px-2 [&_th]:px-2"
              data-testid="requests-desktop-table"
            >
              <Table
                rows={rows}
                columns={columns}
                rowKey={(row) => row.id}
                caption="Document requests"
                pageSize={rows.length}
              />
            </div>
          </>
        )}
      </PageState>
      {creating ? (
        <RequestDocumentForm clientId={clientId} onClose={() => setCreating(false)} />
      ) : null}
      {missing ? (
        <MarkMissingForm
          clientId={clientId}
          requestId={missing}
          onClose={() => setMissing(undefined)}
        />
      ) : null}
    </section>
  );
}
