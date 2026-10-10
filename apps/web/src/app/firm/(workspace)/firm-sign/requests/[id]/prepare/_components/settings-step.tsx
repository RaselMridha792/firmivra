'use client';

import { ESIGN_ERRORS, type EsignRequestDetail, UpdateEsignRequestBody } from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../../lib/query';
import { TextArea } from '../../../../../../setup/_components/fields';
import { NextStepLink } from './next-step-link';
import { requestKey } from './steps';

const NUMBERS = ['expiryDays', 'firstAfterDays', 'everyDays', 'max', 'expiryWarningDays'] as const;
type NumberKey = (typeof NUMBERS)[number];
type Form = Record<NumberKey | 'emailSubject' | 'emailMessage' | 'internalNote', string>;

function toForm(r: EsignRequestDetail): Form {
  return {
    emailSubject: r.emailSubject ?? '',
    emailMessage: r.emailMessage ?? '',
    internalNote: r.internalNote ?? '',
    expiryDays: String(r.expiryDays),
    firstAfterDays: String(r.reminders.firstAfterDays),
    everyDays: String(r.reminders.everyDays),
    max: String(r.reminders.max),
    expiryWarningDays: String(r.expiryWarningDays),
  };
}

type Errors = Partial<Record<keyof Form | 'form', string>>;

/** The PATCH body with only what changed from `saved`, or each box's problem. */
function toBody(
  f: Form,
  saved: Form,
): { ok: true; body: UpdateEsignRequestBody } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  for (const k of NUMBERS) if (!/^\d+$/.test(f[k].trim())) errors[k] = 'Enter a whole number';
  if (Object.keys(errors).length) return { ok: false, errors };
  const n = (k: NumberKey) => Number(f[k]);
  // As the send check (remindersRunPastExpiry): the last reminder before the expiry.
  if (n('max') > 0 && n('firstAfterDays') + (n('max') - 1) * n('everyDays') >= n('expiryDays')) {
    errors.firstAfterDays = 'The last reminder would come on or after the expiry';
  }
  if (n('expiryWarningDays') >= n('expiryDays')) {
    errors.expiryWarningDays = 'Make it fewer days than the expiry';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const changed = (...keys: (keyof Form)[]) => keys.some((k) => f[k] !== saved[k]);
  const parsed = UpdateEsignRequestBody.safeParse({
    ...(changed('emailSubject') && { emailSubject: f.emailSubject }),
    ...(changed('emailMessage') && { emailMessage: f.emailMessage }),
    ...(changed('internalNote') && { internalNote: f.internalNote }),
    ...(changed('expiryDays') && { expiryDays: n('expiryDays') }),
    ...(changed('firstAfterDays', 'everyDays', 'max') && {
      reminders: { firstAfterDays: n('firstAfterDays'), everyDays: n('everyDays'), max: n('max') },
    }),
    ...(changed('expiryWarningDays') && { expiryWarningDays: n('expiryWarningDays') }),
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  for (const issue of parsed.error.issues) {
    // `reminders.everyDays` is the "everyDays" box; a problem with no box shows under the form.
    const key = String(issue.path[0] === 'reminders' ? issue.path[1] : issue.path[0]);
    errors[key in f ? (key as keyof Form) : 'form'] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Step 4: the email, when it expires, reminders and the team's own note. */
export function SettingsStep({ r }: { r: EsignRequestDetail }) {
  const queryClient = useQueryClient();
  // Only the boxes the user changed; the rest follow the request as it is now.
  const [edits, setEdits] = useState<Partial<Form>>({});
  const [errors, setErrors] = useState<Errors>({});
  const save = useApiMutation((body: UpdateEsignRequestBody) => api.esign.update(r.id, body), {
    invalidate: requestKey(r.id),
  });
  const saved = toForm(r);
  const form = { ...saved, ...edits };
  const dirty = (Object.keys(edits) as (keyof Form)[]).some((k) => form[k] !== saved[k]);

  const box = (key: keyof Form) => ({
    value: form[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => {
      setEdits((x) => ({ ...x, [key]: e.target.value }));
      setErrors((x) => ({ ...x, [key]: undefined, form: undefined }));
      save.reset();
    },
  });
  const days = (key: NumberKey, label: string) => (
    <Input label={label} inputMode="numeric" maxLength={3} {...box(key)} />
  );

  function submit() {
    const result = toBody(form, saved);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    save.mutate(result.body, {
      onSuccess: (detail) => {
        queryClient.setQueryData(requestKey(r.id), detail);
        setEdits({});
      },
    });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* Edits wait for a save in flight: its answer replaces the form. */}
      <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <h2 className="font-display text-2xl text-heading">Settings</h2>
          <h3 className="font-semibold text-heading">Email to the signers</h3>
          <p className="text-sm text-muted">Leave these empty to use your firm&apos;s defaults.</p>
          <Input label="Subject" maxLength={200} {...box('emailSubject')} />
          <TextArea label="Message" maxLength={1000} {...box('emailMessage')} />
        </Card>
        <Card className="flex flex-col gap-4">
          <h3 className="font-semibold text-heading">Expiry and reminders</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {days('expiryDays', 'Expires after (days)')}
            {days('expiryWarningDays', 'Warn this many days before it expires (0 for none)')}
            {days('firstAfterDays', 'First reminder after (days)')}
            {days('everyDays', 'Then remind every (days)')}
            {days('max', 'Most reminders (0 turns them off)')}
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <h3 className="font-semibold text-heading">Internal note</h3>
          <TextArea
            label="Only your team sees this note"
            maxLength={2000}
            {...box('internalNote')}
          />
        </Card>
      </fieldset>
      {(save.error || errors.form) && (
        <p role="alert" className="text-sm text-danger">
          {errors.form ?? errorMessage(save.error, ESIGN_ERRORS)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </Button>
        {dirty ? (
          <p className="text-sm text-muted">Save your changes to continue.</p>
        ) : (
          <NextStepLink id={r.id} step="review" label="Next: Review and send" />
        )}
      </div>
    </form>
  );
}
