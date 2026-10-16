'use client';

import type { AvailabilityRules } from '@firmivra/types';
import { Button, Input, Select, Skeleton } from '@firmivra/ui';
import { ArrowLeft, CalendarCheck, Clock, Plus, Trash, UserGear } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { useMe } from '../../../../../../components/signed-in';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, SCHEDULING } from '../../_components/appointments-parts';
import { StaffDayPanel } from '../../_components/staff-day-panel';
import { todayIn } from '../../_components/time';

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';

const RULE_ERRORS: Record<string, string> = {
  FORBIDDEN: 'You can change only your own availability.',
};

interface TimeOff {
  key: string;
  from: string;
  to: string;
  reason: string;
}

/**
 * Appointments > Staff Availability (appointments-overview-and-calendar.jpg Staff Availability
 * and Edit My Availability, guide §12-15): one staff member's day (`api.scheduling.staffDay`),
 * and the availability rules (`rules` / `setRules`): buffers, minimum notice, booking window,
 * time off and the date they start. Weekly hours and blocked time stay in Settings >
 * Availability (R12). Owner and Admin can edit anyone's rules; everyone else their own.
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
          {rules.data ? (
            <RulesForm
              key={`${whose}-${rules.data.updatedAt ?? ''}`}
              userId={whose}
              rules={rules.data}
            />
          ) : rules.isPending ? (
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
            Weekly working hours and blocked time
          </Link>
        </section>
      </div>
    </div>
  );
}

function RulesForm({ userId, rules: r }: { userId: string; rules: AvailabilityRules }) {
  const [before, setBefore] = useState(String(r.bufferBeforeMinutes));
  const [after, setAfter] = useState(String(r.bufferAfterMinutes));
  const [notice, setNotice] = useState(String(r.minNoticeHours));
  const [windowDays, setWindowDays] = useState(String(r.maxWindowDays));
  const [from, setFrom] = useState(r.effectiveFrom ?? '');
  const [off, setOff] = useState<TimeOff[]>(() =>
    r.timeOff.map((t) => ({ key: t.id, from: t.from, to: t.to, reason: t.reason ?? '' })),
  );
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const save = useApiMutation(
    async () => {
      await api.scheduling.setRules(userId, {
        bufferBeforeMinutes: Number(before),
        bufferAfterMinutes: Number(after),
        minNoticeHours: Number(notice),
        maxWindowDays: Number(windowDays),
        effectiveFrom: from || null,
        timeOff: off.map((t) => ({ from: t.from, to: t.to, reason: t.reason.trim() || null })),
      });
      setSaved('Availability saved.');
    },
    { invalidate: SCHEDULING },
  );
  const minutes = [0, 5, 10, 15, 30, 45, 60].map((m) => ({
    value: String(m),
    label: m ? `${m} minutes` : 'None',
  }));
  const change = (key: string, field: keyof TimeOff, value: string) => {
    setOff((list) => list.map((t) => (t.key === key ? { ...t, [field]: value } : t)));
    setSaved('');
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const bad = off.find((t) => !t.from || !t.to || t.to < t.from);
        if (bad) {
          setError('Each time off needs a start and an end on or after it.');
          return;
        }
        setError('');
        save.mutate(undefined);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Buffer before appointments"
          options={minutes}
          value={before}
          onChange={(e) => {
            setBefore(e.target.value);
            setSaved('');
          }}
        />
        <Select
          label="Buffer after appointments"
          options={minutes}
          value={after}
          onChange={(e) => {
            setAfter(e.target.value);
            setSaved('');
          }}
        />
        <Select
          label="Minimum notice"
          options={[0, 2, 4, 12, 24, 48, 72].map((h) => ({
            value: String(h),
            label: h ? `${h} hours` : 'None',
          }))}
          value={notice}
          onChange={(e) => {
            setNotice(e.target.value);
            setSaved('');
          }}
        />
        <Select
          label="Booking window"
          options={[14, 30, 60, 90, 180, 365].map((d) => ({
            value: String(d),
            label: `${d} days ahead`,
          }))}
          value={windowDays}
          onChange={(e) => {
            setWindowDays(e.target.value);
            setSaved('');
          }}
        />
      </div>
      <Input
        label="Rules apply from"
        type="date"
        value={from}
        onChange={(e) => {
          setFrom(e.target.value);
          setSaved('');
        }}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-text">Time Off / Vacation</legend>
        {off.length ? null : <p className="text-sm text-muted">No time off planned.</p>}
        {off.map((t) => (
          <div key={t.key} className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-end gap-2">
            <Input
              label="From"
              type="date"
              value={t.from}
              onChange={(e) => change(t.key, 'from', e.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={t.to}
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
              onClick={() => setOff((list) => list.filter((x) => x.key !== t.key))}
              className="inline-flex size-11 items-center justify-center rounded-control border border-divider text-danger hover:bg-canvas"
            >
              <Trash aria-hidden weight="bold" className="size-4" />
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          className="self-start"
          onClick={() =>
            setOff((list) => [...list, { key: crypto.randomUUID(), from: '', to: '', reason: '' }])
          }
        >
          <Plus aria-hidden weight="bold" className="size-4" />
          Add Time Off
        </Button>
      </fieldset>
      {error || save.error ? (
        <p role="alert" className="text-sm text-danger">
          {error || errorMessage(save.error, RULE_ERRORS)}
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
