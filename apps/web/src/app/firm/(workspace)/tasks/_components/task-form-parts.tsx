'use client';

import {
  TASK_REMINDER_MAX_MINUTES,
  TASK_REMINDER_UNIT_MINUTES,
  type TaskReminderUnit,
} from '@firmivra/types';
import { ArrowDown, ArrowUp, Copy, Plus, Trash, X } from '@phosphor-icons/react';
import { type ReactNode, useRef, useState } from 'react';
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
/** T-C11: what Create Task's Recurring switch carries to Set Up Recurring Task. */
const RECURRING_HANDOFF = 'fv-task-recurring-handoff';
export function handOffToRecurring(v: { title: string; items: readonly Item[] }): void {
  try {
    window.sessionStorage.setItem(
      RECURRING_HANDOFF,
      JSON.stringify({
        title: v.title,
        items: v.items
          .filter((i) => i.label.trim())
          .map((i) => ({ label: i.label, required: i.required })),
      }),
    );
  } catch {
    // No storage (a private window): the recurring form starts empty.
  }
}
/** Taken once: the title and checklist Create Task handed over, or null. */
export function takeRecurringHandoff(): { title: string; items: Item[] } | null {
  try {
    const raw = window.sessionStorage.getItem(RECURRING_HANDOFF);
    window.sessionStorage.removeItem(RECURRING_HANDOFF);
    if (!raw) return null;
    const v = JSON.parse(raw) as { title?: unknown; items?: unknown };
    const items = Array.isArray(v.items) ? v.items.slice(0, 50) : [];
    return {
      title: typeof v.title === 'string' ? v.title.slice(0, 200) : '',
      items: items.map((i: { label?: unknown; required?: unknown }, n) => ({
        key: `h${n}`,
        label: String(i.label ?? '').slice(0, 200),
        required: i.required === true,
        done: false,
      })),
    };
  } catch {
    return null;
  }
}

export interface Reminder {
  key: string;
  /** NaN while a custom number is being typed (the form says what to fix). */
  daysBefore: number;
  /** HH:MM, or null for the firm's usual reminder time. */
  timeOfDay: string | null;
  /** Any number of days before, and a time of day if wanted. */
  custom: boolean;
  /**
   * Octavia's A3 Custom (#1081): `amount` minutes, hours or days before the due date and time
   * (NaN while typed); null for a days rule.
   */
  amount: number | null;
  unit: TaskReminderUnit | null;
}
export const DAYS = [0, 1, 2, 3, 7, 14, 30];
const UNIT_WORD: Record<TaskReminderUnit, string> = {
  MINUTES: 'minute',
  HOURS: 'hour',
  DAYS: 'day',
};
/** "30 minutes before the due time", "1 hour before the due time". */
export const beforeText = (amount: number, unit: TaskReminderUnit) =>
  `${amount} ${UNIT_WORD[unit]}${amount === 1 ? '' : 's'} before the due time`;
/** A new row: one day before, at the usual time. */
export const newReminder = (key: string): Reminder => ({
  key,
  daysBefore: 1,
  timeOfDay: null,
  custom: false,
  amount: null,
  unit: null,
});

