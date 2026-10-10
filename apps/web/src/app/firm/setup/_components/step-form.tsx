'use client';

import { type FirmSettings, type SetupStep, UpdateFirmSettingsRequest } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ReactNode, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { api } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation } from '../../../../lib/query';
import { FIRM_SETTINGS, SETUP_ERRORS } from './shared';

const checkSettings = zodResolver(UpdateFirmSettingsRequest);

/**
 * The API's schema, for every settings form. Its website rule throws on text that is not an
 * address at all (its refine calls `new URL()` after the URL check fails), which would leave the
 * form stuck: show that as a website error instead, until packages/types handles it.
 */
export const settingsResolver: typeof checkSettings = async (...args) => {
  try {
    return await checkSettings(...args);
  } catch {
    const message = 'Enter a web address that starts with https://';
    return { values: {}, errors: { website: { type: 'url', message } } };
  }
};

/** Blank and missing count as the same (a cleared number is null, an empty list is no list). */
const sameValue = (a: unknown, b: unknown) => {
  const blank = (v: unknown) =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  return JSON.stringify(a) === JSON.stringify(b);
};

/**
 * The Settings pages check only what the person changed: a firm whose team size or services are
 * still blank (set up before those were asked) can save a new phone number without filling them.
 * A changed field still gets every rule, so a required one can't be cleared.
 */
export const changedFieldsResolver =
  (defaults: UpdateFirmSettingsRequest): typeof settingsResolver =>
  async (values, context, options) => {
    const changed = Object.fromEntries(
      Object.entries(values).filter(
        ([field, value]) => !sameValue(value, defaults[field as keyof UpdateFirmSettingsRequest]),
      ),
    );
    // Nothing changed: nothing to check (the schema itself asks for at least one setting).
    if (!Object.keys(changed).length) return { values, errors: {} };
    const result = await settingsResolver(changed, context, options);
    // The changed fields come back parsed (trimmed, deduplicated); the rest as they were.
    return Object.keys(result.errors).length
      ? result
      : { values: { ...values, ...result.values }, errors: {} };
  };

/**
 * Only the fields the person changed. An unchanged field is never sent, so it can't undo someone
 * else's change made while this form was open.
 */
export const changedOnly = (
  values: UpdateFirmSettingsRequest,
  dirty: Partial<Record<string, unknown>>,
): UpdateFirmSettingsRequest =>
  Object.fromEntries(Object.entries(values).filter(([field]) => Boolean(dirty[field])));

/** A settings step: Save draft saves the fields; Continue also marks the step done. */
export function useStepForm(
  step: SetupStep,
  defaultValues: UpdateFirmSettingsRequest,
  onNext: () => void,
) {
  const form = useForm({ resolver: settingsResolver, defaultValues });
  // Read during render: react-hook-form only tracks dirtyFields once something reads it.
  const { dirtyFields } = form.formState;
  const [draftSaved, setDraftSaved] = useState(false);
  const save = useApiMutation(
    async ({ values, done }: { values: UpdateFirmSettingsRequest; done: boolean }) => {
      if (Object.keys(values).length) await api.settings.update(values);
      if (done) await api.settings.completeStep(step);
    },
    { invalidate: FIRM_SETTINGS },
  );
  const submit = (done: boolean) =>
    form.handleSubmit((values) => {
      setDraftSaved(false);
      const changes = changedOnly(values, dirtyFields);
      save.mutate(
        { values: changes, done },
        {
          onSuccess: () => {
            // Saved values are the new starting point; the write-only EIN is cleared.
            form.reset({ ...form.getValues(), ein: undefined });
            if (done) onNext();
            else setDraftSaved(true);
          },
        },
      );
    });
  return { form, save, draftSaved, submit };
}

export type StepForm = ReturnType<typeof useStepForm>['form'];

/** The step's card: title, fields, and Back, Save draft and Continue. */
export function StepFrame({
  title,
  icon,
  stepForm,
  onBack,
  children,
}: {
  title: string;
  icon: LucideIcon;
  stepForm: ReturnType<typeof useStepForm>;
  onBack?: () => void;
  children: ReactNode;
}) {
  const { save, draftSaved, submit } = stepForm;
  return (
    <form onSubmit={submit(true)} noValidate>
      <Card title={<StepTitle icon={icon}>{title}</StepTitle>} className="flex flex-col gap-4">
        {children}
        <StepActions onBack={onBack} onSaveDraft={submit(false)} pending={save.isPending} />
        {draftSaved ? (
          <p role="status" className="text-sm text-success">
            Draft saved.
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, SETUP_ERRORS)}
          </p>
        ) : null}
      </Card>
    </form>
  );
}

export function StepActions({
  onBack,
  onSaveDraft,
  pending,
}: {
  onBack?: () => void;
  onSaveDraft: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
      <Button variant="secondary" onClick={onBack} disabled={pending || !onBack}>
        Back
      </Button>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onSaveDraft} disabled={pending}>
          Save draft
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}

/** A step's heading with its icon, in the Super Admin cards' style (docs/mockups/super-admin). */
export function StepTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 font-display text-xl font-bold text-heading">
      <Icon aria-hidden className="size-5 text-link" />
      {children}
    </span>
  );
}

/** The legal name Firmivra approved: shown, never edited by the firm. */
export function LockedName({ firm }: { firm: FirmSettings }) {
  return (
    <p className="text-sm text-muted">
      Legal name: <span className="font-medium text-text">{firm.business.legalName ?? '—'}</span>{' '}
      (locked after approval)
    </p>
  );
}
