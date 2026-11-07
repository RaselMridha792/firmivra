'use client';

import type { BookkeepingClientWorkspace } from '@firmivra/types';
import { Button, Modal, Textarea } from '@firmivra/ui';
import { Plus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { BK_KEY } from './bookkeeping-shared';

/**
 * BK-NAV (Octavia's Oct 25 review): Add Note opens here, on the client's own notes, and the note
 * is internal (the firm's only; the portal never shows it), filed under this Bookkeeping service.
 * The workspace stays where it was; View All still opens the client's notes.
 */
export function AddClientNoteButton({
  w,
  className,
}: {
  w: BookkeepingClientWorkspace;
  className: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    setBody('');
    setError(undefined);
  };
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.clientNotes.create(w.client.id, {
        body: body.trim(),
        engagementId: w.engagementId,
      });
      await qc.invalidateQueries({ queryKey: [...BK_KEY] });
      setSaved(true);
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setSaved(false);
          setOpen(true);
        }}
      >
        <Plus aria-hidden weight="bold" className="size-4" /> Add Note
      </button>
      {saved ? (
        <p role="status" className="mt-2 text-xs text-success" data-testid="note-saved">
          Note added. It is internal: the client never sees it.
        </p>
      ) : null}
      {open ? (
        <Modal
          open
          title="Add Note"
          subtitle={`${w.client.displayName} · internal, firm only`}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button disabled={busy || !body.trim()} onClick={() => void save()}>
                Save Note
              </Button>
            </>
          }
        >
          <Textarea
            label="Note (firm only)"
            value={body}
            maxLength={5000}
            onChange={(e) => setBody(e.target.value)}
          />
          {error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
