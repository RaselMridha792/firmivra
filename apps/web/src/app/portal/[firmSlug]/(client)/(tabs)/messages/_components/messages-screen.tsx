'use client';

import type { MyMessageThread } from '@firmivra/types';
import { Button, type Column, Input, Table } from '@firmivra/ui';
import { ArrowRight, Eye, Mail, MessageSquareText, Send } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { usePortal } from '../../../../layout';
import { fromLabel, when } from './message-parts';
import { NewMessageDialog, ThreadDialog } from './thread-dialogs';
import { NotesCard } from './notes-card';

type Filter = 'all' | 'from-firm' | 'sent';

/**
 * "Messages and Notes" (docs/mockups/client-portal/Messages and notes.png, N09): the threads with
 * the firm (All, from the firm, sent by me) with the unread dot, a thread to read and answer,
 * "Send a Message", and this login's private note, which the firm never sees.
 */
export function MessagesScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const { business } = usePortal();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const term = useDeferredValue(search.trim());
  const list = useApiQuery(['my-messages', slug, 'list', filter, term], () =>
    api.myMessages(slug).list({ filter, search: term || undefined, limit: 100 }),
  );
  const filters: [Filter, string][] = [
    ['all', 'All Messages'],
    ['from-firm', `Messages from ${business.name}`],
    ['sent', 'Messages I Sent'],
  ];
  const columns: Column<MyMessageThread>[] = [
    {
      id: 'subject',
      label: 'Subject',
      cell: (t) => (
        <span className="flex items-center gap-2">
          {t.from === 'FIRM' ? (
            <Mail aria-hidden className="size-5 shrink-0 text-firm-primary" />
          ) : (
            <Send aria-hidden className="size-5 shrink-0 text-firm-primary" />
          )}
          <span className={t.unreadCount > 0 ? 'font-bold text-heading' : 'text-heading'}>
            {t.subject}
          </span>
        </span>
      ),
    },
    { id: 'from', label: 'From', cell: (t) => fromLabel(t, business.name) },
    {
      id: 'date',
      label: 'Date',
      cell: (t) => when.format(new Date(t.lastMessageAt ?? t.createdAt)),
    },
    {
      id: 'actions',
      label: 'Actions',
      cell: (t) => (
        <span className="flex items-center gap-3">
          {t.unreadCount > 0 ? (
            <span className="size-2 rounded-full bg-firm-accent">
              <span className="sr-only">Unread</span>
            </span>
          ) : null}
          <Button
            variant="ghost"
            className="underline"
            onClick={() => setOpenId(t.id)}
            aria-label={`View ${t.subject}`}
          >
            <Eye aria-hidden className="size-4" /> View
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 rounded-card bg-surface p-4 md:p-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-start">
          <MessageSquareText
            aria-hidden
            className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-primary"
          />
          <div className="flex-1">
            <h1 className="font-display text-3xl font-bold text-heading">Messages and Notes</h1>
            <p className="text-text">
              Send messages to our team and view all conversations in one place. Keep track of
              important updates, questions, and next steps.
            </p>
          </div>
          <Button onClick={() => setComposing(true)}>
            Send a Message <ArrowRight aria-hidden className="size-5" />
          </Button>
        </header>
        <div className="flex flex-wrap items-end gap-2">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {filters.map(([value, label]) => (
              <Button
                key={value}
                variant={filter === value ? 'primary' : 'secondary'}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="ml-auto w-full md:w-64">
            <Input
              label="Search"
              type="search"
              placeholder="Search messages…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <PageState query={list}>
          {(data) => (
            <Table
              caption="Messages"
              rows={data.items}
              columns={columns}
              rowKey={(t) => t.id}
              pageSize={10}
              emptyTitle="No messages"
              emptyText="Conversations with your firm will appear here."
            />
          )}
        </PageState>
      </div>
      <NotesCard slug={slug} />
      <ThreadDialog slug={slug} threadId={openId} onClose={() => setOpenId(null)} />
      <NewMessageDialog
        slug={slug}
        open={composing}
        onClose={() => setComposing(false)}
        onSent={(id) => {
          setComposing(false);
          setOpenId(id);
        }}
      />
    </div>
  );
}
