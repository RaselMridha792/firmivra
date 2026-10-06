'use client';

import { useState } from 'react';
import { Card, EmptyState, Input, Select, Table, Tabs } from '@firmivra/ui';
import { OwnerOnly, useWorkspace } from '../components/workspace-context';
import {
  ContactFields,
  DataNotice,
  DetailCard,
  PageHeading,
  ReasonAction,
  RecordLink,
  Status,
  UnavailableAction,
} from './screen-kit';

const clients = [
  {
    id: 'sample-alex',
    name: 'Alex Morgan',
    email: 'alex@example.test',
    type: 'Individual',
    status: 'Active',
    tax: 'Awaiting documents',
  },
  {
    id: 'sample-studio',
    name: 'Example Studio LLC',
    email: 'studio@example.test',
    type: 'Business',
    status: 'Active',
    tax: 'Under review',
  },
  {
    id: 'sample-jamie',
    name: 'Jamie Lee',
    email: 'jamie@example.test',
    type: 'Individual',
    status: 'Active',
    tax: 'Completed',
  },
];
const members = [
  {
    id: 'sample-owner',
    name: 'Casey Taylor',
    email: 'casey@example.test',
    role: 'Owner',
    status: 'Active',
  },
  {
    id: 'sample-staff',
    name: 'Riley Jordan',
    email: 'riley@example.test',
    role: 'Staff',
    status: 'Active',
  },
  {
    id: 'sample-invite',
    name: 'Sam Parker',
    email: 'sam@example.test',
    role: 'Staff',
    status: 'Invited',
  },
];
const pending = [
  {
    id: 'sample-signup',
    name: 'Alex Morgan',
    email: 'alex@example.test',
    phone: '***-***-0142',
    type: 'Individual',
    verified: 'Email and phone verified',
    submitted: 'Sample submission',
    duplicate: 'Possible match',
  },
];

