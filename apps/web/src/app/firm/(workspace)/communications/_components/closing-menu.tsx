'use client';

import { ActionMenu, type ActionMenuItem, Button, Modal, RichTextEditor } from '@firmivra/ui';
import { Signature } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { COMM_KEY, plain } from './communications-shared';

// CM-F11 (an approved addition): a reusable closing put into the message, from the stores that
// already exist (MSG-F02): the firm's signature, which an Owner or Admin sets in Messages
// Settings, and the member's own, which they save here or in the email composer. It is text and
// formatting only, not FirmSign and not a legal signature, and it sends nothing on its own.

const MY_SIGNATURE_KEY = [...COMM_KEY, 'my-signature'] as const;
const SIGNATURE_ERRORS: Record<string, string> = {
  SIGNATURE_EMPTY: 'Write a signature first.',
  SIGNATURE_TOO_LONG: 'The signature is too long to save. Shorten it.',
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The firm's signature is plain text: its lines become one paragraph. */
const firmHtml = (text: string) => `<p>${escapeHtml(text.trim()).replace(/\n/g, '<br>')}</p>`;

/**
 * Insert Closing beside a message's content: the firm's signature or the member's own, added at
 * the end (as text for an SMS), and Edit My Signature.
 */
export function ClosingMenu({
  channel,
  disabled,
  onInsert,
  onNotice,
}: {
  channel: 'EMAIL' | 'SMS' | 'ANNOUNCEMENT';
  disabled?: boolean;
  /** The closing to add at the end: HTML for a rich message, text for an SMS. */
  onInsert: (closing: string) => void;
  onNotice: (text: string, tone: 'success' | 'error') => void;
}) {
  const settings = useApiQuery([...COMM_KEY, 'message-settings'], () => api.messages.settings());
  const mine = useApiQuery(MY_SIGNATURE_KEY, () => api.leadPipeline.signature());
  const [editing, setEditing] = useState(false);
  const firm = settings.data?.signature?.trim() || null;
  const own = mine.data?.html ?? null;
  const sms = channel === 'SMS';
  // Still loading: say so, never "None yet" for a signature that may exist.
  const loading = (label: string): ActionMenuItem => ({
    label,
    restricted: 'Loading…',
    onSelect: () => onNotice('Still loading the signatures. Try again in a moment.', 'error'),
  });
  const items: ActionMenuItem[] = [
    settings.isPending
      ? loading('Firm signature')
      : firm
        ? {
            label: 'Firm signature',
            onSelect: () => onInsert(sms ? firm : firmHtml(firm)),
          }
        : {
            label: 'Firm signature',
            restricted: 'None yet',
            onSelect: () =>
              onNotice(
                'There is no firm signature yet. An Owner or Admin sets it in Messages Settings.',
                'error',
              ),
          },
    mine.isPending
      ? loading('My signature')
      : own
        ? {
            label: 'My signature',
            onSelect: () => onInsert(sms ? plain(own).trim() : own),
          }
        : {
            label: 'My signature',
            restricted: 'None yet',
            onSelect: () => onNotice('Save your own signature first: Edit My Signature.', 'error'),
          },
    { label: 'Edit My Signature…', onSelect: () => setEditing(true) },
  ];
  return (
    <>
      <div data-testid="closing-menu">
        {disabled ? null : (
          <ActionMenu
            label="Insert Closing"
            trigger={
              <span className="inline-flex items-center gap-1 text-sm font-medium text-link">
                <Signature aria-hidden weight="bold" className="size-4" /> Insert Closing
              </span>
            }
            sections={[{ items }]}
          />
        )}
      </div>
      {editing ? (
        <MySignatureDialog
          initial={own ?? ''}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onNotice('Your signature is saved. Insert it from Insert Closing.', 'success');
          }}
        />
      ) : null}
    </>
  );
}

function MySignatureDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [html, setHtml] = useState(initial);
  const save = useApiMutation((body: string) => api.leadPipeline.saveSignature({ html: body }), {
    invalidate: [...MY_SIGNATURE_KEY],
  });
  return (
    <Modal
      open
      title="My Signature"
      subtitle="Your own closing: text and formatting only, not a legal signature."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate(html, { onSuccess: onSaved })}
          >
            Save Signature
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" data-testid="my-signature">
        <RichTextEditor
          label="Signature"
          value={html}
          onChange={setHtml}
          maxLength={1_000}
          noLinks
        />
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, SIGNATURE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
