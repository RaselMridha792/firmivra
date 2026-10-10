'use client';

import { type MyNote, SaveMyNoteRequest } from '@firmivra/types';
import { Button, Card, Checkbox, Input } from '@firmivra/ui';
import { NotebookPen } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { textareaClass, when } from './message-parts';

/** A datetime-local value ("2026-10-20T09:00") from an ISO time, in this browser's time zone. */
const toLocal = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** "Notes": this login's private notepad with an optional reminder. The firm never sees it. */
export function NotesCard({ slug }: { slug: string }) {
  const note = useApiQuery(['my-notes', slug], () => api.myNotes(slug).get());
  return (
    <Card className="grid min-w-0 gap-3">
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-heading">
        <NotebookPen aria-hidden className="size-6 text-firm-primary" /> Notes
      </h2>
      <p className="text-sm text-muted">Only you can see your notes. Your firm never sees them.</p>
      <PageState query={note} isEmpty={() => false}>
        {(data) => <NoteForm key={data.note?.savedAt ?? 'new'} slug={slug} note={data.note} />}
      </PageState>
    </Card>
  );
}

function NoteForm({ slug, note }: { slug: string; note: MyNote | null }) {
  const pending = note?.reminder && !note.reminder.sentAt ? note.reminder.remindAt : null;
  const [body, setBody] = useState(note?.body ?? '');
  const [remind, setRemind] = useState(pending !== null);
  const [remindAt, setRemindAt] = useState(() => (pending ? toLocal(pending) : ''));
  const [issue, setIssue] = useState<string | null>(null);
  const save = useApiMutation((input: SaveMyNoteRequest) => api.myNotes(slug).save(input), {
    invalidate: ['my-notes', slug],
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = SaveMyNoteRequest.safeParse({
      body,
      remindAt: remind ? (remindAt ? new Date(remindAt).toISOString() : '') : null,
    });
    if (!parsed.success) {
      setIssue(parsed.error.issues[0]?.message ?? 'Check the note');
      return;
    }
    setIssue(null);
    save.mutate(parsed.data);
  };
  return (
    <form noValidate onSubmit={submit} className="grid gap-3">
      <label className="grid gap-1 text-sm font-medium text-text">
        Your note
        <textarea
          rows={5}
          className={textareaClass}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <Checkbox
        label="Set as reminder"
        checked={remind}
        onChange={(e) => setRemind(e.target.checked)}
      />
      {remind ? (
        <Input
          label="Remind me on"
          type="datetime-local"
          value={remindAt}
          onChange={(e) => setRemindAt(e.target.value)}
        />
      ) : null}
      {issue ? (
        <p role="alert" className="text-sm text-danger">
          {issue}
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      ) : null}
      {note ? (
        <p className="text-xs text-muted">
          Saved {when.format(new Date(note.savedAt))}
          {note.reminder?.sentAt ? '. The reminder was sent.' : ''}
        </p>
      ) : null}
      <Button type="submit" className="justify-self-start" disabled={save.isPending}>
        Save Note
      </Button>
    </form>
  );
}
