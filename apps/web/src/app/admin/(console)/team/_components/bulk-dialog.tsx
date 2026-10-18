'use client';

import { Warning } from '@phosphor-icons/react';
import { Button, Callout, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  adminTeam,
  type AdminTeamMember,
  AUTHORITY_LEVELS,
  type BulkChange,
  type BulkResult,
  MEMBER_STATUSES,
  type MemberStatus,
  TEAM_ERROR_MESSAGES,
} from '../../../../../mocks/admin-team';
import { members as countText, TEAM_KEY } from './team-parts';

export type BulkKind = 'department' | 'role' | 'status' | 'remove';

const TITLES: Record<BulkKind, string> = {
  department: 'Change Department',
  role: 'Change Role',
  status: 'Change Status',
  remove: 'Remove from Team',
};

const STATUS_CHOICES: MemberStatus[] = ['ACTIVE', 'SUSPENDED', 'INACTIVE', 'DEACTIVATED'];

/** "Updated 2 team members. Skipped Morgan Admin (You can't change yourself)." */
export function bulkSummary(result: BulkResult, done: string): string {
  const skipped = result.skipped.map((entry) => `${entry.name} (${entry.reason})`).join(', ');
  return `${done} ${countText(result.updated)}.${skipped ? ` Skipped ${skipped}.` : ''}`;
}

/** Change department, role or status, or remove, for the selected people (or one person). */
export function BulkDialog({
  kind,
  people,
  initialStatus,
  onClose,
  onDone,
}: {
  kind: BulkKind;
  people: AdminTeamMember[];
  /** Suspend and Reactivate from a member's menu start on that status. */
  initialStatus?: MemberStatus;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const options = useApiQuery([...TEAM_KEY, 'form-options'], () => adminTeam.formOptions());
  const [departmentId, setDepartmentId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState<MemberStatus | ''>(
    initialStatus ?? (kind === 'remove' ? 'DEACTIVATED' : ''),
  );
  const [problem, setProblem] = useState('');
  const ids = people.map((member) => member.id);
  const save = useApiMutation((change: BulkChange) => adminTeam.bulkUpdate(ids, change), {
    invalidate: TEAM_KEY,
  });
  const departments = [...new Set(people.map((member) => member.departmentId))];
  const roleDepartment =
    kind === 'role' ? (departments.length === 1 ? departments[0] : '') : departmentId;
  const roles = (options.data?.roles ?? []).filter((role) => role.departmentId === roleDepartment);
  const names = people.map((member) => member.name).join(', ');

  function apply() {
    let change: BulkChange | null = null;
    if (kind === 'department') {
      if (!departmentId || !roleId) return setProblem('Choose a department and a role.');
      change = { kind: 'department', departmentId, roleId };
    } else if (kind === 'role') {
      if (!roleId) return setProblem('Choose a role.');
      change = { kind: 'role', roleId };
    } else {
      if (!status) return setProblem('Choose a status.');
      change = { kind: 'status', status };
    }
    setProblem('');
    save.mutate(change, {
      onSuccess: (result) => {
        onDone(bulkSummary(result, kind === 'remove' ? 'Removed' : 'Updated'));
        onClose();
      },
    });
  }

  const roleSelect = (
    <Select
      label="Role *"
      value={roleId}
      disabled={!roleDepartment}
      onChange={(event) => setRoleId(event.target.value)}
      options={[
        { value: '', label: roleDepartment ? 'Select a role' : 'Select a department first' },
        ...roles.map((role) => ({
          value: role.id,
          label: `${role.title} (${AUTHORITY_LEVELS[role.level]})${role.needsApproval ? ', needs approval' : ''}`,
        })),
      ]}
    />
  );

  return (
    <Modal
      open
      title={TITLES[kind]}
      subtitle={`${countText(people.length)} selected: ${names}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || (kind === 'role' && !roleDepartment)} onClick={apply}>
            {kind === 'remove' ? 'Remove' : 'Apply'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {kind === 'department' ? (
          <>
            <Select
              label="Department *"
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setRoleId('');
              }}
              options={[
                { value: '', label: 'Select a department' },
                ...(options.data?.departments ?? []).map(({ id, name }) => ({
                  value: id,
                  label: name,
                })),
              ]}
            />
            {roleSelect}
          </>
        ) : null}
        {kind === 'role' ? (
          roleDepartment ? (
            roleSelect
          ) : (
            <p className="text-sm text-muted">
              These people are in different departments. Choose people from one department to change
              their role together.
            </p>
          )
        ) : null}
        {kind === 'status' ? (
          <Select
            label="Status *"
            value={status}
            onChange={(event) => setStatus(event.target.value as MemberStatus)}
            options={[
              { value: '', label: 'Select a status' },
              ...STATUS_CHOICES.map((value) => ({ value, label: MEMBER_STATUSES[value] })),
            ]}
          />
        ) : null}
        {kind === 'department' || kind === 'role' ? (
          <Callout icon={Warning} surface="warning" tone="amber" size="compact">
            Their permissions are reset to the new role&apos;s template. Custom permissions are
            replaced, and the change is written to the audit log.
          </Callout>
        ) : null}
        {kind === 'remove' ? (
          <Callout icon={Warning} surface="warning" tone="amber" size="compact">
            They lose access to the Super Admin console at once. Their records and history stay for
            the audit trail, and you can reactivate them later.
          </Callout>
        ) : null}
        {options.isError ? (
          <p className="text-sm text-muted">
            Could not load the departments and roles right now. Check your connection and try again.
          </p>
        ) : null}
        {problem || save.error ? (
          <p role="alert" className="text-sm text-danger">
            {problem || errorMessage(save.error, TEAM_ERROR_MESSAGES)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
