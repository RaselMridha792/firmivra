'use client';

import {
  type IntakeOption,
  type IntakeScalarField,
  type MaskedNumber,
  US_STATES,
} from '@firmivra/types';
import { Button, Checkbox, Input, Radio, Select } from '@firmivra/ui';
import { CircleCheck, Info } from 'lucide-react';
import { useId } from 'react';
import { compactInput, MaskedInput } from './form-blocks';
import { isMasked, type ScreenScalar } from './intake-values';

// One input per scalar field type of an intake definition (packages/types/src/intake/definition.ts).
// Labels carry " *" when required; every error sits under its input (aria-describedby).

export type Fill = (text: string) => string;

const STATE_OPTIONS = Object.entries(US_STATES).map(([value, label]) => ({ value, label }));

export const labelOf = (f: { label: string; required: boolean }, fill: Fill) =>
  `${fill(f.label)}${f.required ? ' *' : ''}`;

function ErrorText({ id, error }: { id: string; error?: string | undefined }) {
  return error ? (
    <p id={id} className="text-xs text-danger">
      {error}
    </p>
  ) : null;
}

function Help({ text }: { text?: string | undefined }) {
  return text ? <p className="text-xs text-muted">{text}</p> : null;
}

function OptionList({
  name,
  label,
  options,
  multiple,
  value,
  onChange,
  error,
  cards,
  selectAll,
  inline,
}: {
  name: string;
  label: string;
  options: readonly IntakeOption[];
  multiple: boolean;
  value: ScreenScalar;
  onChange: (value: ScreenScalar) => void;
  error?: string | undefined;
  cards?: boolean;
  selectAll?: string | undefined;
  inline?: boolean;
}) {
  const id = useId();
  const chosen = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  const toggle = (code: string, on: boolean) =>
    onChange(
      multiple ? (on ? [...chosen, code] : chosen.filter((c) => c !== code)) : on ? code : '',
    );
  const many = options.length > 6;
  return (
    <fieldset
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className="min-w-0"
    >
      <legend className="mb-1 text-xs font-medium text-firm-primary">{label}</legend>
      {multiple && selectAll && (
        <Checkbox
          name={`${name}-all`}
          label={selectAll}
          className="gap-2! text-xs! font-semibold sm:min-h-6!"
          checked={chosen.length === options.length}
          onChange={(event) => onChange(event.target.checked ? options.map((o) => o.value) : [])}
        />
      )}
      {cards ? (
        <div className="grid gap-2 md:grid-cols-3">
          {options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <label
                key={o.value}
                className={`flex min-w-0 cursor-pointer flex-col gap-1 rounded-control border p-3 ${on ? 'border-action bg-accent-soft' : 'border-folder-border bg-surface'}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type={multiple ? 'checkbox' : 'radio'}
                    name={name}
                    checked={on}
                    onChange={(event) => toggle(o.value, event.target.checked)}
                    className="size-4 shrink-0"
                  />
                  <span className="flex-1 font-display text-lg font-bold text-heading">
                    {o.label}
                  </span>
                  {o.badge && (
                    <span className="rounded-control bg-action px-2 py-0.5 text-xs font-semibold text-on-action">
                      {o.badge}
                    </span>
                  )}
                </span>
                {o.help && <span className="text-xs text-firm-primary">{o.help}</span>}
                {o.details && (
                  <ul className="space-y-1 text-xs">
                    {o.details.map((d) => (
                      <li key={d} className="flex items-start gap-1">
                        <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-accent" />
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </label>
            );
          })}
        </div>
      ) : (
        <div
          className={
            inline
              ? 'flex flex-wrap gap-x-4'
              : many
                ? 'grid gap-x-4 sm:grid-cols-2'
                : 'flex flex-wrap gap-x-4'
          }
        >
          {options.map((o) =>
            multiple ? (
              <Checkbox
                key={o.value}
                name={name}
                label={o.label}
                className="gap-2! text-xs! sm:min-h-6!"
                checked={chosen.includes(o.value)}
                onChange={(event) => toggle(o.value, event.target.checked)}
              />
            ) : (
              <Radio
                key={o.value}
                name={name}
                label={o.help ? `${o.label}: ${o.help}` : o.label}
                className="gap-2! text-xs! sm:min-h-6!"
                checked={chosen.includes(o.value)}
                onChange={() => toggle(o.value, true)}
              />
            ),
          )}
        </div>
      )}
      <ErrorText id={`${id}-error`} error={error} />
    </fieldset>
  );
}

function MaskedNumberInput({
  field,
  label,
  value,
  onChange,
  error,
}: {
  field: Extract<IntakeScalarField, { type: 'ssn' | 'ein' }>;
  label: string;
  value: ScreenScalar;
  onChange: (value: ScreenScalar) => void;
  error?: string | undefined;
}) {
  const kind = field.type === 'ssn' ? 'SSN' : 'EIN';
  if (isMasked(value)) {
    const shown = kind === 'SSN' ? `•••-••-${value.last4}` : `••-•••${value.last4}`;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-firm-primary">{label}</span>
        <div className="flex items-center gap-2">
          <span className="flex-1 rounded-control border border-border px-2 py-1 text-xs">
            {shown}
          </span>
          <Button
            variant="outline"
            onClick={() => onChange('')}
            className="min-h-7! px-2! py-1! text-xs!"
          >
            Change
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="[&_label]:text-xs">
      <MaskedInput
        label={label}
        kind={kind}
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
        error={error}
      />
    </div>
  );
}

/** One scalar field: the field's own input, its help line and its error. */
export function ScalarInput({
  field,
  value,
  onChange,
  error,
  fill,
  name,
}: {
  field: IntakeScalarField;
  value: ScreenScalar;
  onChange: (value: ScreenScalar) => void;
  error?: string | undefined;
  fill: Fill;
  /** A unique name for radios and checkboxes (group rows pass one per row). */
  name: string;
}) {
  const label = labelOf(field, fill);
  const placeholder = field.placeholder ? fill(field.placeholder) : undefined;
  const text = typeof value === 'string' ? value : '';
  const common = {
    label,
    error,
    placeholder,
    className: compactInput,
    'data-field': field.key,
    'data-type': field.type,
  };
  const help = field.help ? <Help text={fill(field.help)} /> : null;
  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'url':
    case 'zip':
    case 'date':
    case 'month':
    case 'year':
    case 'number':
    case 'currency': {
      const type =
        field.type === 'email'
          ? 'email'
          : field.type === 'phone'
            ? 'tel'
            : field.type === 'url'
              ? 'url'
              : field.type === 'date'
                ? 'date'
                : field.type === 'month'
                  ? 'month'
                  : 'text';
      const numeric = ['year', 'number', 'currency', 'zip'].includes(field.type);
      return (
        <div className="min-w-0 [&_label]:text-xs [&_label]:text-firm-primary">
          <Input
            {...common}
            type={type}
            inputMode={field.type === 'currency' ? 'decimal' : numeric ? 'numeric' : undefined}
            maxLength={field.type === 'text' ? field.maxLength : undefined}
            placeholder={placeholder ?? (field.type === 'currency' ? '$0.00' : undefined)}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
          {help}
        </div>
      );
    }
    case 'textarea': {
      return (
        <TextareaInput
          field={field}
          label={label}
          value={text}
          onChange={onChange}
          error={error}
          fill={fill}
        />
      );
    }
    case 'ssn':
    case 'ein':
      return (
        <div className="min-w-0">
          <MaskedNumberInput
            field={field}
            label={label}
            value={value as string | MaskedNumber}
            onChange={onChange}
            error={error}
          />
          {help}
        </div>
      );
    case 'state':
      return field.multiple ? (
        <OptionList
          name={name}
          label={label}
          options={STATE_OPTIONS}
          multiple
          value={value}
          onChange={onChange}
          error={error}
        />
      ) : (
        <div className="min-w-0 [&_label]:text-xs [&_label]:text-firm-primary">
          <Select
            label={label}
            error={error}
            className={compactInput}
            data-field={field.key}
            options={[{ value: '', label: 'Select a state' }, ...STATE_OPTIONS]}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      );
    case 'select':
      return (
        <div className="min-w-0 [&_label]:text-xs [&_label]:text-firm-primary">
          <Select
            label={label}
            error={error}
            className={compactInput}
            data-field={field.key}
            options={[
              { value: '', label: placeholder ?? 'Select one' },
              ...field.options.map((o) => ({ value: o.value, label: o.label })),
            ]}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
          {help}
        </div>
      );
    case 'yesNo':
      return (
        <div className="min-w-0">
          <OptionList
            name={name}
            label={label}
            options={[
              { value: 'YES', label: 'Yes' },
              { value: 'NO', label: 'No' },
            ]}
            multiple={false}
            inline
            value={value === true ? 'YES' : value === false ? 'NO' : ''}
            onChange={(v) => onChange(v === 'YES' ? true : v === 'NO' ? false : null)}
            error={error}
          />
          {help}
        </div>
      );
    case 'checkbox':
      return (
        <div className="min-w-0">
          <Checkbox
            name={name}
            label={label}
            className="gap-2! text-xs! sm:min-h-6!"
            checked={value === true}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.checked)}
          />
          {help}
          <ErrorText id={`${name}-error`} error={error} />
        </div>
      );
    case 'radio':
      return (
        <div className="min-w-0">
          <OptionList
            name={name}
            label={label}
            options={field.options}
            multiple={false}
            cards={field.display === 'cards'}
            value={value}
            onChange={onChange}
            error={error}
          />
          {help}
        </div>
      );
    case 'checkboxes':
      return (
        <div className="min-w-0">
          <OptionList
            name={name}
            label={label}
            options={field.options}
            multiple
            cards={field.display === 'cards'}
            selectAll={field.selectAll ? fill(field.selectAll) : undefined}
            value={value}
            onChange={onChange}
            error={error}
          />
          {help}
        </div>
      );
  }
}

function TextareaInput({
  field,
  label,
  value,
  onChange,
  error,
  fill,
}: {
  field: Extract<IntakeScalarField, { type: 'textarea' }>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  fill: Fill;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-firm-primary">
        {label}
      </label>
      <textarea
        id={id}
        data-field={field.key}
        rows={3}
        maxLength={field.maxLength}
        placeholder={field.placeholder ? fill(field.placeholder) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded-control border bg-surface px-2 py-1 text-xs text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 ${error ? 'border-danger' : 'border-border'}`}
      />
      <p id={`${id}-count`} className="text-right text-xs text-muted">
        {value.length.toLocaleString('en-US')}/{field.maxLength.toLocaleString('en-US')}
      </p>
      {field.help && <Help text={fill(field.help)} />}
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

/** Text to read, with no answer (an "i" callout). */
export function InfoNote({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-control bg-folder-surface p-2 text-xs">
      <Info aria-hidden="true" className="size-5 shrink-0 text-accent" />
      <p>
        <strong className="text-heading">{label}</strong> {text}
      </p>
    </div>
  );
}
