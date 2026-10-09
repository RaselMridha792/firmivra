'use client';

import {
  ESIGN_ERRORS,
  type EsignRequestDetail,
  type EsignTemplateDetail,
  type EsignTemplateVisibility,
  SaveEsignTemplateBody,
} from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { TextArea } from '../../../../../setup/_components/fields';

/** Every template query starts with this (the same root as templates/_components/keys.ts, #278). */
const TEMPLATES = ['esign', 'templates'];

type Errors = { name?: string; description?: string; form?: string };

/**
 * Save as template: the request's pages, recipients (as roles), fields and settings become a new
 * template the caller owns. The client's own values are not kept; merge fields stay merge fields.
 */
export function SaveAsTemplate({ r }: { r: EsignRequestDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Save as template
      </Button>
      {/* The dialog mounts when it opens, so it starts fresh every time. */}
      {open && <SaveDialog r={r} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveDialog({ r, onClose }: { r: EsignRequestDetail; onClose: () => void }) {
  const [name, setName] = useState(r.title);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<EsignTemplateVisibility>('FIRM');
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState<EsignTemplateDetail | null>(null);
  const save = useApiMutation(
    (body: SaveEsignTemplateBody) => api.esign.saveAsTemplate(r.id, body),
    {
      invalidate: TEMPLATES,
    },
  );
  // Not while saving: the result would be lost with the dialog.
  const leave = () => {
    if (!save.isPending) onClose();
  };
  const edit = (field: keyof Errors) => {
    setErrors(({ [field]: _, form: __, ...rest }) => rest);
    save.reset();
  };

  function submit() {
    save.reset();
    const parsed = SaveEsignTemplateBody.safeParse({
      name,
      ...(description.trim() && { description }),
      visibility,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        next[field === 'name' || field === 'description' ? field : 'form'] ??= issue.message;
      }
      return setErrors(next);
    }
    save.mutate(parsed.data, { onSuccess: setSaved });
  }

  return (
    <Modal open title="Save as template" onClose={leave}>
      {saved ? (
        <div className="flex max-w-xl flex-col gap-4">
          <p role="status" className="text-sm text-text">
            {saved.name} is saved as a template.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/firm-sign/templates/${saved.id}`} className="text-link">
              Open the template
            </Link>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm text-muted">
            The pages, roles, fields and settings are kept. The client&apos;s details are not:
            whoever uses the template chooses the people again.
          </p>
          <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
            <Input
              label="Template name"
              maxLength={200}
              value={name}
              error={errors.name}
              onChange={(e) => {
                setName(e.target.value);
                edit('name');
              }}
            />
            <TextArea
              label="Description (optional)"
              maxLength={1000}
              value={description}
              error={errors.description}
              onChange={(e) => {
                setDescription(e.target.value);
                edit('description');
              }}
            />
            <Select
              label="Who can use it"
              value={visibility}
              onChange={(e) => {
                setVisibility(e.target.value as EsignTemplateVisibility);
                edit('form');
              }}
              options={[
                { value: 'FIRM', label: 'Everyone in the firm' },
                { value: 'PRIVATE', label: 'Only its owner' },
              ]}
            />
          </fieldset>
          {(errors.form || save.error) && (
            <p role="alert" className="text-sm text-danger">
              {errors.form ?? errorMessage(save.error, ESIGN_ERRORS)}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save template'}
            </Button>
            <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
