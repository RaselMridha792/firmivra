'use client';

import type { NamedRef, StaffRef, StaffTeamDetail, TeamMemberKind } from '@firmivra/types';
import { Button, Checkbox, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { useActiveStaff } from '../../_components/group-dialogs';
import { GROUP_ERRORS, GROUPS } from '../../_components/groups-shared';

export const KIND_LABELS: Record<TeamMemberKind, string> = {
  PRIMARY: 'Primary',
  BACKUP: 'Backup',
  MEMBER: 'Member',
};

const KIND_OPTIONS = (Object.keys(KIND_LABELS) as TeamMemberKind[]).map((kind) => ({
  value: kind,
  label: KIND_LABELS[kind],
}));

function ErrorLine({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {errorMessage(error, GROUP_ERRORS)}
    </p>
  ) : null;
}

/** Move Department: the team goes to another active department with its lead and members. */
export function MoveModal({
  open,
  team,
  departments,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  team: { name: string; department: NamedRef };
  departments: NamedRef[];
  pending: boolean;
  error: unknown;
  onSubmit: (departmentId: string) => void;
  onClose: () => void;
}) {
  const [departmentId, setDepartmentId] = useState('');
  const [missing, setMissing] = useState('');
  return (
    <Modal
      open={open}
      title={`Move ${team.name}`}
      subtitle={`Now in ${team.department.name}. Its lead and members move with it.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Move to department *"
          options={[
            { value: '', label: 'Choose a department' },
            ...departments
              .filter((d) => d.id !== team.department.id)
              .map((d) => ({ value: d.id, label: d.name })),
          ]}
          value={departmentId}
          error={missing}
          onChange={(event) => setDepartmentId(event.target.value)}
        />
        <ErrorLine error={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (!departmentId) {
                setMissing('Choose a department.');
                return;
              }
              onSubmit(departmentId);
            }}
          >
            Move Team
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface MembersProps {
  open: boolean;
  pending: boolean;
  error: unknown;
  onSubmit: (members: { membershipId: string; kind: TeamMemberKind }[]) => void;
  onClose: () => void;
}

/**
 * Manage Members: tick the people in the team and set each one's place (primary, backup or member).
 * Saving sends the whole list (`PUT /business/teams/{id}/members`). The list row has no members,
 * so the modal reads the team first.
 */
export function MembersModal({ teamId, ...props }: MembersProps & { teamId: string }) {
  const detail = useApiQuery([...GROUPS, 'team', teamId], () => api.departments.team(teamId));
  return detail.data ? <MembersForm team={detail.data} {...props} /> : null;
}

function MembersForm({
  open,
  team,
  pending,
  error,
  onSubmit,
  onClose,
}: MembersProps & { team: StaffTeamDetail }) {
  const active = useActiveStaff();
  // Current members stay on the list even when they are no longer active.
  const people: StaffRef[] = [
    ...team.members.filter((m) => !active.some((p) => p.id === m.id)),
    ...active,
  ];
  const [picked, setPicked] = useState(
    () => new Map(team.members.map((m) => [m.id, m.kind] as const)),
  );
  const toggle = (id: string, on: boolean) => {
    const next = new Map(picked);
    if (on) next.set(id, 'MEMBER');
    else next.delete(id);
    setPicked(next);
  };
  const setKind = (id: string, kind: TeamMemberKind) => setPicked(new Map(picked).set(id, kind));
  return (
    <Modal
      open={open}
      title={`Manage Members of ${team.name}`}
      subtitle={`${picked.size} selected`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <ul
          aria-label="Staff"
          className="flex max-h-96 flex-col divide-y divide-divider overflow-y-auto rounded-lg border border-divider"
        >
          {people.map((p) => {
            const kind = picked.get(p.id);
            return (
              // On a phone the name keeps its line and the place drops under it.
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-x-2 px-3 pb-2 sm:pb-0"
              >
                <Checkbox
                  label={p.jobTitle ? `${p.name}, ${p.jobTitle}` : p.name}
                  checked={Boolean(kind)}
                  onChange={(event) => toggle(p.id, event.target.checked)}
                  className="min-w-48 flex-1 text-sm"
                />
                {kind ? (
                  <div className="ml-8 sm:ml-0">
                    <Select
                      label={`Place of ${p.name}`}
                      hideLabel
                      options={KIND_OPTIONS}
                      value={kind}
                      onChange={(event) => setKind(p.id, event.target.value as TeamMemberKind)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <ErrorLine error={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSubmit([...picked].map(([membershipId, kind]) => ({ membershipId, kind })))
            }
          >
            Save Members
          </Button>
        </div>
      </div>
    </Modal>
  );
}
