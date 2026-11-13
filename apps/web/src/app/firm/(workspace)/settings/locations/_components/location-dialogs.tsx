'use client';

import type { LocationAction, LocationOptions, LocationProfile } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { LOCATION_ERRORS, LOCATIONS } from './location-parts';

// The Locations dialogs (guide: actions menu 03, Edit Location 04 to 06, final decisions 1, 2 and
// 4). Deactivating and scheduling are the Super Administrator's (the API checks again); a
// scheduled time is read in the location's own time zone and shown in it.

type Members = LocationOptions['members'];

/** "2026-11-20T09:00" typed in `zone` as an instant. */
export function zonedToIso(local: string, zone: string): string {
  const guess = new Date(`${local}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asZone = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (asZone - guess.getTime())).toISOString();
}

/** An instant as the location's clock shows it: "Nov 20, 2026, 9:00 AM (America/New_York)". */
export function zonedText(iso: string, zone: string) {
  const text = new Date(iso).toLocaleString('en-US', {
    timeZone: zone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `${text} (${zone})`;
}

function Dialog({
  title,
  confirm,
  danger,
  disabled,
  busy,
  error,
  onConfirm,
  onClose,
  testId,
  children,
}: {
  title: string;
  confirm: string;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  error?: unknown;
  onConfirm: () => void;
  onClose: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={disabled || busy}
            onClick={onConfirm}
            className={danger ? '!bg-danger hover:!bg-danger' : ''}
          >
            {busy ? 'Saving…' : confirm}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm text-text" data-testid={testId}>
        {children}
        {error ? (
          <p role="alert" className="text-danger">
            {errorMessage(error, LOCATION_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Now, or at a later time in the location's zone. */
function When({
  zone,
  later,
  onLater,
  at,
  onAt,
}: {
  zone: string;
  later: boolean;
  onLater: (later: boolean) => void;
  at: string;
  onAt: (at: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold text-heading">When</legend>
      <label className="flex items-center gap-2">
        <input type="radio" checked={!later} onChange={() => onLater(false)} className="size-4" />
        Now
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" checked={later} onChange={() => onLater(true)} className="size-4" />
        Schedule for a later date and time
      </label>
      {later ? (
        <Input
          label={`Effective date and time (${zone})`}
          type="datetime-local"
          value={at}
          onChange={(e) => onAt(e.target.value)}
        />
      ) : null}
    </fieldset>
  );
}

const invalidate = { invalidate: [...LOCATIONS] };

/** Manage Staff: who works at the location (the people themselves are Staff Management's). */
export function ManageStaffDialog({
  location,
  members,
  onClose,
  onDone,
}: {
  location: LocationProfile;
  members: Members;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [chosen, setChosen] = useState(location.staff.map((p) => p.userId));
  const save = useApiMutation(
    () => api.locations.setStaff(location.id, { staffUserIds: chosen }),
    invalidate,
  );
  return (
    <Dialog
      title={`Manage Staff: ${location.name}`}
      confirm="Save Staff"
      busy={save.isPending}
      error={save.error}
      onConfirm={() =>
        save.mutate(undefined, { onSuccess: () => onDone(`Staff saved for ${location.name}.`) })
      }
      onClose={onClose}
      testId="manage-staff-dialog"
    >
      <p>Choose who works here. Staff Management keeps their details.</p>
      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
        {members.map((m) => (
          <li key={m.userId}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                checked={chosen.includes(m.userId)}
                onChange={(e) =>
                  setChosen((was) =>
                    e.target.checked ? [...was, m.userId] : was.filter((x) => x !== m.userId),
                  )
                }
              />
              <span className="font-medium text-heading">{m.name}</span>
              <span className="text-muted">{m.jobTitle ?? ''}</span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/**
 * Deactivate Location (Super Administrator; final decision 1): now or at a scheduled time. Staff
 * accounts stay active; future appointments stay booked (the count warns).
 */
export function DeactivateLocationDialog({
  location,
  onClose,
  onDone,
}: {
  location: LocationProfile;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [later, setLater] = useState(false);
  const [at, setAt] = useState('');
  const zone = location.effectiveTimeZone;
  const go = useApiMutation(
    () => api.locations.deactivate(location.id, later ? { effectiveAt: zonedToIso(at, zone) } : {}),
    invalidate,
  );
  return (
    <Dialog
      title="Deactivate Location"
      confirm={later ? 'Schedule Deactivation' : 'Deactivate Now'}
      danger
      disabled={later && !at}
      busy={go.isPending}
      error={go.error}
      onConfirm={() =>
        go.mutate(undefined, {
          onSuccess: () =>
            onDone(
              later
                ? `${location.name} will be deactivated on ${zonedText(zonedToIso(at, zone), zone)}.`
                : `${location.name} is deactivated.`,
            ),
        })
      }
      onClose={onClose}
      testId="deactivate-location-dialog"
    >
      <p>
        <span className="font-semibold">{location.name}</span> will no longer be offered. Its staff
        keep their accounts; deactivate a person separately in Staff Management.
      </p>
      {location.futureAppointments ? (
        <p className="rounded-lg bg-warning-soft p-3 text-heading">
          {location.futureAppointments} future{' '}
          {location.futureAppointments === 1 ? 'appointment is' : 'appointments are'} booked here.
          They stay booked; move them in Appointments if needed.
        </p>
      ) : null}
      <When zone={zone} later={later} onLater={setLater} at={at} onAt={setAt} />
    </Dialog>
  );
}

/** Set as Primary: the default office; the old primary stays, not primary. */
export function SetPrimaryDialog({
  location,
  onClose,
  onDone,
}: {
  location: Pick<LocationProfile, 'id' | 'name'>;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const go = useApiMutation(() => api.locations.setPrimary(location.id), invalidate);
  return (
    <Dialog
      title="Set as Primary"
      confirm="Set as Primary"
      busy={go.isPending}
      error={go.error}
      onConfirm={() =>
        go.mutate(undefined, {
          onSuccess: () => onDone(`${location.name} is now the primary location.`),
        })
      }
      onClose={onClose}
      testId="set-primary-dialog"
    >
      <p>
        <span className="font-semibold">{location.name}</span> becomes the default office. The
        current primary location stays active.
      </p>
    </Dialog>
  );
}

/**
 * Activate (Overview 24: Activate/Deactivate, as on Locations): an inactive location comes back
 * and counts toward the plan; the API refuses past the plan's limit (LOCATION_LIMIT).
 */
export function ActivateLocationDialog({
  location,
  onClose,
  onDone,
}: {
  location: Pick<LocationProfile, 'id' | 'name'>;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const go = useApiMutation(() => api.locations.activate(location.id), invalidate);
  return (
    <Dialog
      title="Activate Location"
      confirm="Activate"
      busy={go.isPending}
      error={go.error}
      onConfirm={() =>
        go.mutate(undefined, { onSuccess: () => onDone(`${location.name} is active again.`) })
      }
      onClose={onClose}
      testId="activate-location-dialog"
    >
      <p>
        <span className="font-semibold">{location.name}</span> becomes active again and counts
        toward your plan&apos;s locations. Its staff and manager stay as they are.
      </p>
    </Dialog>
  );
}

/**
 * Reassign Manager (Edit Location 06): an active member, now or later; Create New Manager opens
 * Staff Management. Reassigning changes who runs the location; it never ends anyone's access.
 */
export function ReassignManagerDialog({
  location,
  members,
  onClose,
  onDone,
}: {
  location: LocationProfile;
  members: Members;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [userId, setUserId] = useState('');
  const [later, setLater] = useState(false);
  const [at, setAt] = useState('');
  const zone = location.effectiveTimeZone;
  const name = members.find((m) => m.userId === userId)?.name ?? 'The new manager';
  const go = useApiMutation(
    () =>
      api.locations.reassignManager(location.id, {
        managerUserId: userId,
        ...(later ? { effectiveAt: zonedToIso(at, zone) } : {}),
      }),
    invalidate,
  );
  return (
    <Dialog
      title="Reassign Manager"
      confirm={later ? 'Schedule Change' : 'Reassign Now'}
      disabled={!userId || (later && !at)}
      busy={go.isPending}
      error={go.error}
      onConfirm={() =>
        go.mutate(undefined, {
          onSuccess: () =>
            onDone(
              later
                ? `${name} takes over ${location.name} as scheduled.`
                : `${name} now manages ${location.name}.`,
            ),
        })
      }
      onClose={onClose}
      testId="reassign-manager-dialog"
    >
      <Select
        label="New manager"
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        options={[
          { value: '', label: 'Choose an active member' },
          ...members
            .filter((m) => m.userId !== location.manager?.userId || location.managerIsActing)
            .map((m) => ({ value: m.userId, label: m.name })),
        ]}
      />
      <Link href="/team/new" className="w-fit font-semibold text-link hover:underline">
        Create New Manager in Staff Management
      </Link>
      <When zone={zone} later={later} onLater={setLater} at={at} onAt={setAt} />
    </Dialog>
  );
}

/**
 * Deactivate Manager (Super Administrator; Edit Location 05, decision 4): the manager's firm access
 * ends now or later; their locations get the replacement, or the main location's manager acts.
 */
export function DeactivateManagerDialog({
  location,
  members,
  onClose,
  onDone,
}: {
  location: LocationProfile;
  members: Members;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const manager = location.manager;
  const [replacement, setReplacement] = useState('');
  const [later, setLater] = useState(false);
  const [at, setAt] = useState('');
  const zone = location.effectiveTimeZone;
  const go = useApiMutation(
    () =>
      api.locations.deactivateManager(manager!.userId, {
        replacementUserId: replacement || null,
        ...(later ? { effectiveAt: zonedToIso(at, zone) } : {}),
      }),
    invalidate,
  );
  if (!manager) return null;
  return (
    <Dialog
      title="Deactivate Manager"
      confirm={later ? 'Schedule Deactivation' : 'Deactivate Now'}
      danger
      disabled={later && !at}
      busy={go.isPending}
      error={go.error}
      onConfirm={() =>
        go.mutate(undefined, {
          onSuccess: () =>
            onDone(`${manager.name}'s access ends ${later ? 'as scheduled' : 'now'}.`),
        })
      }
      onClose={onClose}
      testId="deactivate-manager-dialog"
    >
      <p>
        <span className="font-semibold">{manager.name}</span> loses access to the firm at the time
        you choose. Their records stay.
      </p>
      <Select
        label="Replacement manager"
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
        options={[
          { value: '', label: 'None: the main location manager acts until one is assigned' },
          ...members
            .filter((m) => m.userId !== manager.userId)
            .map((m) => ({ value: m.userId, label: m.name })),
        ]}
      />
      <When zone={zone} later={later} onLater={setLater} at={at} onAt={setAt} />
    </Dialog>
  );
}

