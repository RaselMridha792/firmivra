'use client';
import { INVOICE_ERRORS, InvoiceStatus, type InvoiceListItem } from '@firmivra/types';
import { Badge, Button, Card, Select, Table, type Column } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { RequireRole } from '../../../../../components/require-role';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { dateText } from '../../clients/_components/client-parts';
import { useClientRecord } from '../../clients/[id]/_components/use-client-record';
import { InvoiceCancelForm } from './invoice-cancel-form';
import { InvoiceForm } from './invoice-form';
const labels = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  OPEN: 'Open',
  PAID: 'Paid',
  CANCELED: 'Canceled',
};
const amount = (row: InvoiceListItem) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency }).format(
    row.totalCents / 100,
  );
const statusBadge = (row: InvoiceListItem) => (
  <span className="whitespace-nowrap">
    <Badge
      tone={
        row.status === 'PAID'
          ? 'success'
          : row.status === 'OPEN'
            ? 'warning'
            : row.status === 'CANCELED'
              ? 'neutral'
              : 'info'
      }
    >
      {labels[row.status]}
    </Badge>
  </span>
);
export function InvoicesScreen({ clientId }: { clientId?: string }) {
  const [canceling, setCanceling] = useState<InvoiceListItem>();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const query = useApiQuery(['invoices', clientId, status, cursor], () =>
    api.invoices.list({
      clientId,
      status: status ? InvoiceStatus.parse(status) : undefined,
      cursor,
    }),
  );
  const send = useApiMutation((id: string) => api.invoices.send(id), { invalidate: ['invoices'] });
  const next = (value: string | null) => {
    if (value) setCursors((previous) => [...previous, value]);
  };
  const previous = () => setCursors((items) => items.slice(0, -1));
  const action = (row: InvoiceListItem) =>
    row.status === 'DRAFT' ? (
      <RequireRole roles={['OWNER', 'ADMIN']}>
        <DraftActions
          row={row}
          pending={send.isPending}
          onSend={() => send.mutate(row.id)}
          onCancel={() => setCanceling(row)}
        />
      </RequireRole>
    ) : null;
  const columns: Column<InvoiceListItem>[] = [
    {
      id: 'number',
      label: 'Invoice #',
      cell: (row) => <span className="wrap-anywhere">{row.number}</span>,
    },
    {
      id: 'title',
      label: clientId ? 'Service' : 'Client / Service',
      cell: (row) => (
        <div className="wrap-anywhere">
          {!clientId ? <p className="font-medium">{row.client.displayName}</p> : null}
          {row.title}
        </div>
      ),
    },
    {
      id: 'due',
      label: 'Due date',
      cell: (row) => (row.dueOn ? dateText(`${row.dueOn}T12:00:00`) : '—'),
    },
    { id: 'amount', label: 'Amount', cell: amount },
    { id: 'status', label: 'Status', cell: statusBadge },
    { id: 'actions', label: 'Actions', cell: action },
  ];
  return (
    <div className="min-w-0 space-y-4" data-testid="invoices-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InvoiceHeading clientId={clientId} />
        {clientId ? (
          <RequireRole roles={['OWNER', 'ADMIN']}>
            <NewInvoiceButton clientId={clientId} onClick={() => setCreating(true)} />
          </RequireRole>
        ) : null}
      </div>
      <div className="max-w-xs">
        <Select
          label="Status"
          data-testid="invoice-status-filter"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setCursors([undefined]);
          }}
          options={[
            { value: '', label: 'All statuses' },
            ...InvoiceStatus.options.map((value) => ({ value, label: labels[value] })),
          ]}
        />
      </div>
      {send.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(send.error, INVOICE_ERRORS)}
        </p>
      ) : null}
      <PageState
        query={query}
        empty={status ? 'No invoices match this status.' : 'No invoices yet.'}
        isEmpty={(data) => data.items.length === 0}
      >
        {(data) => (
          <>
            {!data.paymentsEnabled ? (
              <p className="text-sm text-muted">
                Online payments are not enabled. You can still create and send invoices.
              </p>
            ) : null}
            <div className="space-y-4 md:hidden" data-testid="invoices-cards">
              {data.items.map((row) => (
                <Card key={row.id} className="min-w-0 space-y-3" data-testid="invoice-card">
                  <h2 className="font-bold text-heading">{row.number}</h2>
                  <p className="wrap-anywhere">
                    {!clientId ? `${row.client.displayName} · ` : ''}
                    {row.title}
                  </p>
                  <p className="text-sm text-muted">
                    Due date: {row.dueOn ? dateText(`${row.dueOn}T12:00:00`) : '—'}
                  </p>
                  <p className="font-semibold">{amount(row)}</p>
                  {statusBadge(row)}
                  {action(row)}
                </Card>
              ))}
            </div>
            <div
              className="hidden md:block [&_table]:table-fixed [&_td]:px-2 [&_td]:wrap-anywhere [&_th]:px-2"
              data-testid="invoices-table"
            >
              <Table
                rows={data.items}
                columns={columns}
                rowKey={(row) => row.id}
                caption="Invoices"
                server={{
                  page: cursors.length,
                  hasPrevious: cursors.length > 1,
                  hasNext: data.nextCursor !== null,
                  onPrevious: previous,
                  onNext: () => next(data.nextCursor),
                  onSort: () => {},
                }}
              />
            </div>
            <nav className="grid grid-cols-2 gap-3 md:hidden" aria-label="Invoice pages">
              <Button variant="secondary" disabled={cursors.length === 1} onClick={previous}>
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={!data.nextCursor}
                onClick={() => next(data.nextCursor)}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </PageState>
      {canceling ? (
        <InvoiceCancelForm invoice={canceling} onClose={() => setCanceling(undefined)} />
      ) : null}
      {creating && clientId ? (
        <InvoiceForm clientId={clientId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}

function InvoiceHeading({ clientId }: { clientId?: string }) {
  return clientId ? (
    <h2 className="text-2xl font-semibold text-heading">Client invoices</h2>
  ) : (
    <h1 className="text-2xl font-semibold text-heading" data-testid="page-title">
      Invoices
    </h1>
  );
}
function NewInvoiceButton({ clientId, onClick }: { clientId: string; onClick: () => void }) {
  const client = useClientRecord(clientId);
  return client.data && !client.data.archivedAt ? (
    <Button onClick={onClick} data-testid="invoice-new">
      New invoice
    </Button>
  ) : null;
}
function DraftActions({
  row,
  pending,
  onSend,
  onCancel,
}: {
  row: InvoiceListItem;
  pending: boolean;
  onSend: () => void;
  onCancel: () => void;
}) {
  const client = useClientRecord(row.client.id);
  return (
    <div className="flex flex-wrap gap-2">
      {client.data && !client.data.archivedAt ? (
        <Button
          variant="secondary"
          disabled={pending}
          aria-label={`Send ${row.number}`}
          data-testid="invoice-send"
          onClick={onSend}
        >
          Send
        </Button>
      ) : null}
      <Button
        variant="secondary"
        onClick={onCancel}
        aria-label={`Cancel ${row.number}`}
        data-testid="invoice-cancel"
      >
        Cancel
      </Button>
    </div>
  );
}
