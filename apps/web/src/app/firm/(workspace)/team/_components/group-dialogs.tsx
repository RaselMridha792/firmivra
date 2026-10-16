'use client';

import type { NamedRef, StaffRef } from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { type FormEvent, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { GROUP_ERRORS } from './groups-shared';

/** Active members, for Department Head and Team Lead ("Select eligible active staff"). */
export function useActiveStaff(): StaffRef[] {
  return useApiQuery(['staff', 'options'], () => api.staff.options()).data?.managers ?? [];
}

const personOptions = (people: StaffRef[], none: string) => [
  { value: '', label: none },
  ...people.map((p) => ({ value: p.id, label: p.jobTitle ? `${p.name}, ${p.jobTitle}` : p.name })),
];

function ErrorLine({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {errorMessage(error, GROUP_ERRORS)}
    </p>
  ) : null;
}

export interface GroupFormValues {
  name: string;
  description: string;
  personId: string;
  /** Add Team on the Teams tab: the department it belongs to. */
  groupId?: string;
}

/**
 * Add or edit a department or a team: its name, description and head (or lead), and for a new team
 * on the Teams tab its department. The modal opens from its page and has no route (PAGE-MAP).
 */
export function GroupFormModal({
  open,
  title,
  personLabel,
  initial,
  submitLabel,
  pending,
  error,
  groups,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  personLabel: string;
  initial: GroupFormValues;
  /** The departments a new team can join; shows a required Department select. */
  groups?: NamedRef[];
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (values: GroupFormValues) => void;
  onClose: () => void;
}) {
  const people = useActiveStaff();
  const [values, setValues] = useState(initial);
  const [nameError, setNameError] = useState('');
  const [groupError, setGroupError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    const missingName = !values.name.trim();
    const missingGroup = Boolean(groups) && !values.groupId;
    setNameError(missingName ? 'Enter a name.' : '');
    setGroupError(missingGroup ? 'Choose a department.' : '');
    if (missingName || missingGroup) return;
    onSubmit({ ...values, name: values.name.trim(), description: values.description.trim() });
  }
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Name *"
          maxLength={80}
          value={values.name}
          error={nameError}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
        />
        {groups ? (
          <Select
            label="Department *"
            options={[
              { value: '', label: 'Choose a department' },
              ...groups.map((g) => ({ value: g.id, label: g.name })),
            ]}
            value={values.groupId ?? ''}
            error={groupError}
            onChange={(event) => setValues({ ...values, groupId: event.target.value })}
          />
        ) : null}
        <Textarea
          label="Description"
          maxLength={500}
          rows={3}
          value={values.description}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
        <Select
          label={personLabel}
          options={personOptions(people, 'No one yet')}
          value={values.personId}
          onChange={(event) => setValues({ ...values, personId: event.target.value })}
        />
        <ErrorLine error={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Change Head or Change Lead: one active member, or none. */
export function PersonModal({
  open,
  title,
  label,
  current,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  current: string;
  pending: boolean;
  error: unknown;
  onSubmit: (personId: string | null) => void;
  onClose: () => void;
}) {
  const people = useActiveStaff();
  const [personId, setPersonId] = useState(current);
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Select
          label={label}
          options={personOptions(people, 'No one')}
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
        />
        <ErrorLine error={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={() => onSubmit(personId || null)}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Deactivate or archive a group. Nothing is deleted; a group with active staff first moves them
 * to another active group ("Warn/reassign if used by active staff", docx §13).
 */
export function StatusModal({
  open,
  action,
  name,
  inUse,
  moveOptions,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  action: 'Deactivate' | 'Archive';
  name: string;
  inUse: boolean;
  moveOptions: NamedRef[];
  pending: boolean;
  error: unknown;
  onConfirm: (moveTo: string | undefined) => void;
  onClose: () => void;
}) {
  const [moveTo, setMoveTo] = useState('');
  const [moveError, setMoveError] = useState('');
  return (
    <Modal open={open} title={`${action} ${name}?`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {action === 'Archive'
            ? 'It leaves the lists but its history stays. No one is deleted.'
            : 'It stays in the list as Inactive and can be reactivated. No one is deleted.'}
        </p>
        {inUse ? (
          <Select
            label="Move its staff to *"
            options={[
              { value: '', label: 'Choose where they go' },
              ...moveOptions.map((o) => ({ value: o.id, label: o.name })),
            ]}
            value={moveTo}
            error={moveError}
            onChange={(event) => setMoveTo(event.target.value)}
          />
        ) : null}
        <ErrorLine error={error} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (inUse && !moveTo) {
                setMoveError('Choose where its staff go.');
                return;
              }
              onConfirm(moveTo || undefined);
            }}
          >
            {action}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
