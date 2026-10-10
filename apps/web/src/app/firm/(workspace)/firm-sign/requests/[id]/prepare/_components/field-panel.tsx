'use client';

import {
  ESIGN_MERGE_LABELS,
  type EsignFieldType,
  type EsignMergeKey,
  type EsignRecipient,
} from '@firmivra/types';
import { Badge, Button, Checkbox, Input, Select } from '@firmivra/ui';
import { FIELD_TYPE_LABELS } from '../../../../../../../../components/esign/field-labels';
import type { FieldDraft } from './field-draft';

/** "Filled in by" for the sender: the field is filled before the request is sent. */
export const SENDER = 'sender';

/** The fields the sender can fill before sending: ones that hold text. */
const SENDER_TYPES: readonly EsignFieldType[] = [
  'PRINTED_NAME',
  'TEXT',
  'EMAIL',
  'PHONE',
  'ADDRESS',
];
export const senderCanFill = (type: EsignFieldType) => SENDER_TYPES.includes(type);

/** What a sender field shows on the page: its value, or the merge field (flagged when missing). */
export function senderText(f: FieldDraft, values: Partial<Record<EsignMergeKey, string | null>>) {
  let text = f.value || 'Enter a value';
  if (f.mergeKey) {
    const value = values[f.mergeKey];
    text =
      value === null
        ? `${ESIGN_MERGE_LABELS[f.mergeKey]}: missing`
        : (value ?? ESIGN_MERGE_LABELS[f.mergeKey]);
  }
  return f.label ? `${f.label}: ${text}` : text;
}

/** The selected field's settings: who fills it, its label, a sender field's value, and actions. */
export function FieldPanel({
  f,
  signers,
  values,
  mergeFailed,
  onChange,
  onDuplicate,
  onRemove,
}: {
  f: FieldDraft;
  signers: EsignRecipient[];
  /** Each merge field's value for this request; null when the record has none. */
  values: Partial<Record<EsignMergeKey, string | null>>;
  /** The merge values could not be loaded. */
  mergeFailed: boolean;
  onChange: (patch: Partial<FieldDraft>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const sender = f.recipientId === null;
  const missing = f.mergeKey !== null && values[f.mergeKey] === null;
  return (
    <div data-testid="field-panel" className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="font-semibold text-heading">{FIELD_TYPE_LABELS[f.type]}</h3>
      <Select
        label="Filled in by"
        value={f.recipientId ?? SENDER}
        onChange={(e) =>
          onChange(
            e.target.value === SENDER
              ? // The sender fills it before sending: nothing is left for a signer to complete.
                { recipientId: null, required: false }
              : // A signer types their own answer: the sender's value goes.
                { recipientId: e.target.value, mergeKey: null, value: '' },
          )
        }
        options={[
          ...signers.map((s) => ({ value: s.id, label: s.name })),
          ...(senderCanFill(f.type) ? [{ value: SENDER, label: 'You, before sending' }] : []),
        ]}
      />
      <Input
        label="Label (optional)"
        maxLength={200}
        value={f.label}
        onChange={(e) => onChange({ label: e.target.value })}
      />
      {sender && (
        <>
          <Select
            label="Fill with"
            value={f.mergeKey ?? ''}
            onChange={(e) =>
              onChange({ mergeKey: (e.target.value || null) as EsignMergeKey | null, value: '' })
            }
            options={[
              { value: '', label: 'A value you type' },
              ...Object.entries(ESIGN_MERGE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          {f.mergeKey ? (
            <span data-testid="merge-chip">
              <Badge tone={missing || mergeFailed ? 'danger' : 'neutral'}>
                {mergeFailed
                  ? 'The merge values could not be loaded.'
                  : missing
                    ? `No ${ESIGN_MERGE_LABELS[f.mergeKey].toLowerCase()} on file. Add it to the record, or choose "A value you type".`
                    : `Will show: ${values[f.mergeKey] ?? '…'}`}
              </Badge>
            </span>
          ) : (
            <Input
              label="Value"
              maxLength={500}
              value={f.value}
              onChange={(e) => onChange({ value: e.target.value })}
            />
          )}
        </>
      )}
      {!sender && (
        <Checkbox
          label="Required"
          checked={f.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onDuplicate}>
          Duplicate
        </Button>
        <Button variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}
