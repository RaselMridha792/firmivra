'use client';

import {
  FIRM_ROLE_LABELS,
  type FirmUser,
  type MembershipRole,
  ROLES_MANAGED_BY,
} from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { MEMBER_ERRORS } from '../../../team/[id]/_components/staff-parts';

export type BulkAction = 'resend' | 'deactivate';

/** Why a selected person is left out of a bulk action, or null when they are in. */
export function skipReason(
  action: BulkAction,
  u: FirmUser,
  me: MembershipRole | undefined,
): string | null {
  if (u.isYou) return 'That is you';
  if (u.role === 'OWNER') return 'The Owner';
  if (!me || !ROLES_MANAGED_BY[me].includes(u.role))
    return `You do not manage ${FIRM_ROLE_LABELS[u.role]}s`;
  if (action === 'resend') return u.status === 'INVITED' ? null : 'Not a pending invitation';
  return u.status === 'DEACTIVATED' ? 'Already inactive' : null;
}

const LOOKS = {
  resend: {
    title: 'Resend Invitations',
    what: 'Each person below gets a fresh invitation email; the links sent before stop working.',
    confirm: 'Resend Invitations',
    run: (id: string) => api.staff.resendInvite(id),
  },
  deactivate: {
    title: 'Deactivate Selected',
    what: 'Each person below can no longer sign in and is signed out everywhere. Their clients, tasks and history stay, and you can reactivate them later.',
    confirm: 'Deactivate',
    run: (id: string) => api.staff.deactivate(id, { reason: null, confirm: true }),
  },
} as const;

type Outcome = { user: FirmUser; ok: boolean; message?: string };

/**
 * Resend Invitations and Deactivate Selected (Octavia's review, section 11, bulk actions): who is
 * affected and who is left out (and why) before anything is sent, then one person at a time with
 * a result for each; Retry runs the failed ones only. Every person's action is its own Staff
 * route and audit row.
 */
export function BulkDialog({
  action,
  users,
  me,
  onClose,
  onFinished,
}: {
  action: BulkAction;
  users: FirmUser[];
  me: MembershipRole | undefined;
  onClose: () => void;
  onFinished: () => void;
}) {
  const queryClient = useQueryClient();
  const look = LOOKS[action];
  const eligible = users.filter((u) => !skipReason(action, u, me));
  const skipped = users.filter((u) => skipReason(action, u, me));
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [busy, setBusy] = useState(false);
  const failed = outcomes.filter((o) => !o.ok).map((o) => o.user);
  const finished = outcomes.length > 0 && !busy;

  const run = async (people: FirmUser[]) => {
    setBusy(true);
    const done: Outcome[] = outcomes.filter((o) => o.ok);
    for (const user of people) {
      try {
        await look.run(user.id);
        done.push({ user, ok: true });
      } catch (e) {
        done.push({ user, ok: false, message: errorMessage(e, MEMBER_ERRORS) });
      }
      setOutcomes([...done]);
    }
    await queryClient.invalidateQueries({ queryKey: ['users'] });
    await queryClient.invalidateQueries({ queryKey: ['staff'] });
    setBusy(false);
  };

  return (
    <Modal open title={look.title} onClose={finished ? onFinished : onClose}>
      <div className="flex flex-col gap-4 text-sm" data-testid={`bulk-${action}`}>
        {!outcomes.length ? (
          <>
            <p className="text-text">{look.what}</p>
            <section aria-label="Affected">
              <h3 className="font-semibold text-heading">
                {eligible.length} {eligible.length === 1 ? 'person' : 'people'}
              </h3>
              {eligible.length ? (
                <ul className="max-h-40 overflow-y-auto rounded-lg bg-canvas px-3 py-2">
                  {eligible.map((u) => (
                    <li key={u.id}>
                      {u.name} <span className="text-muted">({u.email})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Nobody selected can be included.</p>
              )}
            </section>
            {skipped.length ? (
              <section aria-label="Left out">
                <h3 className="font-semibold text-heading">Left out ({skipped.length})</h3>
                <ul className="max-h-32 overflow-y-auto rounded-lg bg-canvas px-3 py-2 text-muted">
                  {skipped.map((u) => (
                    <li key={u.id}>
                      {u.name}: {skipReason(action, u, me)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <section aria-label="Results">
            <h3 className="font-semibold text-heading">
              {busy
                ? 'Working…'
                : `${outcomes.filter((o) => o.ok).length} done, ${failed.length} failed${skipped.length ? `, ${skipped.length} left out` : ''}`}
            </h3>
            <ul className="max-h-56 overflow-y-auto rounded-lg bg-canvas px-3 py-2">
              {outcomes.map((o) => (
                <li key={o.user.id} className={o.ok ? 'text-success' : 'text-danger'}>
                  {o.user.name}: {o.ok ? 'Done' : `Failed. ${o.message ?? ''}`}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="flex justify-end gap-3">
          {finished ? (
            <>
              {failed.length ? (
                <Button variant="outline" onClick={() => void run(failed)}>
                  Retry Failed ({failed.length})
                </Button>
              ) : null}
              <Button onClick={onFinished}>Close</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button disabled={!eligible.length || busy} onClick={() => void run(eligible)}>
                {busy ? 'Working…' : `${look.confirm} (${eligible.length})`}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
