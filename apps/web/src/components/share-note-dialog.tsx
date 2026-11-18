'use client';

import { type InternalNote, SHARED_NOTE_SUBJECT } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';

/** BK-CP4: a Bookkeeping service whose Portal Defaults keep notes out of the portal. */
const SHARE_ERRORS = {
  NOTES_HIDDEN_IN_PORTAL:
    "This client's Portal Defaults keep notes out of the portal. Turn Notes on in the client's bookkeeping Settings first.",
};

/**
 * B32 (Client Portal Review One, decision 5 option B): Share with Client. The member sees exactly
 * what will go (the message's subject and the note's text, as saved) and confirms; the text then
 * goes to the client as a new message in their portal. The note itself stays internal, and
 * nothing is sent until Share with Client is pressed. A note changed since it was opened is
 * refused (NOTE_CHANGED): the member opens it again to see the new text.
 */
export function ShareNoteDialog({
  note,
  clientName,
  onClose,
  onShared,
}: {
  note: Pick<InternalNote, 'id' | 'body' | 'updatedAt'>;
  clientName: string;
  onClose: () => void;
  onShared: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const share = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.clientNotes.share(note.id, { updatedAt: note.updatedAt });
      await onShared();
    } catch (e) {
      setError(errorMessage(e, SHARE_ERRORS));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Share with Client"
      subtitle={`${clientName} · sent as a message in their client portal`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void share()}>
            {busy ? 'Sharing…' : 'Share with Client'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text">
          The client gets exactly this text as a new message in their portal. The note itself stays
          internal.
        </p>
        <dl
          className="flex flex-col gap-2 rounded-lg border border-divider bg-canvas p-3"
          data-testid="share-preview"
        >
          <div>
            <dt className="text-xs font-semibold text-muted">Subject</dt>
            <dd className="text-sm text-heading">{SHARED_NOTE_SUBJECT}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted">Message</dt>
            <dd className="text-sm whitespace-pre-wrap text-text" data-testid="share-text">
              {note.body}
            </dd>
          </div>
        </dl>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
