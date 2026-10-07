'use client';

import { useState } from 'react';
import { Button, Card, Input, Select, Table } from '@firmivra/ui';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { PageState } from '../../../../../components/page-state';
import { useFirm } from '../../../../../components/firm-context';
import { DetailCard, PageHeading, Status } from '../../../../../features/screen-kit';

/** Uses R10's published functions. No fixture is substituted when the real API is unavailable. */
export function ClientScreens({ id }: { id?: string }) {
  return id ? <ClientRecord id={id} /> : <ClientList />;
}
function ClientList() {
  const { firm } = useFirm();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [cursors, setCursors] = useState<string[]>(['']);
  const cursor = cursors[cursors.length - 1] ?? '';
  const query = useApiQuery(['clients', firm.id, search, status, cursor], () =>
    api.clients.list({ search, status, cursor: cursor || undefined, limit: 25 }),
  );
  return (
    <>
      <PageHeading
        title="Clients"
        description="Find and manage your firm’s individual and business clients."
      />
      <Card>
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Input
            label="Search clients"
            type="search"
            maxLength={100}
            placeholder="Name, email or phone"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCursors(['']);
            }}
          />
          <Select
            label="Client status"
            value={status}
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'active' || value === 'archived' || value === 'all') {
                setStatus(value);
                setCursors(['']);
              }
            }}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'All statuses' },
            ]}
          />
        </div>
        <PageState
          query={query}
          empty="No clients match your search"
          isEmpty={(data) => data.items.length === 0}
        >
          {(data) => (
            <Table
              key={`${search}:${status}:${cursor}`}
              caption="Clients"
              rows={data.items}
              rowKey={(row) => row.id}
              columns={[
                {
                  id: 'name',
                  label: 'Client',
                  cell: (row) => (
                    <a className="text-link underline" href={`/clients/${row.id}`}>
                      {row.displayName}
                    </a>
                  ),
                  sortValue: (row) => row.displayName,
                },
                { id: 'email', label: 'Email', cell: (row) => row.email ?? '—' },
                { id: 'type', label: 'Type', cell: (row) => row.accountType },
                {
                  id: 'assigned',
                  label: 'Assigned to',
                  cell: (row) => row.assignedTo?.name ?? 'Unassigned',
                },
                {
                  id: 'status',
                  label: 'Status',
                  cell: (row) => (
                    <Status
                      value={row.archivedAt ? 'Archived' : (row.portalStatus ?? 'No portal login')}
                    />
                  ),
                },
              ]}
            />
          )}
        </PageState>
        <div className="mt-4 flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={cursors.length === 1 || query.isFetching}
            onClick={() => setCursors((values) => values.slice(0, -1))}
          >
            Previous results
          </Button>
          <Button
            variant="secondary"
            disabled={!query.data?.nextCursor || query.isFetching}
            onClick={() => {
              const next = query.data?.nextCursor;
              if (next) setCursors((values) => [...values, next]);
            }}
          >
            Next results
          </Button>
        </div>
      </Card>
    </>
  );
}
function ClientRecord({ id }: { id: string }) {
  const { firm } = useFirm();
  const query = useApiQuery(['clients', firm.id, id], () => api.clients.get(id));
  return (
    <PageState query={query}>
      {(record) => (
        <>
          <PageHeading
            title={record.displayName}
            description="Contact, profile and tax-year information for this client."
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <DetailCard
              title="Contact information"
              values={{
                Name: record.displayName,
                Email: record.email ?? '—',
                Phone: record.phone ?? '—',
                'Client type': record.accountType,
                'Assigned to': record.assignedTo?.name ?? 'Unassigned',
                'Portal status': record.portalStatus ?? 'No portal login',
              }}
            />
            <DetailCard
              title="Profile"
              values={{
                'Legal business name': record.profile.businessName ?? '—',
                'Entity type': record.profile.entityType ?? '—',
                SSN: record.profile.ssnLast4 ? `***-**-${record.profile.ssnLast4}` : 'Not provided',
                EIN: record.profile.einLast4 ? `**-***${record.profile.einLast4}` : 'Not provided',
                Address: [
                  record.profile.address.line1,
                  record.profile.address.line2,
                  record.profile.address.city,
                  record.profile.address.state,
                  record.profile.address.postalCode,
                  record.profile.address.country,
                ]
                  .filter(Boolean)
                  .join(', '),
                'Preferred contact': record.profile.preferredContactMethod ?? '—',
                'Additional information': record.profile.additionalInfo ?? '—',
              }}
            />
          </div>
          <TaxYears id={record.id} />
        </>
      )}
    </PageState>
  );
}
function TaxYears({ id }: { id: string }) {
  const { firm } = useFirm();
  const query = useApiQuery(['client-tax-years', firm.id, id], () => api.clients.taxYears(id));
  return (
    <Card title="Tax years">
      <PageState query={query} empty="No tax years recorded">
        {(rows) => (
          <Table
            caption="Client tax years"
            rows={rows}
            rowKey={(row) => String(row.taxYear)}
            columns={[
              { id: 'year', label: 'Tax year', cell: (row) => row.taxYear },
              { id: 'status', label: 'Status', cell: (row) => <Status value={row.status.name} /> },
              { id: 'note', label: 'Client note', cell: (row) => row.clientNote ?? '—' },
              { id: 'updated', label: 'Changed by', cell: (row) => row.updatedBy?.name ?? '—' },
            ]}
          />
        )}
      </PageState>
    </Card>
  );
}
