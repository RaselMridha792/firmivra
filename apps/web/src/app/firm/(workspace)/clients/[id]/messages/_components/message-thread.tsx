'use client';
import { MESSAGE_ERRORS } from '@firmivra/types';
import { Badge, Card, Modal } from '@firmivra/ui';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { MessageForm } from './message-form';

export const messageDate = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export function MessageThread({
  clientId,
  id,
  onClose,
}: {
  clientId: string;
  id: string;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const thread = useApiQuery(['client-message-thread', clientId, id], () => api.messages.get(id));
  const { mutate: markRead, error: readError } = useApiMutation(
    (threadId: string) => api.messages.markRead(threadId),
    {
      invalidate: ['client-messages', clientId],
    },
  );
  const loadedId = thread.data?.id;
  useEffect(() => {
    if (loadedId) markRead(loadedId);
  }, [loadedId, markRead]);
  return (
    <Modal open title={thread.data?.subject ?? 'Conversation'} onClose={onClose}>
      <PageState query={thread}>
        {(data) => (
          <div className="min-w-0 space-y-4" data-testid="message-thread">
            {readError ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(readError, MESSAGE_ERRORS)}
              </p>
            ) : null}
            {!data.repliesEnabled ? <Badge tone="warning">Client replies closed</Badge> : null}
            <section
              className="max-h-80 space-y-3 overflow-y-auto"
              aria-label="Conversation messages"
            >
              {data.messages.length ? (
                data.messages.map((message) => (
                  <Card
                    key={message.id}
                    data-testid="conversation-message"
                    className={
                      message.direction === 'FIRM_TO_CLIENT' ? 'space-y-2 bg-brand-50' : 'space-y-2'
                    }
                  >
                    <p className="text-sm font-semibold wrap-anywhere">
                      {message.sender.name} · {message.sender.kind === 'STAFF' ? 'Firm' : 'Client'}
                    </p>
                    <p className="whitespace-pre-wrap wrap-anywhere">{message.body}</p>
                    <p className="text-xs text-muted">
                      <time dateTime={message.createdAt}>{messageDate(message.createdAt)}</time>
                      {message.direction === 'FIRM_TO_CLIENT'
                        ? message.readAt
                          ? ' · Read by client'
                          : ' · Not yet read by client'
                        : null}
                    </p>
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted">No messages in this conversation yet.</p>
              )}
            </section>
            <MessageForm
              clientId={clientId}
              threadId={id}
              subject={data.subject}
              onSent={() =>
                void cache.invalidateQueries({ queryKey: ['client-message-thread', clientId, id] })
              }
            />
          </div>
        )}
      </PageState>
    </Modal>
  );
}
