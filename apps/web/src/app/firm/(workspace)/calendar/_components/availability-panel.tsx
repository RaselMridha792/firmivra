'use client';

import type { AvailabilityBlock, ConflictResult, SchedulingOptions } from '@firmivra/types';
import { Input, Select } from '@firmivra/ui';
import { CalendarBlank, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { AP_DAY, clock } from './ap-shared';
import { RulesEditor } from './availability-editor';
import { type FormState, rangeOf } from './form-model';

interface Row {
  key: string;
  startsAt: string;
  label: string;
  tone: 'available' | 'appointment' | 'blocked' | 'selected';
}

const KIND_LABEL: Record<AvailabilityBlock['kind'], string> = {
  AVAILABLE: 'Available',
  APPOINTMENT: 'Appointment',
  CALENDAR_BUSY: 'Busy (connected calendar)',
  BLOCKED: 'Blocked',
  TIME_OFF: 'Time off',
  BUFFER: 'Buffer',
  OUTSIDE_HOURS: 'Outside working hours',
};

const TONES: Record<Row['tone'], string> = {
  available: 'bg-success-soft text-text',
  appointment: 'border border-danger bg-danger-soft text-text',
  blocked: 'bg-disabled text-text',
  selected:
    'border border-dashed border-info bg-info-soft font-semibold text-heading ring-1 ring-info',
};

/** The day's blocks as rows, with the proposed time cut out of the free block it falls in. */
export function dayRows(
  blocks: AvailabilityBlock[],
  selected: { startsAt: string; endsAt: string } | null,
): Row[] {
  const s = selected ? Date.parse(selected.startsAt) : 0;
  const e = selected ? Date.parse(selected.endsAt) : 0;
  const rows: Row[] = [];
  let placed = false;
  const put = (row: Row) => rows.push(row);
  const selectedRow = (): Row => ({
    key: 'selected',
    startsAt: selected?.startsAt ?? '',
    label: 'Selected Time',
    tone: 'selected',
  });
  for (const block of [...blocks]
    .filter((b) => b.kind !== 'OUTSIDE_HOURS')
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const from = Date.parse(block.startsAt);
    const to = Date.parse(block.endsAt);
    const base = {
      key: `${block.startsAt}-${block.kind}`,
      startsAt: block.startsAt,
      label: block.label ?? KIND_LABEL[block.kind],
    };
    if (block.kind === 'AVAILABLE') {
      if (selected && !placed && s < to && e > from) {
        if (s > from) put({ ...base, tone: 'available', label: 'Available' });
        put(selectedRow());
        placed = true;
        if (e < to)
          put({
            key: `${base.key}-after`,
            startsAt: selected.endsAt,
            label: 'Available',
            tone: 'available',
          });
      } else put({ ...base, tone: 'available' });
    } else {
      put({ ...base, tone: block.kind === 'APPOINTMENT' ? 'appointment' : 'blocked' });
    }
  }
  if (selected && !placed) {
    rows.push(selectedRow());
    rows.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }
  return rows;
}

/** "No Conflicts" or the exact conflicts, with the free times nearby. */
export function ConflictCard({
  conflict,
  staffName,
  timeZone,
  onPick,
}: {
  conflict: ConflictResult | null | undefined;
  staffName: string;
  timeZone: string;
  onPick?: (startsAt: string, endsAt: string) => void;
}) {
  if (!conflict) {
    return (
      <div
        data-testid="conflict-card"
        className="flex items-start gap-3 rounded-xl border border-divider bg-surface p-4"
      >
        <CheckCircle aria-hidden weight="fill" className="size-8 shrink-0 text-muted" />
        <div>
          <p className="font-bold text-heading">Conflict check</p>
          <p className="text-sm text-muted">
            Choose a staff member, a date and a time to check availability.
          </p>
        </div>
      </div>
    );
  }
  if (conflict.ok) {
    return (
      <div
        data-testid="conflict-card"
        className="flex items-start gap-3 rounded-xl bg-success-soft p-4"
      >
        <CheckCircle aria-hidden weight="fill" className="size-8 shrink-0 text-success" />
        <div>
          <p className="font-bold text-heading">No Conflicts</p>
          <p className="text-sm text-text">{staffName} is available at this time.</p>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="conflict-card" className="rounded-xl bg-danger-soft p-4">
      <div className="flex items-start gap-3">
        <WarningCircle aria-hidden weight="fill" className="size-8 shrink-0 text-danger" />
        <div>
          <p className="font-bold text-heading">Scheduling Conflict</p>
          <ul className="text-sm text-text">
            {conflict.conflicts.map((c) => (
              <li key={`${c.kind}-${c.startsAt}`}>{c.message}</li>
            ))}
          </ul>
        </div>
      </div>
      {conflict.alternatives.length > 0 ? (
        <div className="mt-3 text-sm text-text">
          <p className="font-medium">Nearby free times</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {conflict.alternatives.map((a) => (
              <li key={a.startsAt}>
                <button
                  type="button"
                  onClick={() => onPick?.(a.startsAt, a.endsAt)}
                  className="rounded-md border border-divider bg-surface px-2 py-1 text-xs font-medium text-heading hover:bg-canvas"
                >
                  {clock(a.startsAt, timeZone)} – {clock(a.endsAt, timeZone)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** "Thu, Oct 15, 2026" from a calendar date. */
const dateText = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : date;

/**
 * One staff member's day: the staff and date pickers, the blocks with the proposed time marked,
 * and the conflict result. Used in the form's panel and on the Staff Availability page.
 */
export function DayPanel({
  options,
  staffId,
  onStaff,
  date,
  onDate,
  range,
  timeZone,
  excludeId,
  onPick,
  dateEditable,
}: {
  options: SchedulingOptions | undefined;
  staffId: string;
  onStaff: (id: string) => void;
  date: string;
  onDate?: (date: string) => void;
  range: { startsAt: string; endsAt: string } | null;
  timeZone: string;
  excludeId?: string | undefined;
  onPick: (startsAt: string, endsAt: string) => void;
  dateEditable?: boolean;
}) {
  const staff = options?.staff ?? [];
  const staffName = staff.find((s) => s.userId === staffId)?.name ?? 'The staff member';
  // The query needs a staff member and a whole date.
  const enabled = staffId !== '' && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const day = useApiQuery(
    [...AP_DAY, staffId, date, range?.startsAt ?? '', range?.endsAt ?? '', excludeId ?? ''],
    async () =>
      enabled
        ? api.scheduling.staffDay({
            staffUserId: staffId,
            date,
            ...(range ? { startsAt: range.startsAt, endsAt: range.endsAt } : {}),
            ...(excludeId ? { excludeAppointmentId: excludeId } : {}),
          })
        : null,
  );
  const data = day.data ?? undefined;
  const rows = data ? dayRows(data.blocks, range) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-2">
        <Select
          label="Staff member"
          hideLabel
          value={staffId}
          onChange={(event) => onStaff(event.target.value)}
          className="text-sm"
          options={
            staff.length
              ? staff.map((s) => ({ value: s.userId, label: s.name }))
              : [{ value: '', label: 'No staff' }]
          }
        />
        <div className="relative">
          <CalendarBlank
            aria-hidden
            weight="fill"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-heading"
          />
          <Input
            label="Date"
            hideLabel
            {...(dateEditable
              ? { type: 'date', value: date, onChange: (e) => onDate?.(e.target.value) }
              : { type: 'text', readOnly: true, value: dateText(date) })}
            className="px-2 pl-8 text-sm"
          />
        </div>
      </div>
      <ul className="flex flex-col gap-2" data-testid="availability-rows">
        {rows.length === 0 ? (
          <li className="rounded-md bg-canvas p-4 text-center text-sm text-muted">
            {day.isPending && enabled
              ? 'Loading…'
              : day.isError
                ? 'Availability is not available right now.'
                : 'No bookable time on this day.'}
          </li>
        ) : (
          rows.map((row) => (
            <li key={row.key} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-right text-xs text-text">
                {clock(row.startsAt, timeZone)}
              </span>
              <span
                className={`flex min-h-8 flex-1 items-center rounded-md px-3 text-sm ${TONES[row.tone]}`}
              >
                {row.label}
              </span>
            </li>
          ))
        )}
      </ul>
      <ConflictCard
        conflict={data?.conflict}
        staffName={staffName}
        timeZone={timeZone}
        onPick={onPick}
      />
    </div>
  );
}

/**
 * The right column of the form: the staff member's day with the proposed time marked, and the
 * conflict result; "Edit My Availability" opens the rules editor in place.
 */
export function AvailabilityPanel({
  form,
  options,
  excludeId,
  onPick,
  meId,
}: {
  form: FormState;
  options: SchedulingOptions | undefined;
  excludeId?: string;
  onPick: (startsAt: string, endsAt: string) => void;
  /** The signed-in member, when known, for "Edit My Availability". */
  meId?: string;
}) {
  const [tab, setTab] = useState<'day' | 'mine'>('day');
  const [viewStaff, setViewStaff] = useState('');
  const staffId = viewStaff || form.staffIds[0] || options?.staff[0]?.userId || '';
  const tabClass = (on: boolean) =>
    `-mb-px flex-1 border-b-2 py-3 text-center text-sm font-semibold ${on ? 'border-action text-action' : 'border-transparent text-heading hover:text-action'}`;
  return (
    <section
      aria-label="Staff availability"
      className="rounded-xl bg-surface shadow-md"
      data-testid="availability-panel"
    >
      <div role="tablist" className="flex border-b border-divider px-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'day'}
          onClick={() => setTab('day')}
          className={tabClass(tab === 'day')}
        >
          Staff Availability
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mine'}
          onClick={() => setTab('mine')}
          className={tabClass(tab === 'mine')}
        >
          Edit My Availability
        </button>
      </div>
      <div className="p-4">
        {tab === 'day' ? (
          <DayPanel
            options={options}
            staffId={staffId}
            onStaff={setViewStaff}
            date={form.date}
            range={rangeOf(form)}
            timeZone={form.timezone}
            excludeId={excludeId}
            onPick={onPick}
          />
        ) : (
          <RulesEditor userId={meId ?? staffId} compact />
        )}
      </div>
    </section>
  );
}
