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
import styles from './messages-screen.module.css';

type Filter = 'all' | 'from-firm' | 'sent';
const sidebarBlueButton =
  'bg-firm-primary! text-on-action! hover:bg-navigation-hover! focus-visible:outline-firm-primary enabled:cursor-pointer';
const secondaryBlueButton =
  'border-folder-border! text-firm-primary! hover:bg-folder-surface! enabled:cursor-pointer';

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
        <span className="flex min-w-0 items-center gap-2">
          {t.from === 'FIRM' ? (
            <Mail aria-hidden className="size-5 shrink-0 text-firm-primary" />
          ) : (
            <Send aria-hidden className="size-5 shrink-0 text-firm-primary" />
          )}
          <span
            className={`min-w-0 break-words ${t.unreadCount > 0 ? 'font-bold text-heading' : 'text-heading'}`}
          >
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
            <span className="size-2 rounded-full bg-firm-primary">
              <span className="sr-only">Unread</span>
            </span>
          ) : null}
          <Button
            variant="ghost"
            className="w-full text-firm-primary! underline hover:bg-folder-surface! enabled:cursor-pointer xl:w-auto"
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
    <div className={`${styles.messagesPage} grid min-w-0 grid-cols-1 gap-4`}>
      <div className="grid min-w-0 grid-cols-1 gap-4 rounded-card bg-surface p-4 md:p-6">
        <header className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-start">
          <MessageSquareText
            aria-hidden
            className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-primary sm:col-span-2 xl:col-span-1"
          />
          <div className="min-w-0 sm:col-span-10 xl:col-span-8">
            <h1 className="font-display text-3xl font-bold text-heading">Messages and Notes</h1>
            <p className="text-text">
              Send messages to our team and view all conversations in one place. Keep track of
              important updates, questions, and next steps.
            </p>
          </div>
          <Button
            className={`${sidebarBlueButton} whitespace-nowrap sm:col-span-12 xl:col-span-3`}
            onClick={() => setComposing(true)}
          >
            Send a Message <ArrowRight aria-hidden className="size-5" />
          </Button>
        </header>
        <div className="flex flex-wrap items-end gap-2">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            {filters.map(([value, label]) => (
              <Button
                key={value}
                variant={filter === value ? 'primary' : 'secondary'}
                className={filter === value ? sidebarBlueButton : secondaryBlueButton}
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
            <div
              data-testid="portal-messages-list"
              className="[&_table]:block [&_thead]:hidden [&_tbody]:grid [&_tbody]:gap-3 [&_tbody_tr]:grid [&_tbody_tr]:grid-cols-1 [&_tbody_tr]:rounded-card [&_td]:block [&_td]:px-3 [&_td]:py-2 [&>div>div:last-child]:gap-2 [&>div>div:last-child]:text-xs xl:[&_table]:table xl:[&_thead]:table-header-group xl:[&_tbody]:table-row-group xl:[&_tbody_tr]:table-row xl:[&_td]:table-cell xl:[&_td]:px-4 xl:[&_td]:py-3"
            >
              <Table<MyMessageThread>
                caption="Messages"
                rows={data.items}
                columns={columns.map((column) => ({
                  ...column,
                  cell: (thread) => (
                    <div className="min-w-0 break-words">
                      <span className="mb-1 block text-xs text-muted xl:hidden">
                        {column.label}
                      </span>
                      {column.cell(thread)}
                    </div>
                  ),
                }))}
                rowKey={(t) => t.id}
                pageSize={10}
                emptyTitle="No messages"
                emptyText="Conversations with your firm will appear here."
              />
            </div>
          )}
        </PageState>
      </div>
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
