'use client';
import { INVOICE_ERRORS, InvoiceStatus, type InvoiceListItem } from '@firmivra/types';
import { Badge, Button, Card, Select, Table, type Column } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { RequireRole } from '../../../../../components/require-role';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
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
    <Badge tone={row.status === 'PAID' ? 'success' : row.status === 'OPEN' ? 'warning' : 'info'}>
      {labels[row.status]}
    </Badge>
  </span>
);
export function InvoicesScreen({ clientId }: { clientId?: string }) {
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
        <Button
          variant="secondary"
          className="w-full"
          data-testid="invoice-send"
          disabled={send.isPending}
          aria-label={`Send ${row.number}`}
          onClick={() => send.mutate(row.id)}
        >
          Send
        </Button>
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
    { id: 'due', label: 'Due date', cell: (row) => row.dueOn ?? '—' },
    { id: 'amount', label: 'Amount', cell: amount },
    { id: 'status', label: 'Status', cell: statusBadge },
    { id: 'actions', label: 'Actions', cell: action },
  ];
  return (
    <div className="min-w-0 space-y-4" data-testid="invoices-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-heading" data-testid="page-title">
          {clientId ? 'Client invoices' : 'Invoices'}
        </h1>
        {clientId ? (
          <RequireRole roles={['OWNER', 'ADMIN']}>
            <Button onClick={() => setCreating(true)} data-testid="invoice-new">
              New invoice
            </Button>
          </RequireRole>
        ) : null}
      </div>
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
                  <p className="text-sm text-muted">Due date: {row.dueOn ?? '—'}</p>
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
      {creating && clientId ? (
        <InvoiceForm clientId={clientId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}
