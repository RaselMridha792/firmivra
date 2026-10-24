'use client';

import type { ReminderUnit } from '@firmivra/types';
import { Button, Checkbox, IconButton, Input, Select } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import { CHANNELS, newRow, UNITS, type ReminderRow } from './type-reminders-model';

/**
 * An appointment type's default reminders (Octavia's A7): several, each with its own time and
 * every channel ticked (Email, SMS, Portal). The API keeps one entry per channel and time.
 */
export function TypeReminders({
  typeId,
  rows,
  disabled,
  error,
  onChange,
}: {
  typeId: string;
  rows: ReminderRow[];
  disabled: boolean;
  error?: string;
  onChange: (rows: ReminderRow[]) => void;
}) {
  const put = (i: number, patch: Partial<ReminderRow>) =>
    onChange(rows.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-2"
      data-testid="type-reminders"
      data-invalid={error ? true : undefined}
      aria-describedby={error ? `reminders-error-${typeId}` : undefined}
    >
      <legend className="mb-1 text-sm font-medium text-text">Default reminders</legend>
      {rows.length === 0 ? <p className="text-sm text-muted">No default reminders.</p> : null}
      {rows.map((row, i) => (
        <div
          key={row.key}
          className="flex min-w-0 flex-col gap-1 rounded-control border border-divider p-2"
          data-testid="type-reminder"
        >
          <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-2">
            <Input
              label={`Reminder ${i + 1} amount`}
              hideLabel
              type="number"
              min={0}
              max={60}
              step={1}
              disabled={disabled}
              value={Number.isNaN(row.amount) ? '' : String(row.amount)}
              onChange={(e) =>
                put(i, { amount: e.target.value === '' ? Number.NaN : Number(e.target.value) })
              }
            />
            <Select
              label={`Reminder ${i + 1} unit`}
              hideLabel
              disabled={disabled}
              options={UNITS.map(([value, label]) => ({ value, label }))}
              value={row.unit}
              onChange={(e) => put(i, { unit: e.target.value as ReminderUnit })}
            />
            <IconButton
              icon={Trash}
              tone="danger"
              label={`Remove reminder ${i + 1}`}
              disabled={disabled}
              onClick={() => onChange(rows.filter((_, k) => k !== i))}
            />
          </div>
          <div
            role="group"
            aria-label={`Reminder ${i + 1} channels`}
            className="flex flex-wrap gap-x-4"
          >
            {CHANNELS.map(([channel, label]) => (
              <Checkbox
                key={channel}
                label={label}
                disabled={disabled}
                checked={row.channels.includes(channel)}
                onChange={(e) =>
                  put(i, {
                    channels: e.target.checked
                      ? [...row.channels, channel]
                      : row.channels.filter((c) => c !== channel),
                  })
                }
                className="text-sm"
              />
            ))}
          </div>
        </div>
      ))}
      {error ? (
        <p id={`reminders-error-${typeId}`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        variant="outline"
        className="self-start"
        disabled={disabled || rows.length >= 10}
        onClick={() => onChange([...rows, newRow(1, 'HOURS')])}
      >
        <Plus aria-hidden weight="bold" className="size-4" />
        Add Reminder
      </Button>
    </fieldset>
  );
}
