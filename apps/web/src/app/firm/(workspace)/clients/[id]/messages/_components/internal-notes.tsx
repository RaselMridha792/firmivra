'use client';
import { CreateInternalNoteRequest, MESSAGE_ERRORS } from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { messageDate } from './message-thread';

export function InternalNotes({ clientId }: { clientId: string }) {
  // Staff-only endpoint and cache; never passed to api.messages or a portal component.
  const key = ['client-internal-notes', clientId];
  const notes = useApiQuery(key, () => api.clientNotes.list(clientId));
  const form = useForm<CreateInternalNoteRequest>({
    resolver: zodResolver(CreateInternalNoteRequest),
    defaultValues: { body: '' },
  });
  const save = useApiMutation(
    (body: CreateInternalNoteRequest) => api.clientNotes.create(clientId, body),
    { invalidate: key },
  );
  return (
    <Card className="min-w-0 space-y-4" data-testid="client-internal-notes">
      <h2 className="text-xl font-semibold text-heading">Staff notes</h2>
      <p className="text-sm font-medium text-muted">Internal note, not visible to the client</p>
      <PageState query={notes} empty="No internal notes for this client yet.">
        {(items) => (
          <ul className="space-y-4">
            {items.map((note) => (
              <li
                key={note.id}
                className="space-y-2 border-b border-border pb-4"
                data-testid="internal-note"
              >
                <p className="whitespace-pre-wrap wrap-anywhere">{note.body}</p>
                <p className="text-xs text-muted wrap-anywhere">
                  {note.author.name} ·{' '}
                  <time dateTime={note.createdAt}>{messageDate(note.createdAt)}</time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      {!notes.isPending && !notes.isError ? (
        <form
          className="space-y-3"
          data-testid="internal-note-form"
          onSubmit={form.handleSubmit((body) =>
            save.mutate(body, { onSuccess: () => form.reset() }),
          )}
        >
          <Input
            label="Internal note"
            maxLength={10000}
            data-testid="internal-note-body"
            error={form.formState.errors.body?.message}
            {...form.register('body')}
          />
          {save.error ? (
            <p role="alert" className="text-sm text-danger" data-testid="internal-note-error">
              {errorMessage(save.error, MESSAGE_ERRORS)}
            </p>
          ) : null}
          <Button
            type="submit"
            className="w-full"
            disabled={save.isPending}
            data-testid="internal-note-save"
          >
            {save.isPending ? 'Saving…' : 'Save Note'}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
