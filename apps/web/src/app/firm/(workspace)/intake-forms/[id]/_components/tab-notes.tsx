'use client';

import { Avatar, Button, Textarea } from '@firmivra/ui';
import { NotePencil } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { InfoCard } from './detail-cards';
import { useDetail } from './detail-frame';
import { DETAIL_KEY, Quiet, stamp } from './detail-shared';

/** Notes tab: the firm's internal notes on this submission (never shown to the client). */
export function NotesTab() {
  const { id, record, loading } = useDetail();
  const [text, setText] = useState('');
  const add = useApiMutation(() => api.intakeForms.addNote(id, { text: text.trim() }), {
    invalidate: DETAIL_KEY as unknown as string[],
  });
  const notes = [...(record?.notes ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <InfoCard icon={NotePencil} tone="amber" title="Internal Notes" edit={false} testId="notes">
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
      {notes.length === 0 ? (
        <Quiet>
          {loading ? 'Loading…' : record ? 'No notes yet.' : 'Notes are not available right now.'}
        </Quiet>
      ) : (
        <ul className="flex flex-col divide-y divide-divider" data-testid="note-list">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-3 py-3">
              <Avatar name={n.by?.name ?? 'System'} size="lg" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-semibold text-heading">
                  {n.by?.name ?? 'System'}{' '}
                  <span className="font-normal text-muted">· {stamp(n.at)}</span>
                </p>
                <p className="whitespace-pre-line text-sm text-text">{n.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}
