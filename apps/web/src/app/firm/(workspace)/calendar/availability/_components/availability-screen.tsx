'use client';

import type { AvailabilityRules, WorkingHoursRange } from '@firmivra/types';
import { Button, Input, Select, Skeleton } from '@firmivra/ui';
import { ArrowLeft, CalendarCheck, Clock, Plus, Trash, UserGear } from '@phosphor-icons/react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { useMe } from '../../../../../../components/signed-in';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, SCHEDULING } from '../../_components/appointments-parts';
import { AVAILABILITY, CALENDAR_ERRORS } from '../../_components/shared';
import { StaffDayPanel } from '../../_components/staff-day-panel';
import { todayIn } from '../../_components/time';
import { WeekHours, hourErrors } from './week-hours';

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';

const RULE_ERRORS: Record<string, string> = {
  ...CALENDAR_ERRORS,
  FORBIDDEN: 'You can change only your own availability.',
};

/** The booking window the API reports when the firm sets no limit. */
const NO_LIMIT_DAYS = 730;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const minutesText = (m: number) => (m ? plural(m, 'minute') : 'None');
const noticeText = (h: number) => (h ? plural(h, 'hour') : 'None');
const windowText = (d: number) => (d >= NO_LIMIT_DAYS ? 'No limit' : `${plural(d, 'day')} ahead`);

interface TimeOff {
  key: string;
  from: string;
  to: string;
  reason: string;
}

/**
 * Appointments > Staff Availability (appointments-overview-and-calendar.jpg Staff Availability
 * and Edit My Availability, guide §12-15): one staff member's day (`api.scheduling.staffDay`),
 * and Edit My Availability: the weekly working hours (`api.availability`, the same week as
 * Settings > Availability) and time off (`rules` / `setRules`), saved together. Buffers, minimum
 * notice and booking window are the firm's (per appointment type in Manage Appointment Types)
 * and the API keeps none per person, so they are shown, not edited (Octavia's review, A2).
 * Owner and Admin can edit anyone's availability; everyone else their own.
 */
export function AvailabilityScreen() {
  const { me } = useMe();
  const { role } = useFirm();
  const manages = role === 'OWNER' || role === 'ADMIN';
  const options = useApiQuery([...SCHEDULING, 'options'], () => api.scheduling.options());
  const o = options.data;
  const tz = o?.timezone ?? 'America/New_York';
  const [dayStaff, setDayStaff] = useState('');
  const [date, setDate] = useState(() => todayIn(tz));
  const [whose, setWhose] = useState(me.user.id);
  const staff = o?.staff ?? [];
  const people = [
    { userId: me.user.id, name: `${me.user.name} (me)` },
    ...staff.filter((s) => s.userId !== me.user.id),
  ];
  const rules = useApiQuery([...SCHEDULING, 'rules', whose], () => api.scheduling.rules(whose));
  const week = useApiQuery(AVAILABILITY, () => api.availability.get());
  const hours = week.data?.members.find((m) => m.member.userId === whose)?.hours ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link
        href="/calendar"
        className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" />
        Back to Appointments
      </Link>
      <header className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
          <CalendarCheck aria-hidden weight="fill" className="size-9" />
        </span>
        <div className="min-w-0">
          <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
            Staff Availability
          </h1>
          <p className="text-base text-text">
            See who is free, and keep availability up to date so clients can easily find a time.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section aria-label="Staff Availability" data-testid="availability-day" className={card}>
          <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
            <Clock aria-hidden weight="fill" className="size-5 text-action" />
            Staff Availability
          </h2>
          {o ? (
            <StaffDayPanel
              staff={staff}
              staffUserId={dayStaff || staff[0]?.userId || ''}
              date={date}
              onStaff={setDayStaff}
              onDate={setDate}
            />
          ) : options.isPending ? (
            <Skeleton className="h-80" />
          ) : (
            <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
          )}
        </section>

        <section
          aria-label="Edit My Availability"
          data-testid="availability-rules"
          className={card}
        >
          <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
            <UserGear aria-hidden weight="fill" className="size-5 text-action" />
            Edit My Availability
          </h2>
          {manages ? (
            <Select
              label="Availability of"
              options={people.map((p) => ({ value: p.userId, label: p.name }))}
              value={whose}
              onChange={(e) => setWhose(e.target.value)}
            />
          ) : null}
          {rules.data && !week.isPending ? (
            <RulesForm
              key={`${whose}-${rules.data.updatedAt ?? ''}-${JSON.stringify(hours)}`}
              userId={whose}
              rules={rules.data}
              hours={hours}
              timeZone={week.data?.timezone ?? tz}
            />
          ) : rules.isPending || week.isPending ? (
            <Skeleton className="h-80" />
          ) : (
            <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
              {rules.isError
                ? errorMessage(rules.error, { ...RULE_ERRORS, NOT_FOUND: NOT_LOADED })
                : NOT_LOADED}
            </p>
          )}
          <Link
            href="/settings/availability"
            className="text-sm font-semibold text-link hover:underline"
          >
            Blocked time, in Settings &gt; Availability
          </Link>
        </section>
      </div>
    </div>
  );
}

