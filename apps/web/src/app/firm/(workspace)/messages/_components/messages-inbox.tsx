'use client';

import type { MessageThread } from '@firmivra/types';
import { Card, Input, Table, type Column } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const columns: Column<MessageThread>[] = [
  {
    id: 'client',
    label: 'Client',
    cell: (t) => (
      <Link
        href={`/clients/${encodeURIComponent(t.client.id)}/messages`}
        className={`text-link underline ${t.unreadCount ? 'font-semibold' : ''}`}
      >
        {t.client.displayName}
      </Link>
    ),
  },
  { id: 'subject', label: 'Subject', cell: (t) => t.subject },
  {
    id: 'last',
    label: 'Last message',
    cell: (t) =>
      t.lastMessage ? (
        <span className="line-clamp-2 text-muted">
          {t.lastMessage.senderName}: {t.lastMessage.excerpt}
        </span>
      ) : (
        '—'
      ),
  },
  {
    id: 'date',
    label: 'Date',
    cell: (t) => (
      <span className="whitespace-nowrap">
        {when.format(new Date(t.lastMessage?.createdAt ?? t.createdAt))}
      </span>
    ),
  },
  {
    id: 'unread',
    label: 'Unread',
    cell: (t) =>
      t.unreadCount ? (
        <span className="relative rounded-pill bg-action px-2 py-0.5 text-xs font-semibold text-on-action">
          {t.unreadCount}
          <span className="sr-only"> unread</span>
        </span>
      ) : null,
  },
];

/**
 * F10: every client's conversations in one place, unread first. Staff see only their assigned
 * clients (the API decides). A row opens that client's Messages tab.
 */
export function MessagesInbox() {
  const [name, setName] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const query = cursor ? { cursor } : {};
  const inbox = useApiQuery(['messages', 'inbox', query], () => api.messages.inbox(query));
  const unread = useApiQuery(['messages', 'unread-count'], () => api.messages.unreadCount());
  const typed = name.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Messages
        </h1>
        <p className="text-sm text-muted">
          Every client conversation, unread first.
          {unread.data?.total ? ` ${unread.data.total} unread from clients.` : ''}
        </p>
      </div>
      <Card>
        <div className="max-w-sm">
          <Input
            label="Search by client name"
            type="search"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </Card>
      <PageState query={inbox}>
        {(page) => (
          <Table
            caption="Client messages"
            rows={page.items
              .filter((t) => t.client.displayName.toLowerCase().includes(typed))
              .sort((a, b) => Number(b.unreadCount > 0) - Number(a.unreadCount > 0))}
            columns={columns}
            rowKey={(t) => t.id}
            emptyTitle="No messages"
            emptyText={
              typed ? 'No client on this page matches that name.' : 'No conversations yet.'
            }
            server={{
              page: cursors.length + 1,
              hasPrevious: cursors.length > 0,
              hasNext: page.nextCursor !== null,
              onPrevious: () => setCursors(cursors.slice(0, -1)),
              onNext: () => page.nextCursor && setCursors([...cursors, page.nextCursor]),
              onSort: () => undefined,
            }}
          />
        )}
      </PageState>
    </div>
  );
}
