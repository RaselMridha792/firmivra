'use client';

import type { LibraryDocument } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { VIEW_HELP } from './folders-panel';

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

/**
 * Bookkeeping Review 2 (plain-language Documents messages): the chosen client's archived or
 * trashed documents, from the Documents library (its Archived and Trash scopes), each with the
 * day it was archived or trashed and the way back: Restore, or Restore from Trash (the Delete
 * permission). The library answers for anything the member may not do.
 */
export function KeptDocuments({
  view,
  clientId,
  clientName,
  onBack,
}: {
  view: 'archived' | 'trash';
  clientId: string;
  clientName: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const list = useApiQuery(['documents', 'kept', view, clientId, page], () =>
    api.documentLibrary.list({ scope: view, clientId, page, pageSize: 25 }),
  );
  const restore = async (d: LibraryDocument) => {
    try {
      if (view === 'trash') await api.documentLibrary.untrash(d.id);
      else await api.documentLibrary.restore(d.id);
      await qc.invalidateQueries({ queryKey: ['documents'] });
      setNote({ tone: 'ok', text: `${d.fileName} is back in ${clientName}’s documents.` });
    } catch (e) {
      setNote({ tone: 'error', text: errorMessage(e) });
    }
  };
  const items = list.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));
  const title = view === 'trash' ? 'Trash' : 'Archived';
  return (
    <section className="flex flex-col gap-3" aria-label={title} data-testid={`kept-${view}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-heading">
            {title}: {clientName}
          </h2>
          <p className="text-sm text-muted" data-testid="kept-help">
            {VIEW_HELP[view]}
          </p>
        </div>
        <Button variant="secondary" onClick={onBack}>
          Back to documents
        </Button>
      </div>
      {note ? (
        <p
          role={note.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${note.tone === 'error' ? 'text-danger' : 'text-success'}`}
        >
          {note.text}
        </p>
      ) : null}
      {list.isPending ? (
        <p className="py-6 text-center text-sm text-muted">Loading…</p>
      ) : list.isError ? (
        <p className="py-6 text-center text-sm text-danger" role="alert">
          These documents couldn&apos;t be loaded.
        </p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {view === 'trash'
            ? `Nothing of ${clientName}’s is in the Trash.`
            : `${clientName} has no archived documents.`}
        </p>
      ) : (
        <ul className="divide-y divide-divider" aria-label={`${title} documents`}>
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link
                href={`/documents/${d.id}`}
                className="min-w-40 flex-1 font-semibold break-words text-link hover:underline"
              >
                {d.fileName}
              </Link>
              <span className="text-muted">{d.service.title}</span>
              <span className="text-muted">
                {view === 'trash' ? 'Moved to Trash' : 'Archived'}{' '}
                {when(view === 'trash' ? d.trashedAt : d.archivedAt)}
              </span>
              <Button
                variant="secondary"
                aria-label={`${view === 'trash' ? 'Restore from Trash' : 'Restore'}: ${d.fileName}`}
                onClick={() => void restore(d)}
              >
                {view === 'trash' ? 'Restore from Trash' : 'Restore'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </section>
  );
}
