'use client';
import { useState } from 'react';
import { Card, EmptyState, Input, Select, Table, Textarea } from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import {
  DataNotice,
  DetailCard,
  PageHeading,
  RecordLink,
  Status,
  UnavailableAction,
} from './screen-kit';
export function Leads({ id }: { id?: string }) {
  const { preview } = useWorkspace();
  const [search, setSearch] = useState('');
  const rows = preview
    ? [
        {
          id: 'sample-lead',
          name: 'Example Studio LLC',
          email: 'studio@example.test',
          service: 'Bookkeeping',
          status: 'Submitted',
        },
      ].filter((r) => `${r.name} ${r.service}`.toLowerCase().includes(search.toLowerCase()))
    : [];
  if (id)
    return (
      <>
        <PageHeading
          title="Lead review"
          description="Review submitted intake answers before converting this lead."
        />
        <RecordLink href="/leads">← Back to leads</RecordLink>
        <DataNotice />
        {preview && id === 'sample-lead' ? (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <DetailCard
                title="Lead"
                values={{
                  Name: 'Example Studio LLC',
                  Email: 'studio@example.test',
                  Service: 'Bookkeeping',
                  EIN: '**-***0142',
                }}
              />
              <DetailCard
                title="Intake answers"
                values={{
                  Industry: 'Professional services',
                  'Accounting software': 'Not selected',
                  'Service requested': 'Monthly bookkeeping',
                }}
              />
            </div>
            <Card title="Convert to client">
              <p className="mb-4 text-sm text-muted">
                Check for an existing client before creating a new one.
              </p>
              <UnavailableAction label="Convert to client">
                <Select
                  label="Client match"
                  options={[
                    { value: '', label: 'Create a new client' },
                    { value: 'sample-studio', label: 'Example Studio LLC (possible match)' },
                  ]}
                />
                <Textarea label="Conversion note" maxLength={1000} />
              </UnavailableAction>
            </Card>
          </>
        ) : (
          <EmptyState title="Lead unavailable" description="This lead could not be loaded." />
        )}
      </>
    );
  return (
    <>
      <PageHeading
        title="Leads inbox"
        description="Begin Online submissions ready for your team to review."
      />
      <DataNotice />
      <Card>
        <div className="mb-6">
          <Input
            label="Search leads"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Table
          key={search}
          caption="Leads"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            {
              id: 'name',
              label: 'Name',
              cell: (r) => <RecordLink href={`/leads/${r.id}`}>{r.name}</RecordLink>,
              sortValue: (r) => r.name,
            },
            { id: 'email', label: 'Email', cell: (r) => r.email },
            { id: 'service', label: 'Service', cell: (r) => r.service },
            { id: 'status', label: 'Status', cell: (r) => <Status value={r.status} /> },
          ]}
          emptyTitle="No leads loaded"
        />
      </Card>
    </>
  );
}
