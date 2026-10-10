'use client';

import { Button, Card } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { textareaClass, when } from './parts';

/** The firm's internal notes on this client, newest first. Never shown in the client portal. */
export function NotesCard({ clientId }: { clientId: string }) {
  const key = ['client-notes', clientId];
  const notes = useApiQuery(key, () => api.clientNotes.list(clientId));
  const add = useApiMutation((body: string) => api.clientNotes.create(clientId, { body }), {
    invalidate: key,
  });
  const [body, setBody] = useState('');

  return (
    <Card title="Internal notes" className="flex flex-col gap-4 self-start">
      <p className="text-sm text-muted">Only your firm sees these notes. The client never does.</p>
      <PageState query={notes} empty="No notes yet.">
        {(items) => (
          <ul aria-label="Internal notes" className="flex flex-col gap-3">
            {items.map((note) => (
              <li key={note.id} className="rounded-card border border-border p-3">
                <p className="whitespace-pre-wrap">{note.body}</p>
                <p className="mt-2 text-xs text-muted">
                  {note.author.name} · {when.format(new Date(note.createdAt))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(body, { onSuccess: () => setBody('') });
        }}
      >
        <label htmlFor="new-note" className="text-sm font-medium">
          New note
        </label>
        <textarea
          id="new-note"
          rows={4}
          required
          className={textareaClass}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {add.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(add.error)}
          </p>
        ) : null}
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Saving…' : 'Save Note'}
        </Button>
      </form>
    </Card>
  );
}
