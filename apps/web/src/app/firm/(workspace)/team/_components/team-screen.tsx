'use client';

import { MembershipRole, type TeamMember } from '@firmivra/types';
import { Badge, Button, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { PageState } from '../../../../../components/page-state';
import { RequireRole } from '../../../../../components/require-role';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { TEAM } from '../../../setup/_components/shared';
import { InviteForm, ROLE_LABELS } from '../../../setup/_components/team-step';

const TEAM_ERRORS: Record<string, string> = {
  LAST_ACTIVE_OWNER: 'The firm needs at least one active owner.',
  CANNOT_CHANGE_SELF: "You can't change your own role or deactivate yourself.",
  NOT_INVITED: 'This person has already joined, so there is no invite to send again.',
  NOT_ACTIVE: 'Only active members can change role. Invite this person again instead.',
};

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });

/**
 * Team: everyone at the firm and open invites. Owners manage everyone; Admins manage Staff and
 * change no roles. Nobody changes themselves. The API checks every rule again.
 */
export function TeamScreen() {
  const { role } = useFirm();
  const team = useApiQuery(TEAM, () => api.team.list());
  const change = useApiMutation(
    ({ id, next }: { id: string; next: MembershipRole }) => api.team.changeRole(id, { role: next }),
    { invalidate: TEAM },
  );
  const resend = useApiMutation((id: string) => api.team.resendInvite(id), { invalidate: TEAM });
  const deactivate = useApiMutation((id: string) => api.team.deactivate(id), { invalidate: TEAM });
  const [leaving, setLeaving] = useState<TeamMember | null>(null);
  const [now] = useState(() => Date.now());
  const error = change.error ?? resend.error ?? deactivate.error;
  const manages = (member: TeamMember) =>
    !member.isYou && (role === 'OWNER' || (role === 'ADMIN' && member.role === 'STAFF'));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Team
        </h1>
        <p className="text-sm text-muted">Who works at your firm, their role, and open invites.</p>
      </div>
      <RequireRole roles={['OWNER', 'ADMIN']}>
        <InviteForm roles={role === 'OWNER' ? ['ADMIN', 'STAFF'] : ['STAFF']} />
      </RequireRole>
      {resend.isSuccess ? (
        <p role="status" className="text-sm text-success">
          Invite sent again.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error, TEAM_ERRORS)}
        </p>
      ) : null}
      <PageState query={team} empty="No one on the team yet">
        {(members) => (
          <ul className="divide-y divide-border rounded-card border border-border bg-surface">
            {members.map((member) => (
              <li
                key={member.id}
                data-testid="team-row"
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-text">
                    {member.user.name}
                    {member.isYou ? ' (you)' : ''}
                  </span>
                  <span className="block break-all text-sm text-muted">{member.user.email}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {role === 'OWNER' && !member.isYou && member.status === 'ACTIVE' ? (
                    <Select
                      label="Role"
                      aria-label={`Role for ${member.user.name}`}
                      className="min-h-11"
                      options={MembershipRole.options.map((value) => ({
                        value,
                        label: ROLE_LABELS[value],
                      }))}
                      value={member.role}
                      disabled={change.isPending}
                      onChange={(event) =>
                        change.mutate({
                          id: member.id,
                          next: MembershipRole.parse(event.target.value),
                        })
                      }
                    />
                  ) : (
                    <Badge tone="info">{ROLE_LABELS[member.role]}</Badge>
                  )}
                  <StatusBadge member={member} now={now} />
                  {manages(member) && member.status === 'INVITED' && member.role !== 'OWNER' ? (
                    <Button variant="ghost" onClick={() => resend.mutate(member.id)}>
                      Resend invite
                    </Button>
                  ) : null}
                  {manages(member) && member.status !== 'DEACTIVATED' ? (
                    <Button variant="ghost" onClick={() => setLeaving(member)}>
                      Deactivate
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      <Modal
        open={leaving !== null}
        title={`Deactivate ${leaving?.user.name ?? ''}?`}
        onClose={() => setLeaving(null)}
      >
        <p className="text-sm text-muted">
          They lose access to the firm workspace at once. You can invite them again later.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setLeaving(null)}>
            Cancel
          </Button>
          <Button
            disabled={deactivate.isPending}
            onClick={() =>
              leaving && deactivate.mutate(leaving.id, { onSuccess: () => setLeaving(null) })
            }
          >
            Deactivate
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function StatusBadge({ member, now }: { member: TeamMember; now: number }) {
  if (member.status === 'ACTIVE') return <Badge tone="success">Active</Badge>;
  if (member.status === 'DEACTIVATED') return <Badge>Deactivated</Badge>;
  const expires = member.invite?.expiresAt;
  if (expires && Date.parse(expires) < now) return <Badge tone="danger">Invite expired</Badge>;
  return <Badge tone="warning">Invited{expires ? `, until ${dateText(expires)}` : ''}</Badge>;
}
