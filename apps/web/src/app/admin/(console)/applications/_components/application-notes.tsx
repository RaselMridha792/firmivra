'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@firmivra/ui';
import type { ApplicationNote } from './application-data';

export function ApplicationNotes({
  notes,
  onSave,
}: {
  notes: ApplicationNote[];
  onSave: (note: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = draft.trim();
    if (!note || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(note);
      setDraft('');
    } catch {
      setError('The note could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {notes.length ? (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-control bg-canvas p-3 text-sm text-text">
              {note.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No internal notes yet.</p>
      )}
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="application-note" className="sr-only">
          Add an internal note
        </label>
        <textarea
          id="application-note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Add internal notes about this application…"
          className="w-full resize-y rounded-control border border-border bg-surface p-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500"
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Notes are only visible to Firmivra administrators.</p>
          <Button type="submit" disabled={!draft.trim() || busy}>
            {busy ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </form>
    </div>
  );
}
