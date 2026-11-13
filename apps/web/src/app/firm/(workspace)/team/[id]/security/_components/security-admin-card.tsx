'use client';

import type { StaffDetail } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { ShieldStar } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { Panel } from './panel';

/**
 * SM14 part C, SEC-6: an Admin's security administration. A security administrator may change the
 * firm's two-factor requirement (Settings > Security). Owner-level grants and takes it away, after a
 * confirm; never their own, never anyone but an Admin.
 */
export function SecurityAdminCard({ member }: { member: StaffDetail }) {
  const state = useApiQuery(['staff', 'security-admin', member.id], () =>
    api.mfaPolicy.securityAdmin(member.id),
  );
  const [asking, setAsking] = useState(false);
  const set = useApiMutation(
    (value: boolean) =>
      api.mfaPolicy.setSecurityAdmin(member.id, { securityAdmin: value, confirm: true }),
    { invalidate: ['staff', 'security-admin', member.id] },
  );
  if (member.role !== 'ADMIN' || !state.data) return null;
  const on = state.data.securityAdmin;
  return (
    <Panel
      title="Security Administrator"
      subtitle="May change the firm's two-factor requirement in Settings > Security."
      icon={ShieldStar}
      testId="security-admin"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span data-testid="security-admin-state" className="font-semibold text-heading">
          {on ? 'Yes' : 'No'}
        </span>
        {state.data.canChange ? (
          <Button variant="secondary" onClick={() => setAsking(true)} disabled={set.isPending}>
            {on ? 'Remove Security Administrator' : 'Make Security Administrator'}
          </Button>
        ) : (
          <span className="text-xs text-muted">Only an Owner can change this.</span>
        )}
      </div>
      {set.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(set.error)}
        </p>
      ) : null}
      {asking ? (
        <Modal
          open
          title={on ? 'Remove security administrator?' : 'Make security administrator?'}
          subtitle={
            on
              ? `${member.name} will no longer be able to change the two-factor requirement.`
              : `${member.name} will be able to change the firm's two-factor requirement.`
          }
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button
                disabled={set.isPending}
                onClick={() => set.mutate(!on, { onSuccess: () => setAsking(false) })}
              >
                {on ? 'Remove' : 'Confirm'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">The change is recorded in the audit log.</p>
        </Modal>
      ) : null}
    </Panel>
  );
}
