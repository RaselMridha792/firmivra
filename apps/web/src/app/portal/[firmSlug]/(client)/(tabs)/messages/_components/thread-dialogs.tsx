'use client';

import {
  CreateMyMessageThreadRequest,
  MESSAGE_ERRORS,
  type MyMessageThreadDetail,
  SendMessageRequest,
} from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { usePortal } from '../../../../layout';
import { fromLabel, textareaClass, when } from './message-parts';

/** One thread: its messages, oldest first. Opening it marks the firm's messages read. */
export function ThreadDialog({
  slug,
  threadId,
  onClose,
}: {
  slug: string;
  threadId: string | null;
  onClose: () => void;
}) {
  return (
    <Modal open={threadId !== null} title="Conversation" onClose={onClose}>
      <div className="grid max-w-modal gap-4">
        {threadId ? (
          <ThreadBody key={threadId} slug={slug} threadId={threadId} onClose={onClose} />
        ) : null}
      </div>
    </Modal>
  );
}

function ThreadBody({
  slug,
  threadId,
  onClose,
}: {
  slug: string;
  threadId: string;
  onClose: () => void;
}) {
  const thread = useApiQuery(['my-messages', slug, 'thread', threadId], () =>
    api.myMessages(slug).get(threadId),
  );
  const markRead = useApiMutation((id: string) => api.myMessages(slug).markRead(id), {
    invalidate: ['my-messages', slug],
  });
  const markUnread = useApiMutation((id: string) => api.myMessages(slug).markUnread(id), {
    invalidate: ['my-messages', slug],
  });
  const unread = thread.data?.unreadCount ?? 0;
  const { mutate } = markRead;
  useEffect(() => {
    if (unread > 0) mutate(threadId);
  }, [threadId, unread, mutate]);
  return (
    <PageState query={thread}>
      {(t) => (
        <>
          <h3 className="font-display text-xl font-bold text-heading">{t.subject}</h3>
          <Messages thread={t} />
          {markUnread.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(markUnread.error, MESSAGE_ERRORS)}
            </p>
          ) : null}
          {t.messages.some((m) => m.from === 'FIRM') ? (
            <Button
              variant="ghost"
              className="justify-self-start underline"
              disabled={markUnread.isPending}
              onClick={() => markUnread.mutate(t.id, { onSuccess: onClose })}
            >
              Mark unread
            </Button>
          ) : null}
          {t.repliesEnabled ? (
            <ReplyForm slug={slug} threadId={t.id} />
          ) : (
            <p className="text-sm text-muted">{MESSAGE_ERRORS.REPLIES_CLOSED}</p>
          )}
        </>
      )}
    </PageState>
  );
}

function Messages({ thread }: { thread: MyMessageThreadDetail }) {
  const { business } = usePortal();
  return (
    <ol aria-label="Conversation" className="grid max-h-96 gap-3 overflow-y-auto">
      {thread.messages.map((m) => (
        <li
          key={m.id}
          className={`grid gap-1 rounded-card p-3 ${m.from === 'FIRM' ? 'bg-folder-surface' : 'border border-border'}`}
        >
          <span className="flex flex-wrap justify-between gap-2 text-xs text-muted">
            <span className="font-semibold text-heading">{fromLabel(m, business.name)}</span>
            {when.format(new Date(m.createdAt))}
          </span>
          <p className="text-sm whitespace-pre-wrap text-text">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}

function ReplyForm({ slug, threadId }: { slug: string; threadId: string }) {
  const form = useForm<SendMessageRequest>({
    resolver: zodResolver(SendMessageRequest),
    defaultValues: { body: '' },
  });
  const reply = useApiMutation(
    (body: SendMessageRequest) => api.myMessages(slug).reply(threadId, body),
    { invalidate: ['my-messages', slug] },
  );
  return (
    <form
      noValidate
      className="grid gap-2"
      onSubmit={form.handleSubmit((body) =>
        reply.mutate(body, { onSuccess: () => form.reset({ body: '' }) }),
      )}
    >
      <label className="grid gap-1 text-sm font-medium text-text">
        Reply
        <textarea rows={3} className={textareaClass} {...form.register('body')} />
      </label>
      {form.formState.errors.body ? (
        <p className="text-sm text-danger">{form.formState.errors.body.message}</p>
      ) : null}
      {reply.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(reply.error, MESSAGE_ERRORS)}
        </p>
      ) : null}
      <Button type="submit" className="justify-self-start" disabled={reply.isPending}>
        Send Reply
      </Button>
    </form>
  );
}

/** "Send a Message": a new thread to the firm. */
export function NewMessageDialog({
  slug,
  open,
  onClose,
  onSent,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  onSent: (threadId: string) => void;
}) {
  const form = useForm<CreateMyMessageThreadRequest>({
    resolver: zodResolver(CreateMyMessageThreadRequest),
    defaultValues: { subject: '', body: '' },
  });
  const create = useApiMutation(
    (body: CreateMyMessageThreadRequest) => api.myMessages(slug).create(body),
    { invalidate: ['my-messages', slug] },
  );
  const errors = form.formState.errors;
  return (
    <Modal open={open} title="Send a Message" onClose={onClose}>
      <form
        noValidate
        className="grid max-w-modal gap-4"
        onSubmit={form.handleSubmit((body) =>
          create.mutate(body, {
            onSuccess: (t) => {
              form.reset();
              onSent(t.id);
            },
          }),
        )}
      >
        <Input label="Subject" error={errors.subject?.message} {...form.register('subject')} />
        <label className="grid gap-1 text-sm font-medium text-text">
          Message
          <textarea rows={6} className={textareaClass} {...form.register('body')} />
        </label>
        {errors.body ? <p className="text-sm text-danger">{errors.body.message}</p> : null}
        {create.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(create.error, MESSAGE_ERRORS)}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={create.isPending}>
            Send Message
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
