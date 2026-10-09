'use client';

import { ESIGN_ERRORS, type EsignSettings, UpdateEsignProfileBody } from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EsignGate } from '../../../../../../components/esign/esign-gate';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { ConsentCard } from './consent-card';
import { DefaultsForm } from './defaults-form';
import { SETTINGS } from './keys';

/** /firm-sign/settings: the firm's defaults, its consent text, and the caller's job title. */
export function SigningSettings() {
  return <EsignGate>{() => <Settings />}</EsignGate>;
}

function Settings() {
  const settings = useApiQuery(SETTINGS, () => api.esign.settings.get());
  return (
    <div className="flex flex-col gap-6">
      <h1 data-testid="page-title" className="text-3xl font-semibold text-heading">
        Signing settings
      </h1>
      <PageState query={settings}>
        {(s) => (
          <>
            <ConsentCard s={s} />
            <DefaultsForm s={s} />
            <JobTitle s={s} />
          </>
        )}
      </PageState>
    </div>
  );
}

/** Each member's own job title, which the Staff Title merge field prints. */
function JobTitle({ s }: { s: EsignSettings }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const save = useApiMutation((body: UpdateEsignProfileBody) =>
    api.esign.settings.updateMyProfile(body),
  );
  const shown = value ?? s.myJobTitle ?? '';
  return (
    <Card>
      <form
        className="flex max-w-xl flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = UpdateEsignProfileBody.safeParse({ jobTitle: shown });
          if (!parsed.success) return setError(parsed.error.issues[0]?.message);
          save.mutate(parsed.data, {
            onSuccess: (next) => {
              queryClient.setQueryData(SETTINGS, next);
              setValue(null);
            },
          });
        }}
      >
        <h2 className="font-semibold text-heading">Your job title</h2>
        <p className="text-sm text-muted">Shown where a document uses the Staff Title field.</p>
        <Input
          label="Job title"
          maxLength={100}
          value={shown}
          error={error}
          onChange={(e) => {
            setValue(e.target.value);
            setError(undefined);
            save.reset();
          }}
        />
        {save.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, ESIGN_ERRORS)}
          </p>
        )}
        {save.isSuccess && value === null && (
          <p role="status" className="text-sm text-success">
            Saved.
          </p>
        )}
        <div>
          <Button type="submit" disabled={value === null || save.isPending}>
            Save job title
          </Button>
        </div>
      </form>
    </Card>
  );
}
