'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Select,
  Table,
  Tabs,
  Textarea,
  Input,
} from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import { DataNotice, PageHeading, RecordLink, Status, UnavailableAction } from './screen-kit';

const engagements = [
  {
    id: 'sample-bookkeeping',
    client: 'Example Studio LLC',
    service: 'Bookkeeping',
    status: 'In progress',
  },
  {
    id: 'sample-planning',
    client: 'Alex Morgan',
    service: 'Tax Planning',
    status: 'Awaiting documents',
  },
];
export function Services({ id }: { id?: string }) {
  const { preview } = useWorkspace();
  const [tab, setTab] = useState('tasks');
  const [done, setDone] = useState(false);
  const [note, setNote] = useState('');
  const engagement = preview ? engagements.find((r) => r.id === id) : undefined;
  if (!id)
    return (
      <>
        <PageHeading
          title="Service workspaces"
          description="Manage active bookkeeping and tax planning engagements."
        />
        <DataNotice />
        <Card>
          <Table
            caption="Service engagements"
            rows={preview ? engagements : []}
            rowKey={(r) => r.id}
            columns={[
              { id: 'client', label: 'Client', cell: (r) => r.client },
              {
                id: 'service',
                label: 'Service',
                cell: (r) => <RecordLink href={`/workspaces/${r.id}`}>{r.service}</RecordLink>,
              },
              { id: 'status', label: 'Status', cell: (r) => <Status value={r.status} /> },
            ]}
            emptyTitle="No service engagements loaded"
          />
        </Card>
      </>
    );
  return (
    <>
      <PageHeading
        title={engagement ? `${engagement.service} workspace` : 'Service workspace'}
        description={engagement?.client ?? 'Review tasks, documents, reports and internal notes.'}
        action={
          <UnavailableAction label="Change status">
            <Select
              label="Engagement status"
              options={['In progress', 'Awaiting documents', 'Under review', 'Completed'].map(
                (value) => ({ value, label: value }),
              )}
            />
          </UnavailableAction>
        }
      />
      <RecordLink href="/services">← Back to services</RecordLink>
      <DataNotice />
      {engagement ? (
        <>
          <Status value={engagement.status} />
          <Tabs
            label="Workspace sections"
            value={tab}
            onChange={setTab}
            items={[
              {
                id: 'tasks',
                label: 'Tasks',
                content: (
                  <Card title="Tasks">
                    <Checkbox
                      label="Review sample uploaded documents"
                      checked={done}
                      onChange={(e) => setDone(e.target.checked)}
                    />
                    <p className="mt-4 text-xs text-muted">
                      Preview interaction only. Task changes are not saved.
                    </p>
                  </Card>
                ),
              },
              {
                id: 'documents',
                label: 'Documents',
                content: (
                  <EmptyState
                    title="No documents loaded"
                    description="Engagement documents will appear here."
                  />
                ),
              },
              {
                id: 'notes',
                label: 'Internal notes',
                content: (
                  <Card title="Staff notes">
                    <Textarea
                      label="Internal note (staff only)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={4000}
                    />
                    <Button disabled className="mt-4">
                      Save note
                    </Button>
                  </Card>
                ),
              },
              {
                id: 'reports',
                label: 'Reports',
                content: (
                  <Card title="Reports">
                    <Input label="Upload report" type="file" />
                    <Button disabled className="mt-4">
                      Upload report
                    </Button>
                  </Card>
                ),
              },
              {
                id: 'service',
                label: engagement.service === 'Bookkeeping' ? 'Reconciliation' : 'Projections',
                content: (
                  <Card
                    title={
                      engagement.service === 'Bookkeeping' ? 'Reconciliation' : 'Tax projections'
                    }
                  >
                    <EmptyState
                      title="No data loaded"
                      description="Service details will appear here when available."
                    />
                  </Card>
                ),
              },
            ]}
          />
        </>
      ) : (
        <EmptyState
          title="Workspace unavailable"
          description="This engagement could not be loaded."
        />
      )}
    </>
  );
}
