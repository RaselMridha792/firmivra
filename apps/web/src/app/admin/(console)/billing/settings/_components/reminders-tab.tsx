'use client';

import { FormField } from '@firmivra/ui';
import type { BillingSettings, ReminderRule } from '../../../../../../mocks/admin-billing';
import { NumberControl, SettingsCard, ToggleRow, type SettingsForm } from './settings-parts';

/**
 * Reminders (docx §15): invoice due, overdue (with its cadence), estimate expiration and failed
 * payment reminders, and whether firms may change them. The messages are on Templates.
 */

type Reminders = BillingSettings['reminders'];
type RuleKey = 'invoiceDue' | 'overdue' | 'estimateExpiring' | 'failedPayment';

const RULES: { key: RuleKey; title: string; description: string; when: string }[] = [
  {
    key: 'invoiceDue',
    title: 'Invoice Due Reminder',
    description: 'Remind the client before an invoice is due.',
    when: 'Days before the due date',
  },
  {
    key: 'overdue',
    title: 'Overdue Reminder',
    description: 'Remind the client after the due date has passed, then repeat.',
    when: 'Days after the due date',
  },
  {
    key: 'estimateExpiring',
    title: 'Estimate Expiration Reminder',
    description: 'Remind the client before an estimate expires.',
    when: 'Days before it expires',
  },
  {
    key: 'failedPayment',
    title: 'Failed Payment Notice',
    description: 'Tell the client when an online payment or AutoPay fails (0 sends it at once).',
    when: 'Days after the failure',
  },
];

export function RemindersTab({ form }: { form: SettingsForm | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {RULES.map((rule) => (
        <SettingsCard
          key={rule.key}
          title={rule.title}
          description={rule.description}
          testId={`settings-reminder-${rule.key}`}
        >
          {form ? <ReminderFields form={form} rule={rule} /> : null}
        </SettingsCard>
      ))}
      <SettingsCard title="Firm Overrides" description="Who decides reminder timing for a firm.">
        {form ? (
          <ToggleRow
            label="Firms May Change Reminders"
            description="Firms can turn reminders off or change their timing; these stay the defaults."
            checked={form.value.reminders.firmsMayOverride}
            onChange={(firmsMayOverride) => form.patch('reminders', { firmsMayOverride })}
          />
        ) : null}
      </SettingsCard>
    </div>
  );
}

function ReminderFields({ form, rule }: { form: SettingsForm; rule: (typeof RULES)[number] }) {
  const reminders = form.value.reminders;
  const current: ReminderRule = reminders[rule.key];
  const setRule = (next: Partial<ReminderRule>) =>
    form.patch('reminders', patchRule(reminders, rule.key, next));
  const id = `settings-reminder-${rule.key}`;
  const daysError = form.errors[`reminders.${rule.key}.days`];
  return (
    <div className="flex flex-col gap-4">
      <ToggleRow
        label={`Send ${rule.title}`}
        checked={current.enabled}
        onChange={(enabled) => setRule({ enabled })}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <FormField label={rule.when} htmlFor={`${id}-days`} hint="0 to 90" error={daysError}>
          <NumberControl
            id={`${id}-days`}
            value={current.days}
            min={0}
            max={90}
            suffix="days"
            invalid={Boolean(daysError)}
            disabled={!current.enabled}
            onValue={(days) => setRule({ days })}
          />
        </FormField>
        {rule.key === 'overdue' ? <OverdueCadence form={form} /> : null}
      </div>
    </div>
  );
}

/** Replaces part of one reminder rule, keeping the rest of the section. */
function patchRule(
  reminders: Reminders,
  key: RuleKey,
  next: Partial<ReminderRule>,
): Partial<Reminders> {
  switch (key) {
    case 'overdue':
      return { overdue: { ...reminders.overdue, ...next } };
    case 'invoiceDue':
      return { invoiceDue: { ...reminders.invoiceDue, ...next } };
    case 'estimateExpiring':
      return { estimateExpiring: { ...reminders.estimateExpiring, ...next } };
    case 'failedPayment':
      return { failedPayment: { ...reminders.failedPayment, ...next } };
  }
}

function OverdueCadence({ form }: { form: SettingsForm }) {
  const overdue = form.value.reminders.overdue;
  const set = (next: Partial<Reminders['overdue']>) =>
    form.patch('reminders', { overdue: { ...overdue, ...next } });
  const repeatError = form.errors['reminders.overdue.repeatEveryDays'];
  const maxError = form.errors['reminders.overdue.maxReminders'];
  return (
    <>
      <FormField
        label="Repeat Every"
        htmlFor="settings-overdue-repeat"
        hint="1 to 30"
        error={repeatError}
      >
        <NumberControl
          id="settings-overdue-repeat"
          value={overdue.repeatEveryDays}
          min={1}
          max={30}
          suffix="days"
          invalid={Boolean(repeatError)}
          disabled={!overdue.enabled}
          onValue={(repeatEveryDays) => set({ repeatEveryDays })}
        />
      </FormField>
      <FormField label="Stop After" htmlFor="settings-overdue-max" hint="1 to 10" error={maxError}>
        <NumberControl
          id="settings-overdue-max"
          value={overdue.maxReminders}
          min={1}
          max={10}
          suffix="reminders"
          invalid={Boolean(maxError)}
          disabled={!overdue.enabled}
          onValue={(maxReminders) => set({ maxReminders })}
        />
      </FormField>
    </>
  );
}
