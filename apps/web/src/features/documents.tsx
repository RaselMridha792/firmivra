'use client';

import { useState } from 'react';
import { Button, Card, Input, NotificationList, Select, Table } from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import { DataNotice, PageHeading, Status, UnavailableAction } from './screen-kit';

const documents = [
  {
    id: 'sample-return',
    name: 'Sample tax return.pdf',
    client: 'Alex Morgan',
    category: 'Tax',
    year: '2026',
    status: 'For your review',
    uploadedBy: 'Client',
  },
  {
    id: 'sample-bank',
    name: 'Sample bank statement.pdf',
    client: 'Example Studio LLC',
    category: 'Bookkeeping',
    year: '2026',
    status: 'Available',
    uploadedBy: 'Firm',
  },
];
export function Documents() {
  const { preview } = useWorkspace();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const rows = preview
    ? documents.filter(
        (r) =>
          (!category || r.category === category) &&
          `${r.name} ${r.client}`.toLowerCase().includes(search.toLowerCase()),
      )
    : [];
  return (
    <>
      <PageHeading
        title="Documents"
        description="Review documents shared by clients and your firm."
        action={
          <UnavailableAction label="Request a document">
            <Input label="Client" required />
            <Input label="Document name" required />
            <Select
              label="Category"
              options={[
                { value: 'tax', label: 'Tax' },
                { value: 'books', label: 'Bookkeeping' },
              ]}
            />
            <Input label="Due date" type="date" />
          </UnavailableAction>
        }
      />
      <DataNotice />
      <Card>
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Input
            label="Search documents"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[
              { value: '', label: 'All categories' },
              { value: 'Tax', label: 'Tax' },
              { value: 'Bookkeeping', label: 'Bookkeeping' },
            ]}
          />
        </div>
        <Table
          key={`${search}:${category}`}
          caption="Firm documents"
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { id: 'name', label: 'Document', cell: (r) => r.name, sortValue: (r) => r.name },
            { id: 'client', label: 'Client', cell: (r) => r.client },
            { id: 'category', label: 'Category', cell: (r) => r.category },
            { id: 'year', label: 'Year', cell: (r) => r.year },
            { id: 'status', label: 'Status', cell: (r) => <Status value={r.status} /> },
            { id: 'uploader', label: 'Uploaded by', cell: (r) => r.uploadedBy },
            {
              id: 'actions',
              label: 'Actions',
              cell: () => (
                <div className="flex gap-2">
                  <Button variant="link" disabled>
                    Download
                  </Button>
                  <UnavailableAction label="Change status">
                    <Select
                      label="Document status"
                      options={['New', 'For Your Review', 'Available'].map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </UnavailableAction>
                </div>
              ),
            },
          ]}
          emptyTitle="No documents loaded"
        />
      </Card>
    </>
  );
}
export function Notifications() {
  const { preview, notifications, readNotification, readAllNotifications } = useWorkspace();
  const [filter, setFilter] = useState('all');
  const items = preview
    ? notifications.filter((n) => filter === 'all' || (filter === 'read' ? n.read : !n.read))
    : [];
  return (
    <>
      <PageHeading title="Notifications" description="Updates and reminders from your firm." />
      <DataNotice />
      <Card>
        <div className="mb-6">
          <Select
            label="Show notifications"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All notifications' },
              { value: 'unread', label: 'Unread' },
              { value: 'read', label: 'Read' },
            ]}
          />
        </div>
        <NotificationList
          items={items}
          onRead={preview ? readNotification : undefined}
          onReadAll={preview ? readAllNotifications : undefined}
        />
      </Card>
    </>
  );
}
