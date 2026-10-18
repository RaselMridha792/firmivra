'use client';

import { Button, Input, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { Loading } from './panel';
import type { Schedule } from './send-model';

type Key = keyof Schedule;

const FIELDS: { key: Key; label: string; max: number }[] = [
  { key: 'firstAfterDays', label: 'First reminder (days after sending)', max: 60 },
  { key: 'finalAfterDays', label: 'Final reminder (days after sending)', max: 90 },
  { key: 'hoursBeforeExpiration', label: 'Reminder before expiration (hours)', max: 168 },
];

const text = (n: number | null | undefined) => (n == null ? '' : String(n));

function ScheduleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Record<Key, string>;
  onSave: (schedule: Schedule) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});

  function save() {
    const next: Schedule = {};
    const found: Partial<Record<Key, string>> = {};
    for (const { key, max } of FIELDS) {
      const raw = values[key].trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > max)
        found[key] = `Enter a whole number from 1 to ${max}`;
      else next[key] = n;
    }
    setErrors(found);
    if (Object.keys(found).length === 0) onSave(next);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="send-schedule">
      <p className="text-sm text-muted">
        Reminders stop once the form is submitted. Leave a field empty to use the firm&apos;s
        default.
      </p>
      {FIELDS.map(({ key, label, max }) => (
        <Input
          key={key}
          label={label}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          value={values[key]}
          onChange={(event) => setValues({ ...values, [key]: event.target.value })}
          error={errors[key]}
        />
      ))}
      <div className="mt-2 flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={save}>Save Schedule</Button>
      </div>
    </div>
  );
}

/** Starts from this send's schedule, else the firm's reminder settings when they can be read. */
function ScheduleBody({
  schedule,
  onSave,
  onCancel,
}: {
  schedule: Schedule;
  onSave: (schedule: Schedule) => void;
  onCancel: () => void;
}) {
  const settings = useApiQuery(['intake-forms', 'send', 'settings'], () =>
    api.intakeForms.settings(),
  );
  if (settings.isPending) return <Loading rows={3} />;
  const firm = settings.data?.notifications;
  return (
    <ScheduleForm
      initial={{
        firstAfterDays: text(schedule.firstAfterDays ?? firm?.firstReminderAfterDays),
        finalAfterDays: text(schedule.finalAfterDays ?? firm?.finalReminderAfterDays),
        hoursBeforeExpiration: text(schedule.hoursBeforeExpiration ?? firm?.expirationAlertHours),
      }}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

/** Edit Schedule: when reminders go out for this form. */
export function ScheduleModal({
  open,
  schedule,
  onSave,
  onClose,
}: {
  open: boolean;
  schedule: Schedule;
  onSave: (schedule: Schedule) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title="Reminder Schedule"
      subtitle="When reminders go out while the form is still open."
      onClose={onClose}
    >
      {open ? <ScheduleBody schedule={schedule} onSave={onSave} onCancel={onClose} /> : null}
    </Modal>
  );
}
