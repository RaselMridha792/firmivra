'use client';

import { type FirmSettings, type SetupStep, UpdateFirmSettingsRequest } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation } from '../../../../lib/query';
import { FIRM_SETTINGS, SETUP_ERRORS } from './shared';

/** A settings step: Save draft saves the fields; Continue also marks the step done. */
export function useStepForm(
  step: SetupStep,
  defaultValues: UpdateFirmSettingsRequest,
  onNext: () => void,
) {
  const form = useForm({ resolver: zodResolver(UpdateFirmSettingsRequest), defaultValues });
  const [draftSaved, setDraftSaved] = useState(false);
  const save = useApiMutation(
    async ({ values, done }: { values: UpdateFirmSettingsRequest; done: boolean }) => {
      await api.settings.update(values);
      if (done) await api.settings.completeStep(step);
    },
    { invalidate: FIRM_SETTINGS },
  );
  const submit = (done: boolean) =>
    form.handleSubmit((values) => {
      setDraftSaved(false);
      save.mutate({ values, done }, { onSuccess: () => (done ? onNext() : setDraftSaved(true)) });
    });
  return { form, save, draftSaved, submit };
}

export type StepForm = ReturnType<typeof useStepForm>['form'];

/** The step's card: title, fields, and Back, Save draft and Continue. */
export function StepFrame({
  title,
  stepForm,
  onBack,
  children,
}: {
  title: string;
  stepForm: ReturnType<typeof useStepForm>;
  onBack?: () => void;
  children: ReactNode;
}) {
  const { save, draftSaved, submit } = stepForm;
  return (
    <form onSubmit={submit(true)} noValidate>
      <Card title={title} className="flex flex-col gap-4">
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

/** The legal name Firmivra approved: shown, never edited by the firm. */
export function LockedName({ firm }: { firm: FirmSettings }) {
  return (
    <p className="text-sm text-muted">
      Legal name: <span className="font-medium text-text">{firm.business.legalName ?? '—'}</span>{' '}
      (locked after approval)
    </p>
  );
}
