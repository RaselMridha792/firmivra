'use client';

import { type FirmSettings, UpdateFirmSettingsRequest } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../components/page-state';
import { api } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../lib/query';
import { FIRM_SETTINGS, SETUP_ERRORS } from './shared';
import { settingsResolver, type StepForm } from './step-form';

/** A Settings page (Profile, Branding, Client portal): the setup wizard's fields, saved at once. */
export function SettingsScreen({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: (firm: FirmSettings) => ReactNode;
}) {
  const settings = useApiQuery(FIRM_SETTINGS, () => api.settings.get());
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          {title}
        </h1>
        <p className="text-sm text-muted">{intro}</p>
      </div>
      <PageState query={settings}>{children}</PageState>
    </div>
  );
}

export function SettingsForm({
  defaults,
  children,
}: {
  defaults: UpdateFirmSettingsRequest;
  children: (form: StepForm) => ReactNode;
}) {
  const form = useForm({
    resolver: settingsResolver,
    defaultValues: defaults,
  });
  const [saved, setSaved] = useState(false);
  const save = useApiMutation((values: UpdateFirmSettingsRequest) => api.settings.update(values), {
    invalidate: FIRM_SETTINGS,
  });
  const submit = form.handleSubmit((values) => {
    setSaved(false);
    save.mutate(values, {
      onSuccess: () => {
        setSaved(true);
        // The EIN is write-only: clear it once saved (only its last 4 come back).
        form.resetField('ein');
      },
    });
  });

  return (
    <form onSubmit={submit} noValidate>
      <Card className="flex flex-col gap-4">
        {children(form)}
        <div className="border-t border-border pt-4">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
        {saved ? (
          <p role="status" className="text-sm text-success">
            Changes saved.
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
