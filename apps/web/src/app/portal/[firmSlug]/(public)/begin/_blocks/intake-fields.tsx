'use client';

import {
  type IntakeOption,
  type IntakeScalarField,
  type MaskedNumber,
  US_STATES,
} from '@firmivra/types';
import { Button, Checkbox, Input, Radio, Select } from '@firmivra/ui';
import { CircleCheck, Info, type LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { compactInput, MaskedInput } from './form-blocks';
import type { FieldLook } from './intake-rows';
import { isMasked, type ScreenScalar } from './intake-values';

// One input per scalar field type of an intake definition (packages/types/src/intake/definition.ts).
// Labels carry " *" when required; every error sits under its input (aria-describedby).

export type Fill = (text: string) => string;

const STATE_OPTIONS = Object.entries(US_STATES).map(([value, label]) => ({ value, label }));

// A no-break space before the star, so it never wraps onto a line of its own.
const NBSP_STAR = `${String.fromCharCode(0xa0)}*`;
export const labelOf = (f: { label: string; required: boolean }, fill: Fill) =>
  `${fill(f.label)}${f.required ? NBSP_STAR : ''}`;

/** "Title (if applicable) *" → the title, and its last bracket (with any star) to set smaller. */
export function splitBracket(text: string): [string, string] {
  const m = /^(.*\S)\s+(\([^()]*\)(?:\s\*)?)$/.exec(text);
  return m ? [m[1]!, m[2]!] : [text, ''];
}

/** Choice columns (whole classes, so Tailwind finds them). */
const OPTION_COLUMNS = {
  1: 'grid',
  2: 'sm:columns-2 sm:gap-x-4 [&>*]:break-inside-avoid',
  3: 'sm:columns-3 sm:gap-x-4 [&>*]:break-inside-avoid',
  // Four short choices on one line (the quarters), never wrapping inside a label.
  4: 'sm:flex sm:flex-wrap sm:gap-x-3 [&_label]:whitespace-nowrap',
} as const;

/** What a field shows when its definition has no placeholder, as the mockups fill them. */
const PLACEHOLDERS: Partial<Record<IntakeScalarField['type'], string>> = {
  email: 'you@example.com',
  phone: '(   )     -',
  url: 'https://www.yourwebsite.com',
};

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
  row,
  box: BoxIcon,
  quiet = false,
  columns,
  cardIcons,
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
  /** Yes/No: the two answers set wide apart on one line. */
  inline?: boolean;
  /** The question and its answers on one line (a list of Yes/No questions). */
  row?: boolean | undefined;
  /** A tinted box with this icon and the label as its heading. */
  box?: LucideIcon | undefined;
  /** The question only for screen readers (its panel's title asks it). */
  quiet?: boolean | undefined;
  /** The choices in this many columns, as the mockup sets them. */
  columns?: 1 | 2 | 3 | 4 | undefined;
  /** Package cards' icons, by option value. */
  cardIcons?: Record<string, LucideIcon> | undefined;
}) {
  const id = useId();
  const chosen = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  const toggle = (code: string, on: boolean) =>
    onChange(
      multiple ? (on ? [...chosen, code] : chosen.filter((c) => c !== code)) : on ? code : '',
    );
  const many = options.length > 6;
  const [main, bracket] = splitBracket(label);
  const choice = `gap-2! text-xs! ${row ? 'sm:min-h-5!' : 'sm:min-h-6!'}`;
  return (
    <fieldset
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={`min-w-0 ${row ? 'flex flex-wrap items-center gap-x-3' : ''} ${BoxIcon ? 'rounded-control bg-accent-soft p-3' : ''}`}
    >
      {BoxIcon ? (
        <legend className="float-left mb-2 flex w-full items-center gap-2">
          <BoxIcon aria-hidden="true" className="size-7 shrink-0 text-accent" />
          <span>
            <span className="font-display text-lg leading-tight font-bold text-heading">
              {main}
            </span>{' '}
            {bracket && <span className="text-xs text-firm-primary">{bracket}</span>}
          </span>
        </legend>
      ) : (
        <legend className={row || quiet ? 'sr-only' : 'mb-1 text-xs font-medium text-firm-primary'}>
          {label}
        </legend>
      )}
      {row && !quiet && (
        <span aria-hidden="true" className="min-w-0 flex-1 text-xs text-firm-primary">
          {label}
        </span>
      )}
      {multiple && selectAll && (
        <Checkbox
          name={`${name}-all`}
          label={selectAll}
          className="mb-1 gap-2! rounded-control bg-folder-surface px-2 text-xs! font-semibold sm:min-h-7!"
          checked={chosen.length === options.length}
          onChange={(event) => onChange(event.target.checked ? options.map((o) => o.value) : [])}
        />
      )}
      {/* Package cards; options with help text read as a bold title and its help beneath. */}
      {!cards && options.some((o) => o.help) ? (
        <div className="clear-both grid gap-x-6 gap-y-2 md:grid-cols-3">
          {options.map((o) => (
            <label key={o.value} className="flex min-w-0 cursor-pointer items-start gap-2">
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={name}
                checked={chosen.includes(o.value)}
                onChange={(event) => toggle(o.value, event.target.checked)}
                className="mt-0.5 size-5 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-heading">{o.label}</span>
                {o.help && <span className="block text-xs text-firm-primary">{o.help}</span>}
              </span>
            </label>
          ))}
        </div>
      ) : cards ? (
        <div className="clear-both grid gap-3 md:grid-cols-3">
          {options.map((o) => (
            <PackageCard
              key={o.value}
              option={o}
              name={name}
              multiple={multiple}
              on={chosen.includes(o.value)}
              icon={cardIcons?.[o.value]}
              onChange={(on) => toggle(o.value, on)}
            />
          ))}
        </div>
      ) : (
        <div
          className={
            row
              ? 'flex shrink-0 gap-x-6'
              : columns
                ? `clear-both gap-x-4 [&_input]:size-4 ${OPTION_COLUMNS[columns]}`
                : inline
                  ? 'flex flex-wrap gap-x-12'
                  : many || BoxIcon
                    ? 'clear-both grid gap-x-4 sm:grid-cols-2'
                    : 'flex flex-wrap gap-x-6'
          }
        >
          {options.map((o) =>
            multiple ? (
              <Checkbox
                key={o.value}
                name={name}
                label={o.label}
                className={choice}
                checked={chosen.includes(o.value)}
                onChange={(event) => toggle(o.value, event.target.checked)}
              />
            ) : (
              <Radio
                key={o.value}
                name={name}
                label={o.label}
                className={choice}
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
  look = {},
}: {
  field: IntakeScalarField;
  value: ScreenScalar;
  onChange: (value: ScreenScalar) => void;
  error?: string | undefined;
  fill: Fill;
  /** A unique name for radios and checkboxes (group rows pass one per row). */
  name: string;
  /** How its mockup draws it (intake-rows). */
  look?: FieldLook;
}) {
  const label = look.label
    ? labelOf({ label: look.label, required: field.required }, (t) => t)
    : labelOf(field, fill);
  const placeholder =
    look.placeholder ?? (field.placeholder ? fill(field.placeholder) : PLACEHOLDERS[field.type]);
  const text = typeof value === 'string' ? value : '';
  const common = {
    label,
    error,
    placeholder,
    className: compactInput,
    'data-field': field.key,
    'data-type': field.type,
  };
  // The label only for screen readers, or on the left of the input, as the mockup draws it.
  const wrap = `min-w-0 [&_label]:text-xs [&_label]:text-firm-primary ${look.quiet ? '[&_label]:sr-only' : ''} ${look.inline ? 'sm:[&>div]:flex-row sm:[&>div]:items-center sm:[&>div]:gap-3 [&_input]:flex-1 sm:[&_label]:w-3/5 [&_label]:shrink-0' : ''}`;
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
        <div className={wrap}>
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
          look={look}
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
        <div className={wrap}>
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
        <StatesInput
          fieldKey={field.key}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
        />
      ) : (
        <div className={wrap}>
          <Select
            label={label}
            error={error}
            className={compactInput}
            data-field={field.key}
            options={[{ value: '', label: look.placeholder ?? 'Select a state' }, ...STATE_OPTIONS]}
            value={text}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      );
    case 'select':
      return (
        <div className={wrap}>
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
            row={look.row}
            quiet={look.quiet}
            value={value === true ? 'YES' : value === false ? 'NO' : ''}
            onChange={(v) => onChange(v === 'YES' ? true : v === 'NO' ? false : null)}
            error={error}
          />
          {help}
        </div>
      );
    case 'checkbox':
      return (
        <div
          className={`min-w-0 ${look.alert ? 'rounded-control border border-danger bg-surface p-3 [&_label]:font-display [&_label]:text-base! [&_label]:font-bold [&_label]:text-danger' : ''}`}
        >
          <Checkbox
            name={name}
            label={label}
            // A long label (a certification) starts beside the box, not centred on it.
            className={`gap-2! text-xs! sm:min-h-6! ${label.length > 80 ? 'items-start! [&_input]:mt-0.5' : ''}`}
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
            box={look.box}
            quiet={look.quiet}
            columns={look.columns}
            cardIcons={look.cardIcons}
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
            box={look.box}
            quiet={look.quiet}
            columns={look.columns}
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
  look,
  value,
  onChange,
  error,
  fill,
}: {
  field: Extract<IntakeScalarField, { type: 'textarea' }>;
  label: string;
  look: FieldLook;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  fill: Fill;
}) {
  const id = useId();
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 ${look.inline ? 'sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3' : ''}`}
    >
      <label
        htmlFor={id}
        className={`text-xs font-medium text-firm-primary ${look.quiet ? 'sr-only' : ''} ${look.inline ? 'sm:shrink-0' : ''}`}
      >
        {label}
      </label>
      <textarea
        id={id}
        data-field={field.key}
        rows={look.inline ? 1 : 3}
        maxLength={field.maxLength}
        placeholder={field.placeholder ? fill(field.placeholder) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded-control border bg-surface px-2 py-1 text-xs text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 ${look.inline ? 'sm:min-w-0 sm:flex-1' : ''} ${error ? 'border-danger' : 'border-border'}`}
      />
      {/* The count shows once something is typed (the mockups' empty fields have none). */}
      <p
        id={`${id}-count`}
        className={`text-right text-xs text-muted ${value ? (look.inline ? 'sm:w-full' : '') : 'sr-only'}`}
      >
        {value.length.toLocaleString('en-US')}/{field.maxLength.toLocaleString('en-US')}
      </p>
      {field.help && <Help text={fill(field.help)} />}
      <ErrorText id={`${id}-error`} error={error} />
    </div>
  );
}

/** Text to read, with no answer (an "i" callout). */
export function InfoNote({
  label,
  text,
  list = false,
  card = false,
}: {
  label: string;
  text: string;
  /** Its sentences as bullets beside a large icon (a step's "Important:" box). */
  list?: boolean | undefined;
  /** A box: the icon and the bold title on one line, the text under it. */
  card?: boolean | undefined;
}) {
  if (card) {
    return (
      <div className="rounded-control bg-folder-surface p-3 text-xs">
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-heading">
          <Info aria-hidden="true" className="size-6 shrink-0 fill-action text-surface" />
          {label}
        </p>
        <p>{text}</p>
      </div>
    );
  }
  if (list) {
    const items = text.split(/(?<=\.)\s+(?=[A-Z"])/);
    return (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-control bg-accent-soft p-3 text-xs">
        <p className="flex items-center gap-3">
          <Info aria-hidden="true" className="size-10 shrink-0 text-accent" />
          <strong className="font-display text-xl text-heading">{label}:</strong>
        </p>
        <ul className="min-w-60 flex-1 list-disc space-y-0.5 pl-4">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-control bg-folder-surface p-2 text-xs">
      <Info aria-hidden="true" className="size-5 shrink-0 text-accent" />
      <p>
        <strong className="text-heading">{label}</strong> {text}
      </p>
    </div>
  );
}

/**
 * Several states, as the mockups ask ("Select state(s)"): a dropdown that adds a state and a
 * removable chip for each one chosen, instead of 51 checkboxes.
 */
function StatesInput({
  fieldKey,
  label,
  value,
  onChange,
  error,
}: {
  fieldKey: string;
  label: string;
  value: ScreenScalar;
  onChange: (value: ScreenScalar) => void;
  error?: string | undefined;
}) {
  const chosen = Array.isArray(value) ? value : [];
  const nameOf = (code: string) => STATE_OPTIONS.find((o) => o.value === code)?.label ?? code;
  return (
    <div className="min-w-0 space-y-1 [&_label]:text-xs [&_label]:text-firm-primary">
      <Select
        label={label}
        error={error}
        className={compactInput}
        data-field={fieldKey}
        options={[
          { value: '', label: chosen.length ? 'Add another state' : 'Select state(s)' },
          ...STATE_OPTIONS.filter((o) => !chosen.includes(o.value)),
        ]}
        value=""
        onChange={(event) => {
          if (event.target.value) onChange([...chosen, event.target.value]);
        }}
      />
      {chosen.length > 0 && (
        <ul aria-label={`${label}: chosen`} className="flex flex-wrap gap-1">
          {chosen.map((code) => (
            <li
              key={code}
              className="flex items-center gap-1 rounded-control border border-folder-border bg-folder-surface px-2 py-0.5 text-xs"
            >
              {nameOf(code)}
              <button
                type="button"
                aria-label={`Remove ${nameOf(code)}`}
                className="min-h-6 px-1"
                onClick={() => onChange(chosen.filter((c) => c !== code))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Essential Bookkeeping. Solid Foundation. Perfect for..." → the short tagline and the rest. */
function tagline(help: string): [string, string] {
  const sentences = help.split(/(?<=\.)\s+/);
  let n = 0;
  while (n < sentences.length - 1 && sentences[n]!.split(' ').length <= 3) n += 1;
  return [sentences.slice(0, n).join(' '), sentences.slice(n).join(' ')];
}

/** A package as its mockup's card: icon, name, badge and radio; tagline, help and ticks. */
function PackageCard({
  option: o,
  name,
  multiple,
  on,
  icon: Icon,
  onChange,
}: {
  option: IntakeOption;
  name: string;
  multiple: boolean;
  on: boolean;
  icon: LucideIcon | undefined;
  onChange: (on: boolean) => void;
}) {
  const [lead, rest] = tagline(o.help ?? '');
  return (
    <label
      className={`flex min-w-0 cursor-pointer flex-col gap-2 rounded-card border p-4 ${on ? 'border-action bg-accent-soft' : 'border-folder-border bg-folder-surface'}`}
    >
      <span className="flex items-center gap-3">
        {Icon && (
          <Icon
            aria-hidden="true"
            className={`size-9 shrink-0 fill-current ${on ? 'text-action' : 'text-info'}`}
          />
        )}
        <span className="font-display text-xl font-bold text-heading">{o.label}</span>
        {o.badge && (
          <span className="rounded-control bg-action px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-on-action">
            {o.badge}
          </span>
        )}
        <input
          type={multiple ? 'checkbox' : 'radio'}
          name={name}
          checked={on}
          onChange={(event) => onChange(event.target.checked)}
          className="ml-auto size-5 shrink-0"
        />
      </span>
      {lead && (
        <span className={`font-display text-sm font-bold ${on ? 'text-action' : 'text-heading'}`}>
          {lead}
        </span>
      )}
      {rest && <span className="text-sm text-text">{rest}</span>}
      {o.details && (
        <ul className="space-y-1 text-sm text-firm-primary">
          {o.details.map((d) => {
            const everything = /^(Everything in )(.+)$/.exec(d);
            return (
              <li key={d} className="flex items-start gap-2">
                <CircleCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 fill-action text-surface"
                />
                <span>
                  {everything ? (
                    <>
                      {everything[1]}
                      <strong>{everything[2]}</strong>
                    </>
                  ) : (
                    d
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </label>
  );
}
