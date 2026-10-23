'use client';

import { ArrowDown, ArrowUp, Plus, Trash, X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

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
  daysBefore: number;
}
export const DAYS = [0, 1, 2, 3, 7, 14, 30];

/**
 * The checklist rows: edit the text, mark Required, move up or down, delete. A task shows each
 * item's done box (read only here; it is ticked on the task); a template has none.
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

/** The reminders, each a number of days before the due date, with Add Reminder. */
export function ReminderList({
  reminders,
  onChange,
}: {
  reminders: Reminder[];
  onChange: (reminders: Reminder[]) => void;
}) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {reminders.map((r, i) => (
        <li key={r.key} className="flex items-center gap-2">
          <select
            aria-label={`Reminder ${i + 1}`}
            className={field}
            value={r.daysBefore}
            onChange={(e) =>
              onChange(
                reminders.map((x) =>
                  x.key === r.key ? { ...x, daysBefore: Number(e.target.value) } : x,
                ),
              )
            }
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'} before`}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Remove reminder ${i + 1}`}
            onClick={() => onChange(reminders.filter((x) => x.key !== r.key))}
            className="text-muted hover:text-danger"
          >
            <X aria-hidden weight="bold" className="size-4" />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={() =>
            onChange([...reminders, { key: `r${reminders.length}-${Date.now()}`, daysBefore: 1 }])
          }
          className="inline-flex items-center gap-1 text-sm font-medium text-link"
        >
          <Plus aria-hidden weight="bold" className="size-4" /> Add Reminder
        </button>
      </li>
    </ul>
  );
}
