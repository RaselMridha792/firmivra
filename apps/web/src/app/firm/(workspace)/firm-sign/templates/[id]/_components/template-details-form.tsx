'use client';

import {
  ESIGN_ERRORS,
  type EsignTemplateDetail,
  type EsignTemplateVisibility,
  UpdateEsignTemplateBody,
} from '@firmivra/types';
import { Button, Card, Input, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { VISIBILITY_LABELS } from '../../../../../../../components/esign/field-labels';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { TextArea } from '../../../../../setup/_components/fields';
import { TEMPLATES, templateKey } from '../../_components/keys';

/** Rename the template, change its description or who may use it. Only what changed is sent. */
export function TemplateDetailsForm({
  t,
  onClose,
}: {
  t: EsignTemplateDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description ?? '');
  const [visibility, setVisibility] = useState<EsignTemplateVisibility>(t.visibility);
  const [errors, setErrors] = useState<{ name?: string; description?: string; form?: string }>({});
  const save = useApiMutation(
    (body: UpdateEsignTemplateBody) => api.esign.templates.update(t.id, body),
    { invalidate: TEMPLATES },
  );
  const dirty =
    name !== t.name || description !== (t.description ?? '') || visibility !== t.visibility;

  function submit() {
    save.reset();
    const parsed = UpdateEsignTemplateBody.safeParse({
      ...(name !== t.name && { name }),
      ...(description !== (t.description ?? '') && { description }),
      ...(visibility !== t.visibility && { visibility }),
    });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key =
          issue.path[0] === 'name' || issue.path[0] === 'description' ? issue.path[0] : 'form';
        next[key] ??= issue.message;
      }
      return setErrors(next);
    }
    save.mutate(parsed.data, {
      onSuccess: (next) => {
        queryClient.setQueryData(templateKey(t.id), next);
        onClose();
      },
    });
  }

  return (
    <Card>
      <form
        noValidate
        className="flex max-w-xl flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="font-semibold text-heading">Template details</h2>
        <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
          <Input
            label="Name"
            maxLength={200}
            value={name}
            error={errors.name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors({});
              save.reset();
            }}
          />
          <TextArea
            label="Description (optional)"
            maxLength={1000}
            value={description}
            error={errors.description}
            onChange={(e) => {
              setDescription(e.target.value);
              setErrors({});
              save.reset();
            }}
          />
          <Select
            label="Who can use it"
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as EsignTemplateVisibility);
              save.reset();
            }}
            options={(['FIRM', 'PRIVATE'] as const).map((v) => ({
              value: v,
              label: VISIBILITY_LABELS[v],
            }))}
          />
        </fieldset>
        {(errors.form || save.error) && (
          <p role="alert" className="text-sm text-danger">
            {errors.form ?? errorMessage(save.error, ESIGN_ERRORS)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save details'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
