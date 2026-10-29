'use client';

import {
  type InvoiceRecurrence,
  type InvoiceRecurrenceInput,
  RECURRING_FREQUENCY_LABELS,
  RECURRING_LIMITS,
  RECURRING_UNIT_LABELS,
  recurrenceLabel,
  RecurringFrequency,
  RecurringIntervalUnit,
  recurringPeriodOn,
} from '@firmivra/types';
import { Input, Radio, Select, Toggle } from '@firmivra/ui';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { card, dayText } from './inv-shared';

/** IP-F05: the Recurring card's fields as typed. */
export interface RecurringDraft {
  on: boolean;
  frequency: RecurringFrequency;
  intervalCount: string;
  intervalUnit: RecurringIntervalUnit;
  ends: 'NEVER' | 'ON' | 'AFTER';
  endOn: string;
  maxOccurrences: string;
}

/** The draft's schedule as the card shows it; off for a one-time invoice. */
export const recurringDraftOf = (r: InvoiceRecurrence | null | undefined): RecurringDraft => ({
  on: r != null,
  frequency: r?.frequency ?? 'MONTHLY',
  intervalCount: String(r?.intervalCount ?? 2),
  intervalUnit: r?.intervalUnit ?? 'WEEK',
  ends: r?.endOn ? 'ON' : r?.maxOccurrences ? 'AFTER' : 'NEVER',
  endOn: r?.endOn ?? '',
  maxOccurrences: String(r?.maxOccurrences ?? 12),
});

/** What the draft sends as `recurring`: null keeps it one-time. */
export function recurringBody(d: RecurringDraft): InvoiceRecurrenceInput | null {
  if (!d.on) return null;
  const custom = d.frequency === 'CUSTOM';
  return {
    frequency: d.frequency,
    intervalCount: custom ? Number(d.intervalCount) : null,
    intervalUnit: custom ? d.intervalUnit : null,
    endOn: d.ends === 'ON' ? d.endOn || null : null,
    maxOccurrences: d.ends === 'AFTER' ? Number(d.maxOccurrences) : null,
  };
}

/** A custom interval the API takes: a whole 1 to 52. */
const countOk = (d: RecurringDraft) => {
  const n = Number(d.intervalCount);
  return (
    Number.isInteger(n) && n >= RECURRING_LIMITS.minInterval && n <= RECURRING_LIMITS.maxInterval
  );
};

/** The schedule's next days after the first (`startOn`), as the API counts them. */
export function upcomingDays(d: RecurringDraft, startOn: string, n = 3): string[] {
  const body = recurringBody(d);
  if (!body || (body.frequency === 'CUSTOM' && !countOk(d))) return [];
  return Array.from({ length: n }, (_, k) => recurringPeriodOn(startOn, body, k + 1));
}

/**
 * Create Invoice's Recurring card: off keeps a one-time invoice; on, the frequency (named, or
 * every N weeks, months or years) and the end rule. The schedule starts when the invoice is sent;
 * nothing is sent or charged automatically.
 */
export function RecurringCard({
  value,
  onChange,
  startOn,
  errors,
}: {
  value: RecurringDraft;
  onChange: (next: RecurringDraft) => void;
  /** The day the invoice opens: its Send On, or today. */
  startOn: string;
  errors: Record<string, string>;
}) {
  const set = (patch: Partial<RecurringDraft>) => onChange({ ...value, ...patch });
  const body = recurringBody(value);
  const next = upcomingDays(value, startOn);
  const endOn = body?.endOn ?? null;
  const shown = next.filter((d) => !endOn || d <= endOn);
  return (
    <section className={card} aria-labelledby="inv-recurring" data-testid="invoice-recurring">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="inv-recurring"
          className="flex items-center gap-2 font-display text-xl font-bold text-heading"
        >
          <ArrowsClockwise aria-hidden weight="bold" className="size-6 text-action" /> Recurring
        </h2>
        <Toggle label="Repeat this invoice" checked={value.on} onChange={(on) => set({ on })} />
      </div>
      {!value.on ? (
        <p className="text-sm text-muted">Off: this is a one-time invoice.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            label="Frequency"
            value={value.frequency}
            onChange={(e) => set({ frequency: RecurringFrequency.parse(e.target.value) })}
            options={RecurringFrequency.options.map((f) => ({
              value: f,
              label: RECURRING_FREQUENCY_LABELS[f],
            }))}
          />
          {value.frequency === 'CUSTOM' ? (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Repeat every"
                type="number"
                min={RECURRING_LIMITS.minInterval}
                max={RECURRING_LIMITS.maxInterval}
                step={1}
                value={value.intervalCount}
                error={errors['recurring.intervalCount']}
                onChange={(e) => set({ intervalCount: e.target.value })}
              />
              <Select
                label="Unit"
                value={value.intervalUnit}
                error={errors['recurring.intervalUnit']}
                onChange={(e) => set({ intervalUnit: RecurringIntervalUnit.parse(e.target.value) })}
                options={RecurringIntervalUnit.options.map((u) => ({
                  value: u,
                  label: RECURRING_UNIT_LABELS[u][1].replace(/^./, (c) => c.toUpperCase()),
                }))}
              />
            </div>
          ) : null}
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">Ends</legend>
            <Radio
              name="recurring-ends"
              label="Never"
              checked={value.ends === 'NEVER'}
              onChange={() => set({ ends: 'NEVER' })}
            />
            <Radio
              name="recurring-ends"
              label="On a date"
              checked={value.ends === 'ON'}
              onChange={() => set({ ends: 'ON' })}
            />
            {value.ends === 'ON' ? (
              <Input
                label="End date"
                type="date"
                min={next[0] ?? startOn}
                value={value.endOn}
                error={errors['recurring.endOn']}
                onChange={(e) => set({ endOn: e.target.value })}
              />
            ) : null}
            <Radio
              name="recurring-ends"
              label="After a number of invoices"
              checked={value.ends === 'AFTER'}
              onChange={() => set({ ends: 'AFTER' })}
            />
            {value.ends === 'AFTER' ? (
              <Input
                label="Number of invoices, this one included"
                type="number"
                min={RECURRING_LIMITS.minOccurrences}
                max={RECURRING_LIMITS.maxOccurrences}
                step={1}
                value={value.maxOccurrences}
                error={errors['recurring.maxOccurrences']}
                onChange={(e) => set({ maxOccurrences: e.target.value })}
              />
            ) : null}
          </fieldset>
          <div className="rounded-lg bg-canvas p-3 text-sm" data-testid="recurring-summary">
            <p className="font-semibold text-heading">
              {body && (body.frequency !== 'CUSTOM' || countOk(value))
                ? recurrenceLabel(body)
                : RECURRING_FREQUENCY_LABELS.CUSTOM}
              , starting {dayText(startOn)}
            </p>
            <p className="text-muted">
              {next.length === 0
                ? 'Enter how often, every 1 to 52, to see the next dates.'
                : shown.length === 0
                  ? `It ends before the next invoice on ${dayText(next[0])}.`
                  : `Next: ${shown.map(dayText).join(', ')}`}
            </p>
          </div>
          <p className="text-xs text-muted">
            The schedule starts when you send this invoice. Nothing is sent or charged
            automatically: auto-send and AutoPay stay off.
          </p>
        </div>
      )}
    </section>
  );
}
