'use client';

import type { MessageThread } from '@firmivra/types';
import { Button, Card, Input, Table, type Column } from '@firmivra/ui';
import { Eye, Mail, MessageSquareText } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { NotesCard } from './notes-card';
import { NewThreadDialog, ThreadDialog } from './thread-dialogs';
import { when } from './parts';

/** F10: one client's messages and internal notes, styled after Messages and notes.png. */
export function ClientMessagesScreen() {
  const { id } = useParams<{ id: string }>();
  const [unread, setUnread] = useState(false);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const cursor = cursors.at(-1);
  const query = {
    ...(search ? { search } : {}),
    ...(unread ? { unread: 'true' as const } : {}),
    ...(cursor ? { cursor } : {}),
  };
  const threads = useApiQuery(['messages', 'client', id, query], () =>
    api.messages.listForClient(id, query),
  );

  const columns: Column<MessageThread>[] = [
    {
      id: 'subject',
      label: 'Subject',
      cell: (t) => (
        <span className="flex items-center gap-3">
          <Mail aria-hidden className="size-5 shrink-0 text-action" />
          <span className={t.unreadCount ? 'font-semibold' : ''}>{t.subject}</span>
        </span>
      ),
    },
    { id: 'from', label: 'From', cell: (t) => t.lastMessage?.senderName ?? '—' },
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
      id: 'actions',
      label: 'Actions',
      cell: (t) => (
        <span className="relative flex items-center gap-2">
          <span
            aria-hidden
            className={`size-2.5 shrink-0 rounded-full ${t.unreadCount ? 'bg-action' : ''}`}
          />
          {t.unreadCount ? <span className="sr-only">{t.unreadCount} unread</span> : null}
          <Button variant="ghost" onClick={() => setOpen(t.id)} aria-label={`View ${t.subject}`}>
            <Eye aria-hidden className="size-5" /> View
          </Button>
        </span>
      ),
    },
  ];
  const show = (next: boolean) => {
    setUnread(next);
    setCursors([]);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <div className="flex flex-wrap items-start gap-4">
          <MessageSquareText
            aria-hidden
            className="hidden size-16 shrink-0 rounded-full bg-folder-surface p-4 text-heading sm:block"
          />
          <div className="min-w-0 flex-1 basis-64">
            <h1
              data-testid="page-title"
              className="font-display text-2xl font-bold text-heading md:text-3xl"
            >
              Messages and Notes
            </h1>
            <p className="text-muted">
              Message this client and keep your team&apos;s notes about them in one place.
            </p>
          </div>
          <Button onClick={() => setComposing(true)}>New Message</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button variant={unread ? 'secondary' : 'primary'} onClick={() => show(false)}>
            All Messages
          </Button>
          <Button variant={unread ? 'primary' : 'secondary'} onClick={() => show(true)}>
            Unread
          </Button>
          <form
            role="search"
            className="ml-auto w-full sm:w-72"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(typed.trim());
              setCursors([]);
            }}
          >
            <Input
              label="Search messages"
              type="search"
              placeholder="Search messages…"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </form>
        </div>
        <PageState query={threads}>
          {(page) => (
            <Table
              caption="Messages"
              rows={page.items}
              columns={columns}
              rowKey={(t) => t.id}
              emptyTitle="No messages"
              emptyText="Nothing to show here yet."
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
      </Card>
      <NotesCard clientId={id} />
      {open ? <ThreadDialog threadId={open} onClose={() => setOpen(null)} /> : null}
      {composing ? <NewThreadDialog clientId={id} onClose={() => setComposing(false)} /> : null}
    </div>
  );
}