/** A pending scheduled change: Edit Schedule (a new time) or Cancel Schedule (decision 2). */
export function ScheduleDialog({
  action,
  zone,
  onClose,
  onDone,
}: {
  action: LocationAction;
  zone: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [at, setAt] = useState('');
  const edit = useApiMutation(
    () => api.locations.updateAction(action.id, { effectiveAt: zonedToIso(at, zone) }),
    invalidate,
  );
  const cancel = useApiMutation(() => api.locations.cancelAction(action.id), invalidate);
  const what = {
    DEACTIVATE_LOCATION: 'Deactivation',
    DEACTIVATE_MANAGER: 'Manager deactivation',
    REASSIGN_MANAGER: 'Manager change',
  }[action.kind];
  return (
    <Modal
      open
      title="Scheduled Change"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="secondary"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(undefined, { onSuccess: () => onDone(`${what} cancelled.`) })
            }
          >
            Cancel Schedule
          </Button>
          <Button
            disabled={!at || edit.isPending}
            onClick={() =>
              edit.mutate(undefined, {
                onSuccess: () =>
                  onDone(`${what} moved to ${zonedText(zonedToIso(at, zone), zone)}.`),
              })
            }
          >
            Save New Time
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm text-text" data-testid="schedule-dialog">
        <p>
          <span className="font-semibold">{what}</span>
          {action.locationName ? ` of ${action.locationName}` : ''} runs on{' '}
          {zonedText(action.effectiveAt, zone)}
          {action.newManager ? `, with ${action.newManager.name} taking over` : ''}.
        </p>
        <Input
          label={`New date and time (${zone})`}
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
        {edit.error || cancel.error ? (
          <p role="alert" className="text-danger">
            {errorMessage(edit.error ?? cancel.error, LOCATION_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