function RulesForm({
  userId,
  rules: r,
  hours: savedHours,
  timeZone,
}: {
  userId: string;
  rules: AvailabilityRules;
  /** Null when the weekly hours could not be loaded: then only time off is saved. */
  hours: WorkingHoursRange[] | null;
  timeZone: string;
}) {
  const [hours, setHours] = useState<WorkingHoursRange[]>(savedHours ?? []);
  const [off, setOff] = useState<TimeOff[]>(() =>
    r.timeOff.map((t) => ({ key: t.id, from: t.from, to: t.to, reason: t.reason ?? '' })),
  );
  // Field errors show once Save was pressed, then follow every edit.
  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState('');
  const hourProblems = hourErrors(hours);
  const offProblems = new Map<string, { from?: string; to?: string }>();
  for (const t of off) {
    if (!t.from) offProblems.set(t.key, { from: 'Enter a start.' });
    else if (!t.to) offProblems.set(t.key, { to: 'Enter an end.' });
    else if (t.to < t.from)
      offProblems.set(t.key, { to: 'The end must be on or after the start.' });
  }
  const problems = hourProblems.size + offProblems.size;
  const client = useQueryClient();
  const save = useApiMutation(async () => {
    if (savedHours && JSON.stringify(hours) !== JSON.stringify(savedHours)) {
      await api.availability.setWorkingHours(userId, { hours });
    }
    // Time off only: buffers, notice, window and a start date are not kept per person.
    await api.scheduling.setRules(userId, {
      timeOff: off.map((t) => ({ from: t.from, to: t.to, reason: t.reason.trim() || null })),
    });
    setSaved('Availability saved.');
    // The day panel and the weekly hours both change.
    await Promise.all([
      client.invalidateQueries({ queryKey: SCHEDULING }),
      client.invalidateQueries({ queryKey: AVAILABILITY }),
    ]);
  });
  const edited = () => {
    setSaved('');
    save.reset();
  };
  const change = (key: string, field: keyof TimeOff, value: string) => {
    setOff((list) => list.map((t) => (t.key === key ? { ...t, [field]: value } : t)));
    edited();
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setChecked(true);
        if (problems) {
          const form = e.currentTarget;
          // The first wrong field in the order shown, once the errors are drawn.
          requestAnimationFrame(() =>
            form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
          );
          return;
        }
        save.mutate(undefined);
      }}
    >
      {savedHours ? (
        <WeekHours
          hours={hours}
          errors={checked ? hourProblems : new Map()}
          timeZone={timeZone}
          editable
          onChange={(next) => {
            setHours(next);
            edited();
          }}
        />
      ) : (
        <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
          Weekly working hours: {NOT_LOADED}
        </p>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-text">Time Off / Vacation</legend>
        {off.length ? null : <p className="text-sm text-muted">No time off planned.</p>}
        {off.map((t) => (
          <div key={t.key} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-start gap-2">
            <Input
              label="From"
              type="date"
              value={t.from}
              error={checked ? offProblems.get(t.key)?.from : undefined}
              onChange={(e) => change(t.key, 'from', e.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={t.to}
              error={checked ? offProblems.get(t.key)?.to : undefined}
              onChange={(e) => change(t.key, 'to', e.target.value)}
            />
            <Input
              label="Reason"
              value={t.reason}
              maxLength={200}
              onChange={(e) => change(t.key, 'reason', e.target.value)}
            />
            <button
              type="button"
              aria-label="Remove this time off"
              onClick={() => {
                setOff((list) => list.filter((x) => x.key !== t.key));
                edited();
              }}
              className="mt-7 inline-flex size-11 items-center justify-center rounded-control border border-divider text-danger hover:bg-canvas"
            >
              <Trash aria-hidden weight="bold" className="size-4" />
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => {
            setOff((list) => [...list, { key: crypto.randomUUID(), from: '', to: '', reason: '' }]);
            edited();
          }}
        >
          <Plus aria-hidden weight="bold" className="size-4" />
          Add Time Off
        </Button>
      </fieldset>

      <section
        aria-label="Booking rules"
        data-testid="booking-rules"
        className="flex flex-col gap-2 rounded-lg bg-subtle p-3"
      >
        <h3 className="text-sm font-semibold text-heading">Booking rules for the whole firm</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Buffer before appointments</dt>
          <dd className="text-text">{minutesText(r.bufferBeforeMinutes)}</dd>
          <dt className="text-muted">Buffer after appointments</dt>
          <dd className="text-text">{minutesText(r.bufferAfterMinutes)}</dd>
          <dt className="text-muted">Minimum notice</dt>
          <dd className="text-text">{noticeText(r.minNoticeHours)}</dd>
          <dt className="text-muted">Booking window</dt>
          <dd className="text-text">{windowText(r.maxWindowDays)}</dd>
        </dl>
        <p className="text-xs text-muted">
          Each appointment type can set its own in{' '}
          <Link href="/calendar/types" className="font-semibold text-link hover:underline">
            Manage Appointment Types
          </Link>
          . Changes to hours and time off apply as soon as you save.
        </p>
      </section>

      {checked && problems ? (
        <p role="alert" data-testid="rules-problems" className="text-sm text-danger">
          {problems === 1
            ? 'Fix the highlighted field before saving.'
            : `Fix the ${problems} highlighted fields before saving.`}
        </p>
      ) : save.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error, RULE_ERRORS)}
        </p>
      ) : saved ? (
        <p role="status" data-testid="rules-saved" className="text-sm text-success">
          {saved}
        </p>
      ) : null}
      <Button type="submit" className="self-end" disabled={save.isPending}>
        Save Availability
      </Button>
    </form>
  );
}
