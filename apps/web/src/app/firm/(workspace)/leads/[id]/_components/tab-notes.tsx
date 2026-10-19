'use client';

import { Avatar, Button, Textarea } from '@firmivra/ui';
import { NotePencil } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from '../../_components/lead-shared';
import { CardFrame } from './profile-cards';
import { useProfile } from './profile-frame';
import { stamp, wsKey } from './profile-shared';

/** Notes tab: the lead's internal notes, newest first, and a box to add one. */
export function NotesTab() {
  const { id } = useProfile();
  const [text, setText] = useState('');
  const notes = useApiQuery(wsKey(id, 'notes'), () => api.leadPipeline.notes(id));
  const add = useApiMutation(() => api.leadPipeline.addNote(id, { text: text.trim() }), {
    invalidate: LEAD_PIPELINE_KEY,
  });
  const rows = [...(notes.data ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <CardFrame icon={NotePencil} title="Notes" testId="card-notes">
      <form
        className="mb-4 flex flex-col gap-3"
        aria-label="Add a note"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate(undefined, { onSuccess: () => setText('') });
        }}
      >
        <Textarea
          label="Add a note (only your firm sees it)"
          rows={3}
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!text.trim() || add.isPending}>
            Save Note
          </Button>
          {add.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(add.error)}
            </p>
          ) : null}
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-canvas p-6 text-center text-sm text-muted">
          {notes.isPending
            ? 'Loading…'
            : notes.isError
              ? 'Notes are not available right now.'
              : 'No notes yet. Write down what you learn about this lead.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider" data-testid="lead-notes">
          {rows.map((note) => (
            <li key={note.id} className="flex gap-3 py-3">
              <Avatar name={note.by?.name ?? 'System'} size="md" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-semibold text-heading">
                  {note.by?.name ?? 'System'}{' '}
                  <span className="font-normal text-muted">· {stamp(note.at)}</span>
                </p>
                <p className="whitespace-pre-line text-sm text-text">{note.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </CardFrame>
  );
}
