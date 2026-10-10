'use client';

import {
  ApiRequestError,
  DOCUMENT_ERRORS,
  EsignContentType,
  ESIGN_ERRORS,
  type SignerField,
  type SigningClient,
} from '@firmivra/types';
import { Button, Checkbox, Input, Radio, Select } from '@firmivra/ui';
import { useState } from 'react';
import { FIELD_TYPE_LABELS } from '../../../../../../components/esign/field-labels';
import { errorMessage } from '../../../../../../lib/errors';
import { uploadFile } from '../../../../../../lib/upload';
import { type Filled, groupOf } from './signer-fields';

const INPUT_TYPE: Partial<Record<SignerField['type'], string>> = { EMAIL: 'email', PHONE: 'tel' };
const AUTOCOMPLETE: Partial<Record<SignerField['type'], string>> = {
  PRINTED_NAME: 'name',
  EMAIL: 'email',
  PHONE: 'tel',
  ADDRESS: 'street-address',
};

interface FieldPanelProps {
  field: SignerField;
  fields: readonly SignerField[];
  filled: Filled;
  signing: SigningClient;
  onValue: (fieldId: string, value: string) => void;
  onRadio: (fieldId: string) => void;
  onAttachment: (fieldId: string, fileName: string) => void;
  onAdopt: () => void;
}

/** The current field's input, under the document: the signer fills their fields one by one. */
export function FieldPanel(props: FieldPanelProps) {
  const { field: f, filled } = props;
  const title = f.label || FIELD_TYPE_LABELS[f.type];
  const label = `${title}${f.required ? '' : ' (optional)'}`;
  switch (f.type) {
    case 'SIGNATURE':
    case 'INITIALS': {
      const done = f.type === 'SIGNATURE' ? !!filled.adopted : !!filled.adopted?.hasInitials;
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text">
            {done
              ? `Your ${f.type === 'SIGNATURE' ? 'signature' : 'initials'} will go here.`
              : `Adopt your signature to sign here.`}
          </p>
          <Button variant="secondary" onClick={props.onAdopt}>
            {done ? 'Change signature' : 'Adopt signature'}
          </Button>
        </div>
      );
    }
    case 'DATE_SIGNED':
      return <p className="text-sm text-text">Today&apos;s date goes here when you finish.</p>;
    case 'CHECKBOX':
      return (
        <Checkbox
          label={title}
          checked={filled.values[f.id] === 'true'}
          onChange={(e) => props.onValue(f.id, e.target.checked ? 'true' : 'false')}
        />
      );
    case 'RADIO': {
      const group = props.fields.filter((o) => o.type === 'RADIO' && groupOf(o) === groupOf(f));
      return (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-text">Choose one</legend>
          {group.map((o, i) => (
            <Radio
              key={o.id}
              name={`radio-${f.groupKey ?? f.id}`}
              label={o.label || `Option ${i + 1}`}
              checked={filled.values[o.id] === 'true'}
              onChange={() => props.onRadio(o.id)}
            />
          ))}
        </fieldset>
      );
    }
    case 'DROPDOWN':
      return (
        <Select
          label={label}
          value={filled.values[f.id] ?? ''}
          onChange={(e) => props.onValue(f.id, e.target.value)}
          options={[
            { value: '', label: 'Choose…' },
            ...f.options.map((o) => ({ value: o, label: o })),
          ]}
        />
      );
    case 'ATTACHMENT':
      // Its own upload state per field.
      return <AttachmentInput key={f.id} {...props} label={label} />;
    default:
      return (
        <Input
          // A new field starts a fresh input, with the focus in it.
          key={f.id}
          autoFocus
          label={label}
          type={INPUT_TYPE[f.type] ?? 'text'}
          autoComplete={AUTOCOMPLETE[f.type] ?? 'off'}
          maxLength={1000}
          value={filled.values[f.id] ?? ''}
          onChange={(e) => props.onValue(f.id, e.target.value)}
        />
      );
  }
}

/** An ATTACHMENT field: PDF, JPG or PNG up to 10 MB, uploaded straight to storage. */
function AttachmentInput({
  field: f,
  filled,
  signing,
  onAttachment,
  label,
}: FieldPanelProps & { label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const uploaded = filled.attachments[f.id];

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await uploadFile(file, {
        start: (facts) => {
          // Attachments take PDF, JPG and PNG only (uploadFile also knows Excel and Word).
          const type = EsignContentType.safeParse(facts.contentType);
          if (!type.success) {
            throw new ApiRequestError(400, 'FILE_TYPE_NOT_ALLOWED', 'Not PDF, JPG or PNG');
          }
          return signing.createAttachmentUpload({
            fieldId: f.id,
            ...facts,
            contentType: type.data,
          });
        },
        finish: (uploadToken) => signing.confirmAttachment({ fieldId: f.id, uploadToken }),
      });
      onAttachment(f.id, saved.attachmentName ?? file.name);
    } catch (e) {
      setError(errorMessage(e, { ...DOCUMENT_ERRORS, ...ESIGN_ERRORS }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="file"
        label={`${label}: PDF, JPG or PNG, up to 10 MB`}
        accept="application/pdf,image/jpeg,image/png"
        disabled={busy}
        error={error}
        data-testid="attachment-upload"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {busy && (
        <p className="text-sm text-muted" role="status">
          Uploading…
        </p>
      )}
      {uploaded && !busy && <p className="text-sm text-text">Uploaded: {uploaded}</p>}
    </div>
  );
}
