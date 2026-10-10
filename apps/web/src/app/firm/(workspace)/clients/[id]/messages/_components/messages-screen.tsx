'use client';
import type { MessageThread as Thread } from '@firmivra/types';
import { Badge, Button, Card, Modal, Table, type Column } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { MessageForm } from './message-form';
import { messageDate, MessageThread } from './message-thread';

export function MessagesScreen({ clientId }: { clientId: string }) {
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const threads = useApiQuery(['client-messages', clientId, cursors.at(-1)], () =>
    api.messages.listForClient(clientId, {
      cursor: cursors.at(-1),
    }),
  );
  const previous = () => setCursors((pages) => pages.slice(0, -1));
  const next = () => {
    const cursor = threads.data?.nextCursor;
    if (cursor) setCursors((pages) => [...pages, cursor]);
  };
  const view = (row: Thread) => (
    <Button
      variant="ghost"
      onClick={() => setSelected(row.id)}
      aria-label={`View ${row.subject}`}
      data-testid="message-view"
    >
      View
    </Button>
  );
  const columns: Column<Thread>[] = [
    {
      id: 'subject',
      label: 'Subject',
      cell: (row) => (
        <span className="wrap-anywhere">
          {row.subject}{' '}
          {row.unreadCount ? <Badge tone="info">{row.unreadCount} unread</Badge> : null}
        </span>
      ),
    },
    {
      id: 'from',
      label: 'From',
      cell: (row) => <span className="wrap-anywhere">{row.startedBy?.name ?? 'Firm'}</span>,
    },
    {
      id: 'date',
      label: 'Date',
      cell: (row) => messageDate(row.lastMessage?.createdAt ?? row.createdAt),
    },
    { id: 'actions', label: 'Actions', cell: view },
  ];
  return (
    <div className="min-w-0 space-y-4" data-testid="client-messages-screen">
      <Card className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-heading">Messages and Notes</h2>
            <p className="text-sm text-muted">
              View conversations with your client and send updates.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>Send a Message</Button>
        </div>
        <PageState
          query={threads}
          empty="No conversations with this client yet."
          isEmpty={(data) => !data.items.length}
        >
          {(data) => (
            <div className="min-w-0 space-y-4">
              <div className="space-y-3 md:hidden" data-testid="message-cards">
                {data.items.map((row) => (
                  <Card key={row.id} className="min-w-0 space-y-2">
                    <h3 className="font-semibold text-heading wrap-anywhere">{row.subject}</h3>
                    <p className="text-sm text-muted wrap-anywhere">
                      From: {row.startedBy?.name ?? 'Firm'}
                    </p>
                    <p className="text-sm text-muted">
                      {messageDate(row.lastMessage?.createdAt ?? row.createdAt)}
                    </p>
                    {row.unreadCount ? <Badge tone="info">{row.unreadCount} unread</Badge> : null}
                    {view(row)}
                  </Card>
                ))}
              </div>
              <div
                className="hidden min-w-0 md:block [&_table]:table-fixed [&_td]:px-2 [&_th]:px-2 [&_th:last-child]:w-20 [&>div>div:last-child]:hidden"
                data-testid="message-table"
              >
                <Table
                  rows={data.items}
                  columns={columns}
                  rowKey={(row) => row.id}
                  caption="Client conversations"
                  server={{
                    page: cursors.length,
                    hasPrevious: cursors.length > 1,
                    hasNext: !!data.nextCursor,
                    onPrevious: previous,
                    onNext: next,
                    onSort: () => {},
                  }}
                />
              </div>
              <nav aria-label="Conversation pages" className="grid grid-cols-2 gap-3 sm:flex">
                <Button variant="secondary" disabled={cursors.length === 1} onClick={previous}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={!data.nextCursor} onClick={next}>
                  Next
                </Button>
              </nav>
            </div>
          )}
        </PageState>
      </Card>
      {selected ? (
        <MessageThread
          key={selected}
          clientId={clientId}
          id={selected}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
      {creating ? (
        <Modal open title="Send a Message" onClose={() => setCreating(false)}>
          <MessageForm clientId={clientId} onSent={() => setCreating(false)} />
        </Modal>
      ) : null}
    </div>
  );
}
