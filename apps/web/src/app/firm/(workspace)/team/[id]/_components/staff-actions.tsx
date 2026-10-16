'use client';

import type { StaffActionResult } from '@firmivra/types';
import { Button, Modal, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { MEMBER_ERRORS } from './staff-parts';

/** The high-risk actions that ask first: an optional reason and a confirm (the contract's). */
export type StaffAction = 'resetPassword' | 'resetMfa' | 'signOutAll' | 'deactivate' | 'delete';

const signedOut = (n: number) => (n ? ` ${n} session${n === 1 ? '' : 's'} signed out.` : '');

const ACTIONS: Record<
  StaffAction,
  {
    title: string;
    body: (name: string) => string;
    confirm: string;
    danger?: boolean;
    done: (name: string, r: StaffActionResult) => string;
  }
> = {
  resetPassword: {
    title: 'Reset Password',
    body: (name) =>
      `${name} gets an email with a secure link to choose a new password. Nobody sees or sets a password here, and their open sessions are signed out.`,
    confirm: 'Send Reset Link',
    done: (name, r) => `A secure reset link was emailed to ${name}.${signedOut(r.sessionsRevoked)}`,
  },
  resetMfa: {
    title: 'Reset MFA',
    body: (name) =>
      `${name} sets up two-factor sign-in again the next time they sign in. Their open sessions are signed out. Use this when they lost their device.`,
    confirm: 'Reset MFA',
    danger: true,
    done: (name, r) =>
      `${name} sets up two-factor sign-in again at their next sign-in.${signedOut(r.sessionsRevoked)}`,
  },
  signOutAll: {
    title: 'Sign Out All Sessions',
    body: (name) => `${name} is signed out on every browser and device and signs in again.`,
    confirm: 'Sign Out All',
    done: (_name, r) =>
      r.sessionsRevoked ? signedOut(r.sessionsRevoked).trim() : 'There were no open sessions.',
  },
  deactivate: {
    title: 'Deactivate Account',
    body: (name) =>
      `${name} can no longer sign in and is signed out everywhere. Their clients, tasks and history stay, and you can reactivate the account later.`,
    confirm: 'Deactivate Account',
    danger: true,
    done: (name, r) =>
      `${name}’s access has ended. Their history is kept.${signedOut(r.sessionsRevoked)}`,
  },
  delete: {
    title: 'Delete Account',
    body: (name) =>
      `Staff accounts are never deleted, so the firm keeps their history (guide §12). Deactivating ends ${name}’s access instead, and you can reactivate it later.`,
    confirm: 'Deactivate Instead',
    danger: true,
    done: (name, r) =>
      `${name}’s access has ended. Their history is kept.${signedOut(r.sessionsRevoked)}`,
  },
};

const CALLS: Record<
  StaffAction,
  (id: string, body: { reason?: string | null; confirm: true }) => Promise<StaffActionResult>
> = {
  resetPassword: (id, body) => api.staff.resetPassword(id, body),
  resetMfa: (id, body) => api.staff.resetMfa(id, body),
  signOutAll: (id, body) => api.staff.signOutAll(id, body),
  deactivate: (id, body) => api.staff.deactivate(id, body),
  delete: (id, body) => api.staff.deactivate(id, body),
};

/** Asks before a high-risk action, sends it with the reason, and says what happened. */
export function ActionModal({
  action,
  id,
  name,
  onClose,
  onDone,
}: {
  action: StaffAction;
  id: string;
  name: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const look = ACTIONS[action];
  const [reason, setReason] = useState('');
  const run = useApiMutation(
    (why: string) => CALLS[action](id, { reason: why.trim() || null, confirm: true }),
    { invalidate: ['staff'] },
  );
  return (
    <Modal open title={look.title} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          run.mutate(reason, { onSuccess: (r) => onDone(look.done(name, r)) });
        }}
      >
        <p className="text-sm text-text">{look.body(name)}</p>
        <Textarea
          label="Reason (optional)"
          maxLength={500}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {run.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(run.error, MEMBER_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={run.isPending}
            className={look.danger ? 'bg-danger text-on-action hover:bg-danger' : ''}
          >
            {look.confirm}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
