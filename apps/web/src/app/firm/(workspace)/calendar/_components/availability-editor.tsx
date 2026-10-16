'use client';

import type {
  AvailabilityRules,
  BlockedTime,
  MemberAvailability,
  WorkingHoursRange,
} from '@firmivra/types';
import { Button, Checkbox, Toggle } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { AP_RULES, dayRange, FALLBACK_ZONE } from './ap-shared';
import { CONTROL, Field } from './form-parts';
import { timeText } from './form-model';
import { addDays, todayIn } from './time';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ALL_TIMES = Array.from({ length: 96 }, (_, i) => {
  const m = i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});
const AVAIL = ['availability-ws'];

function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-28 shrink-0">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${CONTROL} min-h-9`}
      >
        {ALL_TIMES.map((t) => (
          <option key={t} value={t}>
            {timeText(t)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Group({
  title,
  hint,
  children,
  footer,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-divider bg-surface p-4">
      <h3 className="text-base font-bold text-heading">{title}</h3>
      {hint ? <p className="mb-3 text-sm text-muted">{hint}</p> : <div className="mb-3" />}
      {children}
      {footer ? <div className="mt-4 flex flex-wrap items-center gap-3">{footer}</div> : null}
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md bg-canvas p-3 text-sm text-muted">{children}</p>
);

function Result({ error, done }: { error?: unknown; done?: string | undefined }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {errorMessage(error)}
      </p>
    );
  }
  return done ? (
    <p role="status" className="text-sm text-success">
      {done}
    </p>
  ) : null;
}

/* ---------- Weekly working hours (R12's api.availability) ---------- */

function WeeklyForm({ member, userId }: { member: MemberAvailability; userId: string }) {
  const [days, setDays] = useState<Record<number, { start: string; end: string }[]>>(() => {
    const out: Record<number, { start: string; end: string }[]> = {};
    for (const h of member.hours)
      (out[h.weekday] ??= []).push({ start: h.startsAt, end: h.endsAt });
    return out;
  });
  const [done, setDone] = useState<string>();
  const save = useApiMutation(
    (hours: WorkingHoursRange[]) => api.availability.setWorkingHours(userId, { hours }),
    { invalidate: AVAIL },
  );
  const set = (weekday: number, ranges: { start: string; end: string }[]) => {
    setDone(undefined);
    setDays({ ...days, [weekday]: ranges });
  };
  return (
    <Group
      title="Weekly Working Hours"
      hint="Bookable hours by weekday. Add a second block for a split day."
      footer={
        <>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                Object.entries(days).flatMap(([weekday, ranges]) =>
                  ranges.map((r) => ({
                    weekday: Number(weekday),
                    startsAt: r.start,
                    endsAt: r.end,
                  })),
                ),
                { onSuccess: () => setDone('Weekly hours saved.') },
              )
            }
          >
            Save weekly hours
          </Button>
          <Result error={save.error} done={done} />
        </>
      }
    >
      <ul className="flex flex-col gap-2">
        {WEEK_ORDER.map((weekday) => {
          const ranges = days[weekday] ?? [];
          return (
            <li key={weekday} className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm font-medium text-heading">{DAYS[weekday]}</span>
              <Toggle
                label={`${DAYS[weekday]} works`}
                checked={ranges.length > 0}
                onChange={(on) => set(weekday, on ? [{ start: '09:00', end: '17:00' }] : [])}
              />
              {ranges.length === 0 ? (
                <span className="text-sm text-muted">Day off</span>
              ) : (
                <div className="flex flex-col gap-2">
                  {ranges.map((range, i) => (
                    <div
                      key={`${range.start}-${range.end}-${i}`}
                      className="flex items-center gap-2"
                    >
                      <TimeSelect
                        label={`${DAYS[weekday]} start ${i + 1}`}
                        value={range.start}
                        onChange={(start) =>
                          set(
                            weekday,
                            ranges.map((r, j) => (j === i ? { ...r, start } : r)),
                          )
                        }
                      />
                      <span aria-hidden>–</span>
                      <TimeSelect
                        label={`${DAYS[weekday]} end ${i + 1}`}
                        value={range.end}
                        onChange={(end) =>
                          set(
                            weekday,
                            ranges.map((r, j) => (j === i ? { ...r, end } : r)),
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${DAYS[weekday]} block ${i + 1}`}
                        onClick={() =>
                          set(
                            weekday,
                            ranges.filter((_, j) => j !== i),
                          )
                        }
                        className="text-muted hover:text-danger"
                      >
                        <Trash aria-hidden weight="fill" className="size-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => set(weekday, [...ranges, { start: '13:00', end: '17:00' }])}
                    className="flex w-fit items-center gap-1 text-xs font-medium text-link"
                  >
                    <Plus aria-hidden weight="bold" className="size-3" /> Add block
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Group>
  );
}

/* ---------- Rules: overrides, time off, buffers, notice, window, busy calendars ---------- */

function RulesForm({ rules, userId }: { rules: AvailabilityRules; userId: string }) {
  const [state, setState] = useState(rules);
  const [done, setDone] = useState<string>();
  const [override, setOverride] = useState({ date: '', start: '09:00', end: '17:00', off: false });
  const [off, setOff] = useState({ from: '', to: '', reason: '' });
  const change = (patch: Partial<AvailabilityRules>) => {
    setDone(undefined);
    setState({ ...state, ...patch });
  };
  const save = useApiMutation(
    () =>
      api.scheduling.setRules(userId, {
        dateOverrides: state.dateOverrides,
        timeOff: state.timeOff.map((t) => ({ from: t.from, to: t.to, reason: t.reason ?? '' })),
        bufferBeforeMinutes: state.bufferBeforeMinutes,
        bufferAfterMinutes: state.bufferAfterMinutes,
        minNoticeHours: state.minNoticeHours,
        maxWindowDays: state.maxWindowDays,
        busyCalendarIds: state.busyCalendarIds,
        effectiveFrom: state.effectiveFrom,
      }),
    { invalidate: AP_RULES },
  );
  const number = (value: number, set: (n: number) => void, label: string, max: number, min = 0) => (
    <input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      value={value}
      className={`${CONTROL} min-h-9 w-24`}
      onChange={(event) => set(Math.min(max, Math.max(min, Number(event.target.value) || min)))}
    />
  );
  return (
    <>
      <Group
        title="Date-Specific Hours"
        hint="Change the hours for one date without touching the weekly schedule."
      >
        {state.dateOverrides.length === 0 ? (
          <Quiet>No date overrides.</Quiet>
        ) : (
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {state.dateOverrides.map((o) => (
              <li key={o.date} className="flex items-center justify-between gap-2">
                <span>
                  {o.date}:{' '}
                  {o.ranges.length === 0
                    ? 'Day off'
                    : o.ranges
                        .map((r) => `${timeText(r.startsAt)} – ${timeText(r.endsAt)}`)
                        .join(', ')}
                </span>
                <button
                  type="button"
                  aria-label={`Remove override for ${o.date}`}
                  onClick={() =>
                    change({ dateOverrides: state.dateOverrides.filter((x) => x.date !== o.date) })
                  }
                  className="text-muted hover:text-danger"
                >
                  <Trash aria-hidden weight="fill" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Date" htmlFor="ov-date">
            <input
              id="ov-date"
              type="date"
              className={`${CONTROL} min-h-9`}
              value={override.date}
              onChange={(event) => setOverride({ ...override, date: event.target.value })}
            />
          </Field>
          {override.off ? null : (
            <>
              <TimeSelect
                label="Override start"
                value={override.start}
                onChange={(start) => setOverride({ ...override, start })}
              />
              <TimeSelect
                label="Override end"
                value={override.end}
                onChange={(end) => setOverride({ ...override, end })}
              />
            </>
          )}
          <Checkbox
            label="Day off"
            checked={override.off}
            onChange={(event) => setOverride({ ...override, off: event.target.checked })}
            className="min-h-9"
          />
          <Button
            variant="secondary"
            disabled={!override.date || (!override.off && override.end <= override.start)}
            onClick={() => {
              change({
                dateOverrides: [
                  ...state.dateOverrides.filter((x) => x.date !== override.date),
                  {
                    date: override.date,
                    ranges: override.off
                      ? []
                      : [{ startsAt: override.start, endsAt: override.end }],
                  },
                ],
              });
              setOverride({ ...override, date: '' });
            }}
          >
            Add override
          </Button>
        </div>
      </Group>

      <Group title="Time Off / Vacation" hint="Dates with no bookable time, inclusive.">
        {state.timeOff.length === 0 ? (
          <Quiet>No time off planned.</Quiet>
        ) : (
          <ul className="mb-3 flex flex-col gap-1 text-sm">
            {state.timeOff.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span>
                  {t.from === t.to ? t.from : `${t.from} to ${t.to}`}
                  {t.reason ? ` · ${t.reason}` : ''}
                </span>
                <button
                  type="button"
                  aria-label={`Remove time off ${t.from}`}
                  onClick={() => change({ timeOff: state.timeOff.filter((x) => x.id !== t.id) })}
                  className="text-muted hover:text-danger"
                >
                  <Trash aria-hidden weight="fill" className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From" htmlFor="off-from">
            <input
              id="off-from"
              type="date"
              className={`${CONTROL} min-h-9`}
              value={off.from}
              onChange={(event) => setOff({ ...off, from: event.target.value })}
            />
          </Field>
          <Field label="To" htmlFor="off-to">
            <input
              id="off-to"
              type="date"
              className={`${CONTROL} min-h-9`}
              value={off.to}
              onChange={(event) => setOff({ ...off, to: event.target.value })}
            />
          </Field>
          <Field label="Reason (optional)" htmlFor="off-reason">
            <input
              id="off-reason"
              className={`${CONTROL} min-h-9`}
              value={off.reason}
              onChange={(event) => setOff({ ...off, reason: event.target.value })}
            />
          </Field>
          <Button
            variant="secondary"
            disabled={!off.from || !off.to || off.to < off.from}
            onClick={() => {
              change({
                timeOff: [
                  ...state.timeOff,
                  {
                    id: crypto.randomUUID(),
                    from: off.from,
                    to: off.to,
                    reason: off.reason.trim() || null,
                  },
                ],
              });
              setOff({ from: '', to: '', reason: '' });
            }}
          >
            Add time off
          </Button>
        </div>
      </Group>

      <Group
        title="Booking Rules"
        hint="Buffers around appointments and how soon, and how far ahead, people can book."
        footer={
          <>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate(undefined, { onSuccess: () => setDone('Availability saved.') })
              }
            >
              Save availability
            </Button>
            <Result error={save.error} done={done} />
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Buffer before (minutes)">
            {number(
              state.bufferBeforeMinutes,
              (n) => change({ bufferBeforeMinutes: n }),
              'Buffer before',
              120,
            )}
          </Field>
          <Field label="Buffer after (minutes)">
            {number(
              state.bufferAfterMinutes,
              (n) => change({ bufferAfterMinutes: n }),
              'Buffer after',
              120,
            )}
          </Field>
          <Field label="Minimum booking notice (hours)">
            {number(
              state.minNoticeHours,
              (n) => change({ minNoticeHours: n }),
              'Minimum notice',
              720,
            )}
          </Field>
          <Field label="Maximum booking window (days)">
            {number(
              state.maxWindowDays,
              (n) => change({ maxWindowDays: n }),
              'Maximum window',
              730,
              1,
            )}
          </Field>
          <Field label="Effective from" htmlFor="eff-date">
            <div className="flex items-center gap-2">
              <input
                id="eff-date"
                type="date"
                className={`${CONTROL} min-h-9`}
                value={state.effectiveFrom ?? ''}
                onChange={(event) => change({ effectiveFrom: event.target.value || null })}
              />
            </div>
          </Field>
        </div>
        <div className="mt-4">
          <p className="text-sm font-medium text-text">Calendars that block my time</p>
          {state.busyCalendarIds.length === 0 ? (
            <Quiet>
              No calendar is connected.{' '}
              <Link href="/modules/integrations" className="text-link underline">
                Connect Google or Outlook
              </Link>{' '}
              to block time that is busy there. Only the busy time is read, never the event.
            </Quiet>
          ) : (
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {state.busyCalendarIds.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          )}
        </div>
      </Group>
    </>
  );
}

/* ---------- Blocked time (R12's api.availability) ---------- */

function BlockedTimes({ userId, timeZone }: { userId: string; timeZone: string }) {
  const today = todayIn(timeZone);
  const range = {
    from: dayRange(today, timeZone).from,
    to: dayRange(addDays(today, 90), timeZone).from,
  };
  const blocks = useApiQuery([...AVAIL, 'blocks', userId], () =>
    api.availability.blockedTimes({ ...range, userId }),
  );
  const [draft, setDraft] = useState({ date: '', start: '12:00', end: '13:00', reason: '' });
  const add = useApiMutation(
    () =>
      api.availability.block({
        userId,
        startsAt: new Date(`${draft.date}T${draft.start}:00`).toISOString(),
        endsAt: new Date(`${draft.date}T${draft.end}:00`).toISOString(),
        reason: draft.reason.trim() || null,
      } as never),
    { invalidate: AVAIL },
  );
  const remove = useApiMutation((id: string) => api.availability.unblock(id), {
    invalidate: AVAIL,
  });
  const rows: BlockedTime[] = blocks.data ?? [];
  return (
    <Group title="Blocked Time" hint="Time nobody can book, one time or on a day you choose.">
      {blocks.isError ? (
        <Quiet>Blocked time is not available right now.</Quiet>
      ) : rows.length === 0 ? (
        <Quiet>{blocks.isPending ? 'Loading…' : 'No blocked time in the next 90 days.'}</Quiet>
      ) : (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {rows.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2">
              <span>
                {new Date(b.startsAt).toLocaleString('en-US', {
                  timeZone,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}{' '}
                – {new Date(b.endsAt).toLocaleTimeString('en-US', { timeZone, timeStyle: 'short' })}
                {b.reason ? ` · ${b.reason}` : ''}
              </span>
              <button
                type="button"
                aria-label={`Remove block on ${b.startsAt}`}
                onClick={() => remove.mutate(b.id)}
                className="text-muted hover:text-danger"
              >
                <Trash aria-hidden weight="fill" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Date" htmlFor="blk-date">
          <input
            id="blk-date"
            type="date"
            className={`${CONTROL} min-h-9`}
            value={draft.date}
            onChange={(event) => setDraft({ ...draft, date: event.target.value })}
          />
        </Field>
        <TimeSelect
          label="Block start"
          value={draft.start}
          onChange={(start) => setDraft({ ...draft, start })}
        />
        <TimeSelect
          label="Block end"
          value={draft.end}
          onChange={(end) => setDraft({ ...draft, end })}
        />
        <Field label="Reason (optional)" htmlFor="blk-reason">
          <input
            id="blk-reason"
            className={`${CONTROL} min-h-9`}
            value={draft.reason}
            onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
          />
        </Field>
        <Button
          variant="secondary"
          disabled={!draft.date || draft.end <= draft.start || add.isPending}
          onClick={() => add.mutate(undefined)}
        >
          Add block
        </Button>
      </div>
      <div className="mt-2">
        <Result error={add.error ?? remove.error} />
      </div>
    </Group>
  );
}

/**
 * Edit My Availability (Owner and Admin: anyone's). Weekly hours, date overrides, time off,
 * blocked time, buffers, booking notice and window, and the calendars that block time. Each part
 * keeps its frame when its data is missing.
 */
export function RulesEditor({ userId, compact }: { userId: string; compact?: boolean }) {
  const week = useApiQuery([...AVAIL, 'week'], () => api.availability.get());
  const rules = useApiQuery([...AP_RULES, userId], async () =>
    userId ? api.scheduling.rules(userId) : null,
  );
  const timeZone = week.data?.timezone ?? FALLBACK_ZONE;
  const member = useMemo(
    () => week.data?.members.find((m) => m.member.userId === userId),
    [week.data, userId],
  );
  if (!userId) return <Quiet>Choose a staff member to edit their availability.</Quiet>;
  return (
    <div className={`flex flex-col gap-4 ${compact ? 'text-sm' : ''}`} data-testid="rules-editor">
      {week.data && member ? (
        <WeeklyForm key={userId} member={member} userId={userId} />
      ) : (
        <Group title="Weekly Working Hours" hint="Bookable hours by weekday.">
          <Quiet>
            {week.isPending
              ? 'Loading…'
              : week.data
                ? 'No weekly hours are on record for this person.'
                : 'Weekly hours are not available right now.'}
          </Quiet>
        </Group>
      )}
      {rules.data ? (
        <RulesForm key={userId} rules={rules.data} userId={userId} />
      ) : (
        <Group title="Booking Rules" hint="Date overrides, time off, buffers, notice and window.">
          <Quiet>
            {rules.isPending ? 'Loading…' : 'Availability rules are not available right now.'}
          </Quiet>
        </Group>
      )}
      <BlockedTimes userId={userId} timeZone={timeZone} />
    </div>
  );
}
