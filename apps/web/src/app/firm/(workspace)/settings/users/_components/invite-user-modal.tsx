'use client';

import { InviteUserRequest, type MembershipRole } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

const INVITE_ERRORS: Record<string, string> = {
  DUPLICATE_EMAIL: 'This email already belongs to a member or an open invitation.',
  CANNOT_GRANT: 'You cannot give this role.',
  FORBIDDEN: 'Only an Owner or an Admin can invite users.',
};

/**
 * Invite User (users-and-role.jpg, guide §7): name, email and role; the person gets a secure,
 * time-limited activation link and two-factor sign-in is always required. For everything else
 * (departments, security, details) Create Staff is linked.
 */
export function InviteUserModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const roles = (options.data?.roles ?? []).filter((r) => r.role !== 'OWNER');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole | ''>('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const invite = useApiMutation(
    (body: Parameters<typeof api.users.invite>[0]) => api.users.invite(body),
    { invalidate: ['users'] },
  );
  return (
    <Modal open title="Invite User" onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const body = { name: name.trim(), email: email.trim(), role };
          const result = InviteUserRequest.safeParse(body);
          const found: Record<string, string> = {};
          if (!result.success) {
            for (const issue of result.error.issues) {
              const field = String(issue.path[0] ?? '');
              found[field] ??=
                field === 'name'
                  ? 'Enter their name.'
                  : field === 'email'
                    ? 'Enter a valid work email.'
                    : 'Choose a role.';
            }
          }
          setErrors(found);
          if (!result.success) return;
          invite.mutate(result.data, {
            onSuccess: (r) =>
              onDone(
                r.invitation.status === 'SENT'
                  ? `Invitation sent to ${r.user.name}.`
                  : `${r.user.name} was added. The invitation did not go out; use Resend Invitation.`,
              ),
          });
        }}
      >
        <Input
          label="Name *"
          autoComplete="off"
          maxLength={120}
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          label="Work Email *"
          type="email"
          autoComplete="off"
          value={email}
          error={errors.email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Select
          label="Role *"
          options={[
            { value: '', label: 'Select a role' },
            ...roles.map((r) => ({ value: r.role, label: r.label })),
          ]}
          value={role}
          error={errors.role}
          onChange={(event) => setRole(event.target.value as MembershipRole | '')}
        />
        <p className="text-xs text-muted">
          They get a secure, time-limited link to set their own password; two-factor sign-in is
          always required. Use Create Staff to add their department, security and details too.
        </p>
        {invite.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(invite.error, INVITE_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={invite.isPending}>
            Send Invitation
          </Button>
        </div>
      </form>
    </Modal>
  );
}
