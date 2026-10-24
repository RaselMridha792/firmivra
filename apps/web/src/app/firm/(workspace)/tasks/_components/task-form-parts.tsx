'use client';

import { ArrowDown, ArrowUp, Copy, Plus, Trash, X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { timeText } from './task-shared';

/** The parts Create / Edit Task and the template editor share. */
export const field =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';

export function Selectbox({
  value,
  onChange,
  options,
  id,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={field}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Section({
  step,
  title,
  subtitle,
  aside,
  children,
  testId,
}: {
  step?: number;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {step ? (
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action"
            >
              {step}
            </span>
          ) : null}
          <div>
            <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
            {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export const Label = ({
  text,
  required,
  children,
  htmlFor,
}: {
  text: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={htmlFor} className="text-sm font-medium text-text">
      {text}
      {required ? <span className="text-danger"> *</span> : null}
    </label>
    {children}
  </div>
);

export interface Item {
  key: string;
  id?: string;
  label: string;
  required: boolean;
  done: boolean;
}
export interface Reminder {
  key: string;
  /** NaN while a custom number is being typed (the form says what to fix). */
  daysBefore: number;
  /** HH:MM, or null for the firm's usual reminder time. */
  timeOfDay: string | null;
  /** Octavia's A3: any number of days before, and a time of day if wanted. */
  custom: boolean;
}
export const DAYS = [0, 1, 2, 3, 7, 14, 30];

/** Every half hour, HH:MM. */
export const TIMES = Array.from({ length: 48 }, (_, i) => {
  const m = i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

/** Saved reminders as rows: one that is not a preset, or has a time, is a custom one. */
export const toReminders = (list: { daysBefore: number; timeOfDay: string | null }[]) =>
  list.map((r, i) => ({
    key: `r${i}`,
    daysBefore: r.daysBefore,
    timeOfDay: r.timeOfDay,
    custom: r.timeOfDay !== null || !DAYS.includes(r.daysBefore),
  }));

/**
 * What the API would refuse (INVALID_REMINDER), said first: a custom number outside 0 to 365, two
 * reminders alike, a same-day one after the due time.
 */
export function reminderProblem(list: Reminder[], dueTime?: string | null): string | undefined {
  if (list.some((r) => !Number.isInteger(r.daysBefore) || r.daysBefore < 0 || r.daysBefore > 365))
    return 'Enter 0 to 365 days before the due date.';
  const keys = list.map((r) => `${r.daysBefore}@${r.timeOfDay ?? ''}`);
  if (new Set(keys).size < keys.length) return 'Two reminders are the same. Remove one.';
  if (dueTime && list.some((r) => r.daysBefore === 0 && r.timeOfDay && r.timeOfDay > dueTime))
    return 'A same-day reminder cannot be after the due time.';
  return undefined;
}

/**
 * The checklist rows: edit the text, mark Required, move up or down, duplicate (Octavia's C11: a
 * separate copy, not done, just below), delete. A task shows each item's done box (read only
 * here; it is ticked on the task); a template and a series have none.
 */
export function ChecklistItems({
  items,
  onChange,
  showDone,
}: {
  items: Item[];
  onChange: (items: Item[]) => void;
  showDone: boolean;
}) {
  const move = (i: number, step: -1 | 1) => {
    const j = i + step;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j] as Item, next[i] as Item];
    onChange(next);
  };
  const duplicate = (i: number) => {
    const it = items[i] as Item;
    const copy: Item = {
      key: `${it.key}-copy-${Date.now()}`,
      label: it.label,
      required: it.required,
      done: false,
    };
    onChange([...items.slice(0, i + 1), copy, ...items.slice(i + 1)]);
  };
  if (items.length === 0)
    return (
      <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
        No checklist items yet.
      </p>
    );
  return (
    <ul className="flex flex-col gap-2" data-testid="form-checklist-items">
      {items.map((it, i) => (
        <li key={it.key} className="flex items-center gap-2">
          {showDone ? (
            <input
              type="checkbox"
              aria-label={`Item ${i + 1} done`}
              checked={it.done}
              disabled
              className="size-5 shrink-0"
            />
          ) : null}
          <input
            aria-label={`Checklist item ${i + 1}`}
            className={field}
            value={it.label}
            maxLength={300}
            onChange={(e) =>
              onChange(items.map((x) => (x.key === it.key ? { ...x, label: e.target.value } : x)))
            }
          />
          <label className="flex shrink-0 items-center gap-1 text-xs text-text">
            <input
              type="checkbox"
              checked={it.required}
              onChange={(e) =>
                onChange(
                  items.map((x) => (x.key === it.key ? { ...x, required: e.target.checked } : x)),
                )
              }
              className="size-4"
            />
            Required
          </label>
          <button
            type="button"
            aria-label={`Move item ${i + 1} up`}
            disabled={i === 0}
            onClick={() => move(i, -1)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider disabled:opacity-40"
          >
            <ArrowUp aria-hidden weight="bold" className="size-3" />
          </button>
          <button
            type="button"
            aria-label={`Move item ${i + 1} down`}
            disabled={i === items.length - 1}
            onClick={() => move(i, 1)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider disabled:opacity-40"
          >
            <ArrowDown aria-hidden weight="bold" className="size-3" />
          </button>
          <button
            type="button"
            aria-label={`Duplicate item ${i + 1}`}
            onClick={() => duplicate(i)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider text-action"
          >
            <Copy aria-hidden weight="fill" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Delete item ${i + 1}`}
            onClick={() => onChange(items.filter((x) => x.key !== it.key))}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider text-danger"
          >
            <Trash aria-hidden weight="fill" className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The reminders, each a number of days before the due date, with Add Reminder. Custom… takes any
 * number of days (0 to 365) and, if wanted, a time of day; the presets use the firm's usual time.
 */
export function ReminderList({
  reminders,
  onChange,
}: {
  reminders: Reminder[];
  onChange: (reminders: Reminder[]) => void;
}) {
  const set = (key: string, change: Partial<Reminder>) =>
    onChange(reminders.map((x) => (x.key === key ? { ...x, ...change } : x)));
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {reminders.map((r, i) => (
        <li key={r.key} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <select
              aria-label={`Reminder ${i + 1}`}
              className={field}
              value={r.custom ? 'custom' : r.daysBefore}
              onChange={(e) =>
                e.target.value === 'custom'
                  ? set(r.key, { custom: true })
                  : set(r.key, {
                      custom: false,
                      timeOfDay: null,
                      daysBefore: Number(e.target.value),
                    })
              }
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'} before`}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            <button
              type="button"
              aria-label={`Remove reminder ${i + 1}`}
              onClick={() => onChange(reminders.filter((x) => x.key !== r.key))}
              className="text-muted hover:text-danger"
            >
              <X aria-hidden weight="bold" className="size-4" />
            </button>
          </div>
          {r.custom ? (
            <div className="flex items-center gap-2 pr-6 text-sm text-text">
              <input
                type="number"
                min={0}
                max={365}
                inputMode="numeric"
                aria-label={`Reminder ${i + 1} days before`}
                className={`${field} w-20!`}
                value={Number.isNaN(r.daysBefore) ? '' : r.daysBefore}
                onChange={(e) =>
                  set(r.key, {
                    daysBefore: e.target.value === '' ? Number.NaN : Number(e.target.value),
                  })
                }
              />
              <span className="shrink-0">days before, at</span>
              <select
                aria-label={`Reminder ${i + 1} time`}
                className={field}
                value={r.timeOfDay ?? ''}
                onChange={(e) => set(r.key, { timeOfDay: e.target.value || null })}
              >
                <option value="">the usual time</option>
                {TIMES.map((t) => (
                  <option key={t} value={t}>
                    {timeText(t)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...reminders,
              {
                key: `r${reminders.length}-${Date.now()}`,
                daysBefore: 1,
                timeOfDay: null,
                custom: false,
              },
            ])
          }
          className="inline-flex items-center gap-1 text-sm font-medium text-link"
        >
          <Plus aria-hidden weight="bold" className="size-4" /> Add Reminder
        </button>
      </li>
    </ul>
  );
}
