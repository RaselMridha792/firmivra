'use client';

import { MESSAGE_ERRORS } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { useEffect, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { useClientRecord } from '../../_components/use-client-record';
import { textareaClass, when } from './parts';

const refresh = { invalidate: ['messages'] };

function Problem({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {errorMessage(error, MESSAGE_ERRORS)}
    </p>
  );
}

/**
 * Octavia's E9: before sending, who it goes to, where and how they hear of it. A firm message goes
 * to the client's portal conversation, and the client's active primary portal login gets an email
 * notice (no message text), as the notifier does; no other channel is offered here until the
 * channel rules are settled.
 */
function Recipient({ clientId }: { clientId: string }) {
  const record = useClientRecord(clientId);
  const c = record.data;
  const login = c?.portalLogins.find((l) => l.portalRole === 'PRIMARY' && l.status === 'ACTIVE');
  return (
    <dl
      className="grid gap-1 rounded-control border border-border bg-subtle p-3 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4"
      data-testid="message-recipient"
      aria-label="Who this goes to"
    >
      <dt className="text-muted">To</dt>
      <dd className="wrap-anywhere text-text">{c?.displayName ?? 'The client'}</dd>
      <dt className="text-muted">Where</dt>
      <dd className="text-text">Their client portal conversation</dd>
      <dt className="text-muted">Notice</dt>
      <dd className="wrap-anywhere text-text">
        {record.isPending
          ? '…'
          : login
            ? `An email to ${login.email} that a message is waiting (not the message itself)`
            : 'None: they have no active portal login yet, so they see it once they sign in'}
      </dd>
    </dl>
  );
}

/** One thread, oldest message first. Opening it marks the client's messages read for the firm. */
export function ThreadDialog({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const thread = useApiQuery(['messages', 'thread', threadId], () => api.messages.get(threadId));
  const { mutate: markRead } = useApiMutation((tid: string) => api.messages.markRead(tid), refresh);
  const send = useApiMutation((body: string) => api.messages.send(threadId, { body }), refresh);
  const [reply, setReply] = useState('');
  useEffect(() => markRead(threadId), [threadId, markRead]);

  return (
    <Modal open title={thread.data?.subject ?? 'Message'} onClose={onClose}>
      <PageState query={thread}>
        {(t) => (
          <div className="flex flex-col gap-4">
            <ol aria-label="Conversation" className="flex flex-col gap-3">
              {t.messages.map((m) => {
                const firm = m.direction === 'FIRM_TO_CLIENT';
                return (
                  <li
                    key={m.id}
                    className={`max-w-prose rounded-card p-3 ${firm ? 'ml-auto bg-folder-surface' : 'mr-auto border border-border bg-subtle'}`}
                  >
                    <p className="text-xs text-muted">
                      {m.sender.name} · {when.format(new Date(m.createdAt))}
                      {firm && m.readAt ? ' · Read' : ''}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </li>
                );
              })}
            </ol>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate(reply, { onSuccess: () => setReply('') });
              }}
            >
              <label htmlFor="reply" className="text-sm font-medium">
                Reply
              </label>
              <textarea
                id="reply"
                rows={4}
                required
                className={textareaClass}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <Recipient clientId={t.client.id} />
              <Problem error={send.error} />
              <Button type="submit" className="self-end" disabled={send.isPending}>
                {send.isPending ? 'Sending…' : 'Send Reply'}
              </Button>
            </form>
          </div>
        )}
      </PageState>
    </Modal>
  );
}

export function NewThreadDialog({
  clientId,
  onClose,
  engagementId,
  initialSubject = '',
  onSent,
}: {
  clientId: string;
  onClose: () => void;
  /** TX-F05: the service record the conversation is about (a tax return's engagement). */
  engagementId?: string;
  initialSubject?: string;
  /** Called once the message is sent, before the dialog closes. */
  onSent?: () => void;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const create = useApiMutation(
    () =>
      api.messages.create(clientId, { subject, body, ...(engagementId ? { engagementId } : {}) }),
    refresh,
  );
  return (
    <Modal open title="New Message" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined, {
            onSuccess: () => {
              onSent?.();
              onClose();
            },
          });
        }}
      >
        <Input
          label="Subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="new-message" className="text-sm font-medium">
            Message
          </label>
          <textarea
            id="new-message"
            rows={6}
            required
            className={textareaClass}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <Recipient clientId={clientId} />
        <Problem error={create.error} />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Sending…' : 'Send Message'}
        </Button>
      </form>
    </Modal>
  );
}
