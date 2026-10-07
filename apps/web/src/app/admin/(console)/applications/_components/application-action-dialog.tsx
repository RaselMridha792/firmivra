'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@firmivra/ui';
import type { ApplicationAction } from './application-data';

const copy = {
  Approve: { title: 'Approve application?', confirm: 'Confirm approval', hint: '' },
  'Request Information': {
    title: 'Request information',
    confirm: 'Send request',
    hint: 'Message for the applicant',
  },
  Decline: {
    title: 'Decline application?',
    confirm: 'Confirm decline',
    hint: 'Reason for declining',
  },
};

export function ApplicationActionDialog({
  action,
  onClose,
  onConfirm,
}: {
  action: ApplicationAction;
  onClose: () => void;
  onConfirm: (detail: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = copy[action];
  const needsDetail = action !== 'Approve';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (needsDetail && !detail.trim())) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(detail.trim());
    } catch {
      setError('The action could not be completed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/60 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="application-action-title"
        className="w-full max-w-lg rounded-card bg-surface p-6 shadow-card"
      >
        <h2 id="application-action-title" className="text-xl font-semibold text-text">
          {text.title}
        </h2>
        <p className="mt-2 text-sm text-muted">
          {action === 'Approve'
            ? 'This will mark the application as approved.'
            : action === 'Decline'
              ? 'Provide a reason to record with this application.'
              : 'Write the message that will be sent to the applicant.'}
        </p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {needsDetail ? (
            <label className="flex flex-col gap-1 text-sm font-medium text-text">
              {text.hint}
              <textarea
                autoFocus
                required
                rows={4}
                maxLength={1000}
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                className="rounded-control border border-border bg-surface p-3 font-normal focus:outline-2 focus:outline-accent-500"
              />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || (needsDetail && !detail.trim())}>
              {busy ? 'Submitting…' : text.confirm}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