export function Clients({ id }: { id?: string }) {
  const { preview } = useWorkspace();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState('profile');
  const rows = preview
    ? clients.filter(
        (c) =>
          `${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()) &&
          (!filter || c.type === filter),
      )
    : [];
  const client = preview ? clients.find((c) => c.id === id) : undefined;
  if (id)
    return (
      <>
        <PageHeading
          title={client?.name ?? 'Client details'}
          description="Profile, documents, services and activity for this client."
        />
        <RecordLink href="/clients">← Back to clients</RecordLink>
        <DataNotice />
        {client ? (
          <Tabs
            label="Client sections"
            value={tab}
            onChange={setTab}
            items={[
              {
                id: 'profile',
                label: 'Profile',
                content: (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <DetailCard
                      title="Contact information"
                      values={{
                        Name: client.name,
                        Email: client.email,
                        'Client type': client.type,
                        SSN: '***-**-0142',
                        EIN: '**-***0142',
                        Status: client.status,
                      }}
                    />
                    <DetailCard
                      title="Tax status"
                      values={{
                        Status: client.tax,
                        'Last changed by': 'Sample staff member',
                        'Changed at': 'Preview example',
                      }}
                    />
                  </div>
                ),
              },
              ...['Documents', 'Services', 'Intake', 'Messages', 'Invoices', 'Activity'].map(
                (label) => ({
                  id: label.toLowerCase(),
                  label,
                  content: (
                    <EmptyState
                      title={`No ${label.toLowerCase()} loaded`}
                      description="Client records will appear here when available."
                    />
                  ),
                }),
              ),
            ]}
          />
        ) : (
          <EmptyState
            title="Client unavailable"
            description="We could not load this client. Return to the client list."
          />
        )}
      </>
    );
  return (
    <>
      <PageHeading
        title="Clients"
        description="Find and manage your firm’s individual and business clients."
        action={
          <UnavailableAction label="Add client">
            <ContactFields />
          </UnavailableAction>
        }
      />
      <DataNotice />
      <Card>
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Input
            label="Search clients"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email"
          />
          <Select
            label="Client type"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[
              { value: '', label: 'All types' },
              { value: 'Individual', label: 'Individual' },
              { value: 'Business', label: 'Business' },
            ]}
          />
        </div>
        <Table
          key={`${search}:${filter}`}
          caption="Clients"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            {
              id: 'name',
              label: 'Client',
              cell: (r) => <RecordLink href={`/clients/${r.id}`}>{r.name}</RecordLink>,
              sortValue: (r) => r.name,
            },
            { id: 'type', label: 'Type', cell: (r) => r.type },
            { id: 'email', label: 'Email', cell: (r) => r.email },
            { id: 'status', label: 'Status', cell: (r) => <Status value={r.status} /> },
            { id: 'tax', label: 'Tax status', cell: (r) => <Status value={r.tax} /> },
          ]}
          emptyTitle={search || filter ? 'No matching clients' : 'No clients loaded'}
        />
      </Card>
    </>
  );
}
export function Team() {
  const { preview } = useWorkspace();
  return (
    <OwnerOnly>
      <PageHeading
        title="Team"
        description="Manage the people who can access your firm workspace."
        action={
          <UnavailableAction label="Invite member">
            <ContactFields includeRole />
          </UnavailableAction>
        }
      />
      <DataNotice />
      <Card>
        <Table
          caption="Team members"
          rows={preview ? members : []}
          rowKey={(r) => r.id}
          columns={[
            { id: 'name', label: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
            { id: 'email', label: 'Email', cell: (r) => r.email },
            { id: 'role', label: 'Role', cell: (r) => r.role },
            { id: 'status', label: 'Status', cell: (r) => <Status value={r.status} /> },
            {
              id: 'actions',
              label: 'Actions',
              cell: (r) =>
                r.role === 'Owner' ? (
                  <span className="text-xs text-muted">Owner access protected</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <UnavailableAction label="Change role">
                      <Select
                        label="New role"
                        options={[
                          { value: 'STAFF', label: 'Staff' },
                          { value: 'ADMIN', label: 'Administrator' },
                        ]}
                      />
                    </UnavailableAction>
                    {r.status === 'Invited' ? (
                      <UnavailableAction label="Resend invite" />
                    ) : (
                      <ReasonAction label="Deactivate" danger />
                    )}
                  </div>
                ),
            },
          ]}
          emptyTitle="No team members loaded"
        />
      </Card>
    </OwnerOnly>
  );
}
export function PendingSignups() {
  const { preview } = useWorkspace();
  return (
    <OwnerOnly>
      <PageHeading
        title="Pending sign-ups"
        description="Review verified client requests before giving portal access."
      />
      <DataNotice />
      <Card>
        <Table
          caption="Pending sign-ups"
          rows={preview ? pending : []}
          rowKey={(r) => r.id}
          columns={[
            { id: 'name', label: 'Name', cell: (r) => r.name },
            {
              id: 'email',
              label: 'Email',
              cell: (r) => (
                <div>
                  {r.email}
                  <p className="text-xs text-muted">{r.phone}</p>
                </div>
              ),
            },
            { id: 'type', label: 'Type', cell: (r) => r.type },
            {
              id: 'verification',
              label: 'Verification',
              cell: (r) => <Status value={r.verified} />,
            },
            {
              id: 'duplicate',
              label: 'Duplicate check',
              cell: (r) => <Status value={r.duplicate} />,
            },
            {
              id: 'actions',
              label: 'Review',
              cell: () => (
                <div className="flex gap-2">
                  <UnavailableAction label="Approve">
                    <Select
                      label="Link to existing client"
                      options={[
                        { value: '', label: 'Create a new client' },
                        { value: 'sample-alex', label: 'Alex Morgan (sample)' },
                      ]}
                    />
                  </UnavailableAction>
                  <ReasonAction label="Decline" danger />
                </div>
              ),
            },
          ]}
          emptyTitle="No pending sign-ups loaded"
        />
      </Card>
    </OwnerOnly>
  );
}
