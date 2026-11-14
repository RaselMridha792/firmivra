'use client';

import type { BookkeepingClientWorkspace, NoteType } from '@firmivra/types';
import { Button, Modal, Radio, Select, Textarea } from '@firmivra/ui';
import { Plus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { BK_KEY } from './bookkeeping-shared';

/** Review 2 (N04): the note types, in words. */
export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  GENERAL: 'General',
  CALL: 'Call',
  MEETING: 'Meeting',
  FOLLOW_UP: 'Follow-up',
  DOCUMENT: 'Document',
  BILLING: 'Billing',
};

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
  // Review 2 (N04): what the note is and the record it is about; it stays internal.
  const [noteType, setNoteType] = useState<NoteType>('GENERAL');
  const [aboutPeriod, setAboutPeriod] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setOpen(false);
    setBody('');
    setNoteType('GENERAL');
    setAboutPeriod(false);
    setError(undefined);
  };
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.clientNotes.create(w.client.id, {
        body: body.trim(),
        engagementId: w.engagementId,
        noteType,
        visibility: 'INTERNAL',
        ...(aboutPeriod && w.currentPeriod
          ? { related: { kind: 'period' as const, id: w.currentPeriod.id } }
          : {}),
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
          <div className="flex flex-col gap-3">
            <Select
              label="Note type"
              value={noteType}
              onChange={(e) => setNoteType(e.target.value as NoteType)}
              options={Object.entries(NOTE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            />
            <Select
              label="Related to"
              value={aboutPeriod ? 'period' : ''}
              onChange={(e) => setAboutPeriod(e.target.value === 'period')}
              options={[
                { value: '', label: 'This client’s bookkeeping' },
                ...(w.currentPeriod
                  ? [{ value: 'period', label: `Period: ${w.currentPeriod.label}` }]
                  : []),
              ]}
            />
            <Textarea
              label="Note"
              value={body}
              maxLength={5000}
              onChange={(e) => setBody(e.target.value)}
            />
            <fieldset className="flex flex-col" data-testid="note-visibility">
              <legend className="text-sm font-semibold text-heading">Visibility</legend>
              <Radio name="note-visibility" label="Internal (staff only)" checked readOnly />
              <Radio name="note-visibility" label="Shared with client" disabled />
              <p className="text-xs text-muted">
                Sharing a note with the client is not available yet: every note stays internal.
              </p>
            </fieldset>
          </div>
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
