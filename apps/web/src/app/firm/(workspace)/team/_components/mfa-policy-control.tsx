'use client';

import { ApiRequestError } from '@firmivra/types';
import { Badge, Button, Input, Modal, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';

// SM14 part C, SEC-6: the firm's two-factor requirement and the control that changes it, for
// Settings > Security's MFA card. Self-contained (R55's piece of that card). Only an Owner or a
// security administrator sees the change control; it asks for the current password (a fresh
// sign-in) and a confirm, and turning it off records the approved exception. Staff sign-in still
// asks every login for a code: the card says so.

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function ChangeRequirement({ required, onClose }: { required: boolean; onClose: () => void }) {
  const [next, setNext] = useState(!required);
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [noteError, setNoteError] = useState('');
  const save = useApiMutation(
    () =>
      api.mfaPolicy.update({
        required: next,
        ...(next ? {} : { note: note.trim() }),
        currentPassword: password,
        confirm: true,
      }),
    { invalidate: ['mfa-policy'] },
  );
  const field = save.error instanceof ApiRequestError ? save.error.details?.[0] : undefined;
  const passwordError = field?.path === 'currentPassword' ? field.message : undefined;
  const failed =
    save.error && !passwordError
      ? errorMessage(save.error, {
          FORBIDDEN: 'Only an Owner or a security administrator can change this.',
          RATE_LIMITED: 'Too many tries. Wait 15 minutes, then try again.',
        })
      : '';
  const submit = () => {
    if (!next && !note.trim()) {
      setNoteError('Write the approved exception: why, and who approved it');
      return;
    }
    setNoteError('');
    save.mutate(undefined, { onSuccess: onClose });
  };
  return (
    <Modal
      open
      title="Change the two-factor requirement"
      subtitle="Enter your current password to confirm it's you. The change is recorded in the audit log."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending || !password || !confirmed}>
            {save.isPending ? 'Saving…' : 'Save Requirement'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-heading">Two-factor sign-in</legend>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="radio" name="mfa" checked={next} onChange={() => setNext(true)} />
            Required for every staff account
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="radio" name="mfa" checked={!next} onChange={() => setNext(false)} />
            Not required (an approved exception)
          </label>
        </fieldset>
        {!next ? (
          <Textarea
            label="Approved exception (why, and who approved it)"
            value={note}
            maxLength={1000}
            rows={3}
            error={noteError}
            onChange={(e) => setNote(e.target.value)}
          />
        ) : null}
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={passwordError}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I confirm this change to the firm&apos;s security policy.
        </label>
        <p className="text-xs text-muted">
          Firmivra&apos;s sign-in still asks every staff login for a code; the firm&apos;s record
          shows the approved exception.
        </p>
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {failed}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** The requirement, its exception when off, and the change control for whoever may change it. */
export function MfaPolicyControl() {
  const policy = useApiQuery(['mfa-policy'], () => api.mfaPolicy.get());
  const [changing, setChanging] = useState(false);
  const p = policy.data;
  if (!p) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="mfa-policy-control">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-heading">Firm requirement:</span>
        {p.required ? (
          <Badge tone="success">Required</Badge>
        ) : (
          <Badge tone="warning">Approved exception</Badge>
        )}
      </div>
      {p.exception ? (
        <p className="text-sm text-text" data-testid="mfa-exception">
          {p.exception.note}
          <span className="block text-xs text-muted">
            Recorded {when(p.exception.at)}
            {p.exception.approvedBy ? ` by ${p.exception.approvedBy.name}` : ''}. Sign-in still asks
            for a code.
          </span>
        </p>
      ) : null}
      {p.canChange ? (
        <Button variant="secondary" className="w-fit" onClick={() => setChanging(true)}>
          Change Requirement
        </Button>
      ) : (
        <p className="text-xs text-muted">
          Only the Owner, or an Admin the Owner made a security administrator, may change this.
        </p>
      )}
      {changing ? (
        <ChangeRequirement required={p.required} onClose={() => setChanging(false)} />
      ) : null}
    </div>
  );
}
