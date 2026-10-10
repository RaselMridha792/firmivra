'use client';

import { MESSAGE_ERRORS } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { useEffect, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
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

export function NewThreadDialog({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const create = useApiMutation(() => api.messages.create(clientId, { subject, body }), refresh);
  return (
    <Modal open title="New Message" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined, { onSuccess: onClose });
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
        <Problem error={create.error} />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Sending…' : 'Send Message'}
        </Button>
      </form>
    </Modal>
  );
}
