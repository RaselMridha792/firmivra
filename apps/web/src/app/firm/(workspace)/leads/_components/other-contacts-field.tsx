'use client';

import type { LeadContactPointInput } from '@firmivra/types';
import { Button, Input, Select } from '@firmivra/ui';
import { Plus, Trash2 } from 'lucide-react';

type Contact = LeadContactPointInput;
type Problems =
  { message?: string; [index: number]: { value?: { message?: string } } | undefined } | undefined;

const KINDS = [
  { value: 'PHONE', label: 'Phone' },
  { value: 'EMAIL', label: 'Email' },
];
/** At most this many, as the API allows. */
const MAX = 10;

/**
 * Leads R2 9: a lead's other phones and emails, each with an optional label ("Work", "Mobile").
 * The Email and Phone fields above stay the lead's primary ones; these are listed beside them on
 * Contact Information. Used by Add New Lead and Edit Lead; the whole list is saved together.
 */
export function OtherContactsField({
  value,
  onChange,
  errors,
}: {
  value: Contact[];
  onChange: (next: Contact[]) => void;
  errors?: Problems;
}) {
  const change = (index: number, patch: Partial<Contact>) =>
    onChange(value.map((c, i) => (i === index ? ({ ...c, ...patch } as Contact) : c)));
  return (
    <fieldset className="flex flex-col gap-2" data-testid="lead-other-contacts">
      <legend className="mb-1 text-sm font-medium text-text">Other phones and emails</legend>
      <p className="-mt-1 text-xs text-muted">
        The Email and Phone above stay the lead&apos;s primary contact details.
      </p>
      {value.map((contact, index) => (
        <div
          key={index}
          className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_9rem_auto] sm:items-end"
        >
          <Select
            label="Type"
            options={KINDS}
            value={contact.kind}
            onChange={(event) =>
              change(index, { kind: event.target.value as Contact['kind'], value: '' })
            }
          />
          <Input
            label={contact.kind === 'EMAIL' ? 'Email' : 'Phone number'}
            type={contact.kind === 'EMAIL' ? 'email' : 'tel'}
            maxLength={contact.kind === 'EMAIL' ? 254 : 40}
            value={contact.value}
            error={errors?.[index]?.value?.message}
            onChange={(event) => change(index, { value: event.target.value })}
          />
          <Input
            label="Label (optional)"
            placeholder="Work, Mobile"
            maxLength={40}
            value={contact.label ?? ''}
            onChange={(event) => change(index, { label: event.target.value })}
          />
          <Button
            variant="ghost"
            aria-label={`Remove ${contact.kind === 'EMAIL' ? 'email' : 'phone'} ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      ))}
      {errors?.message ? (
        <p role="alert" className="text-sm text-danger">
          {errors.message}
        </p>
      ) : null}
      {value.length < MAX ? (
        <div>
          <Button
            variant="outline"
            onClick={() => onChange([...value, { kind: 'PHONE', value: '', label: '' }])}
          >
            <Plus aria-hidden className="size-4" />
            Add phone or email
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
