'use client';

import {
  ESIGN_ERRORS,
  type EsignDefaults,
  type EsignSettings,
  UpdateEsignSettingsBody,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Select, Toast } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { TextArea } from '../../../../setup/_components/fields';
import { SETTINGS } from './keys';

/** Each number box and its allowed range, as the contract schemas. */
const RANGES = {
  expiryDays: [1, 365],
  expiryWarningDays: [0, 30],
  firstAfterDays: [1, 60],
  everyDays: [1, 60],
  max: [0, 10],
} as const;
type NumberKey = keyof typeof RANGES;
const NUMBERS = Object.keys(RANGES) as NumberKey[];
const REMINDERS: readonly NumberKey[] = ['firstAfterDays', 'everyDays'];
type Form = Record<NumberKey | 'emailMessage', string> &
  Pick<EsignDefaults, 'authMethod' | 'requireApproval'>;
type Errors = Partial<Record<keyof Form | 'form', string>>;

function toForm(d: EsignDefaults): Form {
  return {
    expiryDays: String(d.expiryDays),
    expiryWarningDays: String(d.expiryWarningDays),
    firstAfterDays: String(d.reminders.firstAfterDays),
    everyDays: String(d.reminders.everyDays),
    max: String(d.reminders.max),
    emailMessage: d.emailMessage ?? '',
    authMethod: d.authMethod,
    requireApproval: d.requireApproval,
  };
}

/** The PUT body with only what changed, or each box's problem. */
function toBody(
  f: Form,
  saved: Form,
): { ok: true; body: UpdateEsignSettingsBody } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const n = (k: NumberKey) => Number(f[k].trim());
  const remindersOff = /^\d+$/.test(f.max.trim()) && n('max') === 0;
  for (const k of NUMBERS) {
    // With reminders off their timing is kept as saved, so a box left as it was never blocks.
    if (remindersOff && REMINDERS.includes(k) && f[k] === saved[k]) continue;
    const [min, max] = RANGES[k];
    if (!/^\d+$/.test(f[k].trim())) errors[k] = 'Enter a whole number';
    else if (n(k) < min || n(k) > max) errors[k] = `Enter ${min} to ${max}`;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  // As the send check (remindersRunPastExpiry): the last reminder before the expiry.
  if (n('max') > 0 && n('firstAfterDays') + (n('max') - 1) * n('everyDays') >= n('expiryDays')) {
    errors.firstAfterDays = 'The last reminder would come on or after the expiry';
  }
  if (n('expiryWarningDays') >= n('expiryDays')) {
    errors.expiryWarningDays = 'Make it fewer days than the expiry';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const changed = (...keys: (keyof Form)[]) => keys.some((k) => f[k] !== saved[k]);
  const parsed = UpdateEsignSettingsBody.safeParse({
    ...(changed('expiryDays') && { expiryDays: n('expiryDays') }),
    ...(changed('expiryWarningDays') && { expiryWarningDays: n('expiryWarningDays') }),
    ...(changed('firstAfterDays', 'everyDays', 'max') && {
      reminders: { firstAfterDays: n('firstAfterDays'), everyDays: n('everyDays'), max: n('max') },
    }),
    ...(changed('authMethod') && { authMethod: f.authMethod }),
    ...(changed('requireApproval') && { requireApproval: f.requireApproval }),
    ...(changed('emailMessage') && { emailMessage: f.emailMessage }),
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] === 'reminders' ? issue.path[1] : issue.path[0]);
    errors[key in f ? (key as keyof Form) : 'form'] ??= issue.message;
  }
  return { ok: false, errors };
}

/** What every new request starts with. Owners and Admins change it; everyone else reads it. */
export function DefaultsForm({ s }: { s: EsignSettings }) {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Partial<Form>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState(false);
  const save = useApiMutation((body: UpdateEsignSettingsBody) => api.esign.settings.update(body));
  const current = toForm(s.defaults);
  const form = { ...current, ...edits };
  const dirty = (Object.keys(edits) as (keyof Form)[]).some((k) => form[k] !== current[k]);
  const set = (patch: Partial<Form>) => {
    setEdits((x) => ({ ...x, ...patch }));
    setErrors({});
    setSaved(false);
    save.reset();
  };
  const days = (key: NumberKey, label: string) => (
    <Input
      label={label}
      inputMode="numeric"
      maxLength={3}
      value={form[key]}
      error={errors[key]}
      onChange={(e) => set({ [key]: e.target.value })}
    />
  );

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const result = toBody(form, current);
          if (!result.ok) return setErrors(result.errors);
          save.mutate(result.body, {
            onSuccess: (next) => {
              queryClient.setQueryData(SETTINGS, next);
              setEdits({});
              setSaved(true);
            },
          });
        }}
      >
        <h2 className="font-semibold text-heading">Defaults for new requests</h2>
        {!s.canEdit && (
          <p className="text-sm text-muted">Only an Owner or Admin can change these.</p>
        )}
        <fieldset disabled={!s.canEdit || save.isPending} className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            {days('expiryDays', 'Expires after (days)')}
            {days('expiryWarningDays', 'Warn this many days before it expires (0 for none)')}
            {days('firstAfterDays', 'First reminder after (days)')}
            {days('everyDays', 'Then remind every (days)')}
            {days('max', 'Most reminders (0 turns them off)')}
            <Select
              label="Identity check"
              value={form.authMethod}
              onChange={(e) => set({ authMethod: e.target.value as Form['authMethod'] })}
              options={[
                { value: 'EMAIL_CODE', label: 'A code sent by email' },
                { value: 'ACCESS_CODE', label: 'An access code the sender gives' },
                { value: 'LINK', label: 'Their link only' },
              ]}
            />
          </div>
          <Checkbox
            label="An approver must approve each request before it is sent"
            checked={form.requireApproval}
            onChange={(e) => set({ requireApproval: e.target.checked })}
          />
          <TextArea
            label="Email message new requests start with (optional)"
            maxLength={1000}
            value={form.emailMessage}
            error={errors.emailMessage}
            onChange={(e) => set({ emailMessage: e.target.value })}
          />
        </fieldset>
        {(errors.form || save.error) && (
          <p role="alert" className="text-sm text-danger">
            {errors.form ?? errorMessage(save.error, ESIGN_ERRORS)}
          </p>
        )}
        {s.canEdit && (
          <div>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save defaults'}
            </Button>
          </div>
        )}
        {saved && <Toast message="Defaults saved." onDismiss={() => setSaved(false)} />}
      </form>
    </Card>
  );
}
