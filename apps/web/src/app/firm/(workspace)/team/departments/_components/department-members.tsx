'use client';

import { ApiRequestError, type Department, type StaffRef } from '@firmivra/types';
import { Button, Checkbox, Modal, SearchField, Skeleton } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { useActiveStaff } from '../../_components/group-dialogs';
import { GROUP_ERRORS, GROUPS } from '../../_components/groups-shared';

/**
 * Manage Members on a department (Octavia's SM13): tick the staff assigned straight to it, with no
 * team needed. Saving sends the whole list (`PUT /business/departments/{id}/members`); someone whose
 * only department this is cannot be taken out, and the dialog names them.
 */
export function DepartmentMembersModal({
  department,
  onClose,
}: {
  department: Department;
  onClose: () => void;
}) {
  const current = useApiQuery([...GROUPS, 'members', department.id], () =>
    api.departments.departmentMembers(department.id),
  );
  return current.data ? (
    <MembersForm department={department} current={current.data.members} onClose={onClose} />
  ) : (
    <Modal open title={`Manage Members of ${department.name}`} onClose={onClose}>
      {current.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(current.error, GROUP_ERRORS)}
        </p>
      ) : (
        <Skeleton className="h-48 w-full max-w-lg" />
      )}
    </Modal>
  );
}

function MembersForm({
  department,
  current,
  onClose,
}: {
  department: Department;
  current: StaffRef[];
  onClose: () => void;
}) {
  const active = useActiveStaff();
  // Current members stay on the list even when they are invited or locked, not active.
  const people: StaffRef[] = [
    ...current.filter((m) => !active.some((p) => p.id === m.id)),
    ...active,
  ];
  const [picked, setPicked] = useState(() => new Set(current.map((m) => m.id)));
  const [search, setSearch] = useState('');
  const save = useApiMutation(
    (membershipIds: string[]) =>
      api.departments.setDepartmentMembers(department.id, { membershipIds }),
    { invalidate: GROUPS },
  );
  const term = search.trim().toLowerCase();
  const shown = term
    ? people.filter((p) => `${p.name} ${p.jobTitle ?? ''}`.toLowerCase().includes(term))
    : people;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const problem =
    save.error instanceof ApiRequestError && save.error.details?.length
      ? save.error.details.map((d) => d.message).join(' ')
      : save.error
        ? errorMessage(save.error, GROUP_ERRORS)
        : null;
  return (
    <Modal
      open
      title={`Manage Members of ${department.name}`}
      subtitle={`${picked.size} selected. Staff join the department itself; no team is needed.`}
      onClose={onClose}
    >
      <div data-testid="department-members" className="flex w-full max-w-lg flex-col gap-4">
        <SearchField
          label="Search staff"
          placeholder="Search staff by name or job title"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul
          aria-label="Staff"
          className="flex max-h-96 flex-col divide-y divide-divider overflow-y-auto rounded-lg border border-divider"
        >
          {shown.map((p) => (
            <li key={p.id} className="px-3">
              <Checkbox
                label={p.jobTitle ? `${p.name}, ${p.jobTitle}` : p.name}
                checked={picked.has(p.id)}
                onChange={(event) => toggle(p.id, event.target.checked)}
                className="text-sm"
              />
            </li>
          ))}
          {!shown.length ? (
            <li className="p-3 text-sm text-muted">No staff match the search.</li>
          ) : null}
        </ul>
        {problem ? (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate([...picked], { onSuccess: onClose })}
          >
            {save.isPending ? 'Saving…' : 'Save Members'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
