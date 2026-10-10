'use client';

import {
  DuplicateEsignTemplateBody,
  ESIGN_ERRORS,
  type EsignTemplateDetail,
  type EsignTemplateVisibility,
} from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { VISIBILITY_LABELS } from '../../../../../../../components/esign/field-labels';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { TEMPLATES, templateKey } from '../../_components/keys';

/** A copy the caller owns, from the current version, starting again at version 1. */
export function DuplicateTemplate({ t }: { t: EsignTemplateDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Duplicate
      </Button>
      {open && <DuplicateDialog t={t} onClose={() => setOpen(false)} />}
    </>
  );
}

function DuplicateDialog({ t, onClose }: { t: EsignTemplateDetail; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Cut by characters, not UTF-16 units, so an emoji at the end isn't split in half.
  const [name, setName] = useState(() => Array.from(`Copy of ${t.name}`).slice(0, 200).join(''));
  const [leaving, setLeaving] = useState(false);
  const [visibility, setVisibility] = useState<EsignTemplateVisibility>(t.visibility);
  const [error, setError] = useState<string>();
  const duplicate = useApiMutation((body: DuplicateEsignTemplateBody) =>
    api.esign.templates.duplicate(t.id, body),
  );
  const busy = duplicate.isPending || leaving;
  const leave = (event?: { preventDefault?: () => void }) => {
    // Modal passes Escape's cancel event: stopping it keeps the dialog open while duplicating.
    if (busy) event?.preventDefault?.();
    else onClose();
  };
  function submit() {
    const parsed = DuplicateEsignTemplateBody.safeParse({ name, visibility });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    duplicate.mutate(parsed.data, {
      onSuccess: (copy) => {
        // Stays disabled until the copy's page opens, so it can't be sent twice.
        setLeaving(true);
        queryClient.setQueryData(templateKey(copy.id), copy);
        void queryClient.invalidateQueries({ queryKey: [...TEMPLATES, 'list'] });
        router.push(`/firm-sign/templates/${copy.id}`);
      },
    });
  }
  return (
    <Modal open title={`Duplicate ${t.name}`} onClose={leave}>
      <form
        noValidate
        className="flex max-w-xl flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
          <Input
            label="Name of the copy"
            maxLength={200}
            value={name}
            error={error}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
              duplicate.reset();
            }}
          />
          <Select
            label="Who can use it"
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value as EsignTemplateVisibility);
              duplicate.reset();
            }}
            options={(['FIRM', 'PRIVATE'] as const).map((v) => ({
              value: v,
              label: VISIBILITY_LABELS[v],
            }))}
          />
        </fieldset>
        {duplicate.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(duplicate.error, ESIGN_ERRORS)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? 'Duplicating…' : 'Duplicate'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
