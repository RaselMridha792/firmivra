'use client';

import type { BookkeepingClientWorkspace } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import { OriginLink } from '../../../../../components/origin-link';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BK_KEY, card, linkBtn, outlined, quiet } from './bookkeeping-shared';
import { AddClientNoteButton, NOTE_TYPE_LABEL } from './client-note-dialog';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Review 2 (N04): the Notes tab opens this client's bookkeeping notes in place (not the client's
 * profile), each with its type, what it is about, who wrote it and when, and that it is internal.
 * Add Note writes one here; every note of the client is a link away.
 */
export function NotesPanel({ w }: { w: BookkeepingClientWorkspace }) {
  const notes = useApiQuery([...BK_KEY, 'notes', w.client.id, w.engagementId], () =>
    api.clientNotes.list(w.client.id, { engagementId: w.engagementId }),
  );
  const items = notes.data ?? [];
  return (
    <section className={card} aria-label="Bookkeeping notes" data-testid="bk-notes">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-heading">Notes</h2>
        <div className="flex flex-wrap items-center gap-3">
          <OriginLink href={`/clients/${w.client.id}/messages`} className={linkBtn}>
            All of {w.client.displayName}&apos;s notes
          </OriginLink>
          <AddClientNoteButton w={w} className={`${outlined} min-h-9`} />
        </div>
      </div>
      {notes.isPending ? (
        <p className={quiet}>Loading notes…</p>
      ) : notes.isError ? (
        <p className={quiet}>The notes could not be loaded. Try again in a moment.</p>
      ) : items.length === 0 ? (
        <p className={quiet}>
          No bookkeeping notes yet. Notes are internal: the client never sees them.
        </p>
      ) : (
        <ol className="flex flex-col">
          {items.map((n) => (
            <li key={n.id} className="border-t border-divider py-3 first:border-t-0">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone="info">{n.noteType ? NOTE_TYPE_LABEL[n.noteType] : 'General'}</Badge>
                {n.related?.kind === 'period' && w.currentPeriod?.id === n.related.id ? (
                  <span>About {w.currentPeriod.label}</span>
                ) : n.related ? (
                  <span>About a {n.related.kind.replace('_', ' ')}</span>
                ) : null}
                <span>Internal (staff only)</span>
              </div>
              <p className="whitespace-pre-line text-sm text-text">{n.body}</p>
              <p className="mt-1 text-xs text-muted">
                {n.author.name} · {when(n.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