/** Every half hour, HH:MM. */
export const TIMES = Array.from({ length: 48 }, (_, i) => {
  const m = i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

/**
 * Saved reminders as rows: one with an amount and unit is a Custom one before the due time; a
 * days rule that is not a preset, or has a time, is a days-and-time one.
 */
export const toReminders = (
  list: {
    daysBefore: number;
    timeOfDay: string | null;
    amount?: number | null;
    unit?: TaskReminderUnit | null;
  }[],
): Reminder[] =>
  list.map((r, i) => {
    const before = r.amount != null && r.unit != null;
    return {
      key: `r${i}`,
      daysBefore: r.daysBefore,
      timeOfDay: before ? null : r.timeOfDay,
      custom: !before && (r.timeOfDay !== null || !DAYS.includes(r.daysBefore)),
      amount: before ? (r.amount ?? null) : null,
      unit: before ? (r.unit ?? null) : null,
    };
  });

/** A row as the API takes it: a Custom amount and unit, or days and a time. */
export const reminderBody = (r: Reminder) =>
  r.unit
    ? { amount: r.amount, unit: r.unit, timeOfDay: null }
    : { daysBefore: r.daysBefore, timeOfDay: r.timeOfDay };

/**
 * What the API would refuse (INVALID_REMINDER), said first: a custom number outside 0 to 365, two
 * reminders alike, a same-day one after the due time.
 */
export function reminderProblem(list: Reminder[], dueTime?: string | null): string | undefined {
  const before = list.filter((r) => r.unit);
  const days = list.filter((r) => !r.unit);
  if (days.some((r) => !Number.isInteger(r.daysBefore) || r.daysBefore < 0 || r.daysBefore > 365))
    return 'Enter 0 to 365 days before the due date.';
  if (
    before.some((r) => !Number.isInteger(r.amount) || (r.amount ?? 0) < 1 || (r.amount ?? 0) > 999)
  )
    return 'Enter 1 to 999 for a Custom reminder.';
  const minutes = before.map((r) => (r.amount ?? 0) * TASK_REMINDER_UNIT_MINUTES[r.unit!]);
  if (minutes.some((m) => m > TASK_REMINDER_MAX_MINUTES))
    return 'A Custom reminder can be at most 365 days before.';
  if (before.length && !dueTime)
    return 'A Custom reminder counts back from the due time: turn off All Day and set the time.';
  const keys = [
    ...days.map((r) => `${r.daysBefore}@${r.timeOfDay ?? ''}`),
    ...minutes.map((m) => `m${m}`),
  ];
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
 * The reminders, with Add Reminder: a number of days before the due date (the presets, at the
 * firm's usual time), Days and time… (any number of days, 0 to 365, and a time of day if wanted)
 * and, where the form has a due time, Octavia's A3 Custom… (#1081): a number of minutes, hours or
 * days before the due date and time.
 */
export function ReminderList({
  reminders,
  onChange,
  allowBefore = false,
}: {
  reminders: Reminder[];
  onChange: (reminders: Reminder[]) => void;
  /** Offer Custom… (minutes, hours or days before the due time): a task, not a template. */
  allowBefore?: boolean;
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
              value={r.unit ? 'before' : r.custom ? 'custom' : r.daysBefore}
              onChange={(e) =>
                e.target.value === 'before'
                  ? set(r.key, { custom: false, timeOfDay: null, amount: 1, unit: 'HOURS' })
                  : e.target.value === 'custom'
                    ? set(r.key, { custom: true, amount: null, unit: null })
                    : set(r.key, {
                        custom: false,
                        timeOfDay: null,
                        amount: null,
                        unit: null,
                        daysBefore: Number(e.target.value),
                      })
              }
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'} before`}
                </option>
              ))}
              <option value="custom">Days and time…</option>
              {allowBefore || r.unit ? <option value="before">Custom…</option> : null}
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
          {r.unit ? (
            <div className="flex flex-wrap items-center gap-2 pr-6 text-sm text-text">
              <input
                type="number"
                min={1}
                max={999}
                inputMode="numeric"
                aria-label={`Reminder ${i + 1} amount`}
                className={`${field} w-24!`}
                value={r.amount === null || Number.isNaN(r.amount) ? '' : r.amount}
                onChange={(e) =>
                  set(r.key, {
                    amount: e.target.value === '' ? Number.NaN : Number(e.target.value),
                  })
                }
              />
              <select
                aria-label={`Reminder ${i + 1} unit`}
                className={`${field} w-28!`}
                value={r.unit}
                onChange={(e) => set(r.key, { unit: e.target.value as TaskReminderUnit })}
              >
                <option value="MINUTES">Minutes</option>
                <option value="HOURS">Hours</option>
                <option value="DAYS">Days</option>
              </select>
              <span className="shrink-0">before the due time</span>
            </div>
          ) : null}
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
            onChange([...reminders, newReminder(`r${reminders.length}-${Date.now()}`)])
          }
          className="inline-flex items-center gap-1 text-sm font-medium text-link"
        >
          <Plus aria-hidden weight="bold" className="size-4" /> Add Reminder
        </button>
      </li>
    </ul>
  );
}

/**
 * Tasks Review Two T-C09: the Client field, one combobox. Typing searches the firm's clients on the
 * server (Staff: their assigned ones); the list shows under the input with a loading row, "No
 * clients match" only once the search has answered, click or Enter to choose, and Clear.
 */
export function ClientCombobox({
  id,
  chosen,
  text,
  onText,
  results,
  loading,
  failed,
  onChoose,
  onClear,
  disabled,
}: {
  id: string;
  /** The chosen client's name, or empty. */
  chosen: string;
  /** What is typed. */
  text: string;
  onText: (text: string) => void;
  results: readonly { id: string; displayName: string }[];
  /** The search has not answered yet (typing, debounce or request). */
  loading: boolean;
  failed: boolean;
  onChoose: (client: { id: string; displayName: string }) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Closing on blur waits a moment (a click on an option lands first); focus again cancels it.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listId = `${id}-list`;
  const choose = (c: { id: string; displayName: string }) => {
    onChoose(c);
    setOpen(false);
  };
  const shown = open && !disabled;
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          id={id}
          role="combobox"
          aria-label="Client"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Search clients by name…"
          className={field}
          maxLength={100}
          disabled={disabled}
          value={open ? text : chosen || text}
          onFocus={() => {
            clearTimeout(closeTimerRef.current);
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => {
            closeTimerRef.current = setTimeout(() => setOpen(false), 150);
          }}
          onChange={(e) => {
            onText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && shown && results[active] && !loading) {
              e.preventDefault();
              choose(results[active]);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {chosen && !disabled ? (
          <button
            type="button"
            className="shrink-0 rounded-control p-2 text-muted hover:text-danger"
            aria-label="Clear client"
            onClick={onClear}
          >
            <X aria-hidden weight="bold" className="size-4" />
          </button>
        ) : null}
      </div>
      {shown ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Clients"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-control border border-border bg-surface py-1 shadow-md"
        >
          {failed ? (
            <li className="px-3 py-2 text-sm text-danger" role="presentation">
              Clients are not available
            </li>
          ) : loading ? (
            <li className="px-3 py-2 text-sm text-muted" role="presentation">
              Searching…
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted" role="presentation">
              No clients match
            </li>
          ) : (
            results.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === active}
                className={`cursor-pointer px-3 py-2 text-sm text-text ${i === active ? 'bg-accent-soft' : 'hover:bg-canvas'}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
              >
                {c.displayName}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
