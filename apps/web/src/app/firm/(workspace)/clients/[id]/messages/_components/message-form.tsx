'use client';
import { CreateMessageThreadRequest, MESSAGE_ERRORS } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';

export function MessageForm({
  clientId,
  threadId,
  subject = '',
  onSent,
}: {
  clientId: string;
  threadId?: string;
  subject?: string;
  onSent: () => void;
}) {
  const form = useForm<CreateMessageThreadRequest>({
    resolver: zodResolver(CreateMessageThreadRequest),
    defaultValues: { subject, body: '' },
  });
  const send = useApiMutation(
    async (body: CreateMessageThreadRequest) => {
      if (threadId) await api.messages.send(threadId, { body: body.body });
      else await api.messages.create(clientId, body);
    },
    { invalidate: ['client-messages', clientId] },
  );
  return (
    <form
      className="space-y-4"
      data-testid="message-form"
      onSubmit={form.handleSubmit((body) =>
        send.mutate(body, {
          onSuccess: () => {
            form.reset();
            onSent();
          },
        }),
      )}
    >
      {!threadId ? (
        <Input
          label="Subject"
          maxLength={200}
          error={form.formState.errors.subject?.message}
          {...form.register('subject')}
        />
      ) : null}
      <Input
        label={threadId ? 'Reply' : 'Message'}
        maxLength={10000}
        error={form.formState.errors.body?.message}
        {...form.register('body')}
      />
      {send.error ? (
        <p role="alert" className="text-sm text-danger" data-testid="message-send-error">
          {errorMessage(send.error, MESSAGE_ERRORS)}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-full sm:w-auto"
        disabled={send.isPending}
        data-testid="message-send"
      >
        {send.isPending ? 'Sending…' : threadId ? 'Send reply' : 'Send message'}
      </Button>
    </form>
  );
}
