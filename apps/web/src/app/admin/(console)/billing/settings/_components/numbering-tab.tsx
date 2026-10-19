'use client';

import { FormField } from '@firmivra/ui';
import {
  formatDocumentNumber,
  type BillingSettings,
  type NumberingRule,
} from '../../../../../../mocks/admin-billing';
import { inputClass } from '../../_components/billing-fields';
import { todayIso } from '../../_components/billing-format';
import {
  NumberControl,
  RadioGroup,
  SettingsCard,
  ToggleRow,
  type SettingsForm,
} from './settings-parts';

/**
 * Numbering (docx §15, §20): the number format and next number for invoices, estimates and
 * credit notes, when counters restart, and whether each firm has its own sequence. A number is
 * never used twice in its scope: one already taken is skipped.
 */

type Numbering = BillingSettings['numbering'];
type RuleKey = 'invoice' | 'estimate' | 'creditNote';

const RULES: { key: RuleKey; label: string }[] = [
  { key: 'invoice', label: 'Invoice' },
  { key: 'estimate', label: 'Estimate' },
  { key: 'creditNote', label: 'Credit Note' },
];

export function NumberingTab({ form }: { form: SettingsForm | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsCard
        title="Number Formats"
        description="{####} is the counter (one # per digit) and {YYYY} the document's year, e.g. INV-{####} or CN-{YYYY}-{####}."
        testId="settings-number-formats"
      >
        {form ? <Formats form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Sequence Rules"
        description="When counters restart and how numbers stay unique."
      >
        {form ? <Sequence form={form} /> : null}
      </SettingsCard>
    </div>
  );
}

function Formats({ form }: { form: SettingsForm }) {
  const numbering = form.value.numbering;
  const today = todayIso();
  const setRule = (key: RuleKey, next: Partial<NumberingRule>) =>
    form.patch('numbering', patchRule(numbering, key, next));
  return (
    <ul className="flex flex-col divide-y divide-divider">
      {RULES.map(({ key, label }) => {
        const rule = numbering[key];
        const formatError = form.errors[`numbering.${key}.format`];
        const nextError = form.errors[`numbering.${key}.next`];
        const preview =
          /\{#+\}/.test(rule.format) && Number.isInteger(rule.next) && rule.next >= 1
            ? formatDocumentNumber(rule.format, rule.next, today)
            : '—';
        return (
          <li
            key={key}
            className="grid gap-4 py-4 first:pt-0 last:pb-0 md:grid-cols-3 md:items-start"
          >
            <FormField
              label={`${label} Format`}
              htmlFor={`settings-${key}-format`}
              error={formatError}
            >
              <input
                id={`settings-${key}-format`}
                value={rule.format}
                maxLength={30}
                spellCheck={false}
                aria-invalid={Boolean(formatError) || undefined}
                onChange={(event) => setRule(key, { format: event.target.value })}
                className={inputClass(Boolean(formatError))}
              />
            </FormField>
            <FormField
              label={`Next ${label} Number`}
              htmlFor={`settings-${key}-next`}
              hint="Numbers already in use are skipped."
              error={nextError}
            >
              <NumberControl
                id={`settings-${key}-next`}
                value={rule.next}
                min={1}
                step={1}
                invalid={Boolean(nextError)}
                onValue={(next) => setRule(key, { next })}
              />
            </FormField>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium text-text">Next {label}</p>
              <p
                data-testid={`settings-${key}-preview`}
                className="flex min-h-11 items-center rounded-control bg-canvas px-3 font-semibold wrap-anywhere text-heading"
              >
                {preview}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Replaces part of one numbering rule, keeping the rest of the section. */
function patchRule(
  numbering: Numbering,
  key: RuleKey,
  next: Partial<NumberingRule>,
): Partial<Numbering> {
  switch (key) {
    case 'invoice':
      return { invoice: { ...numbering.invoice, ...next } };
    case 'estimate':
      return { estimate: { ...numbering.estimate, ...next } };
    case 'creditNote':
      return { creditNote: { ...numbering.creditNote, ...next } };
  }
}

function Sequence({ form }: { form: SettingsForm }) {
  const numbering = form.value.numbering;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <RadioGroup
        legend="Restart Counters"
        value={numbering.resetRule}
        options={[
          { value: 'NEVER', label: 'Never: numbers keep counting up' },
          { value: 'YEARLY', label: 'Every year: counters restart at 1 on January 1' },
        ]}
        onChange={(resetRule) => form.patch('numbering', { resetRule })}
      />
      <div className="flex flex-col gap-3">
        <ToggleRow
          label="Separate Numbers per Firm"
          description="On: each firm has its own sequence. Off: a number is unique across all firms."
          checked={numbering.perFirm}
          onChange={(perFirm) => form.patch('numbering', { perFirm })}
        />
        <p className="text-sm text-muted">
          Duplicate numbers are always refused within the scope, and a voided document keeps its
          number.
        </p>
      </div>
    </div>
  );
}
