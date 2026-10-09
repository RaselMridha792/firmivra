'use client';

import { Input, Select } from '@firmivra/ui';
import { Controller, useFormContext, type FieldPath } from 'react-hook-form';
import { useId, type InputHTMLAttributes } from 'react';
import { ChoiceGroup, MaskedInput, YesNoQuestion, compactInput } from '../../_blocks/form-blocks';
import { states } from './annual-data';
import type { AnnualValues } from './annual-schema';

type FieldProps = { name: FieldPath<AnnualValues>; label: string; disabled?: boolean };
export function TextField({
  name,
  label,
  ...props
}: FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'name'>) {
  const { register, getFieldState, formState } = useFormContext<AnnualValues>();
  return (
    <div className="min-w-0 [&_label]:text-xs">
      <Input
        {...props}
        {...register(name)}
        label={label}
        error={getFieldState(name, formState).error?.message}
        className={compactInput}
      />
    </div>
  );
}
export function SelectField({
  name,
  label,
  options,
  disabled,
}: FieldProps & { options: readonly string[] }) {
  const { register, getFieldState, formState } = useFormContext<AnnualValues>();
  return (
    <div className="[&_label]:text-xs">
      <Select
        {...register(name)}
        label={label}
        disabled={disabled}
        options={[
          { value: '', label: `Select ${label.toLowerCase().replace(' *', '')}` },
          ...options.map((value) => ({ value, label: value })),
        ]}
        error={getFieldState(name, formState).error?.message}
        className={compactInput}
      />
    </div>
  );
}
export function MaskedField({
  name,
  label,
  disabled,
  kind,
}: FieldProps & { kind?: 'SSN' | 'EIN' }) {
  const { control } = useFormContext<AnnualValues>();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <MaskedInput
          label={label}
          value={String(field.value ?? '')}
          onChange={field.onChange}
          disabled={disabled}
          error={fieldState.error?.message}
          kind={kind}
        />
      )}
    />
  );
}
export function ChoiceField({
  name,
  label,
  options,
  multiple,
  disabled,
  yesNo,
  onChange,
}: FieldProps & {
  options?: readonly string[];
  multiple?: boolean;
  yesNo?: boolean;
  onChange?: (value: string | string[]) => void;
}) {
  const { control } = useFormContext<AnnualValues>();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value =
          typeof field.value === 'string' ||
          (Array.isArray(field.value) && field.value.every((item) => typeof item === 'string'))
            ? (field.value as string | string[])
            : '';
        const props = {
          label,
          value: !multiple && Array.isArray(value) ? (value[0] ?? '') : value,
          onChange: onChange ?? field.onChange,
          disabled,
          error: fieldState.error?.message,
        };
        return yesNo ? (
          <YesNoQuestion {...props} />
        ) : (
          <ChoiceGroup {...props} options={options ?? []} multiple={multiple} />
        );
      }}
    />
  );
}
export function TextAreaField({
  name,
  label,
  placeholder,
  rows = 2,
  disabled = false,
  hideLabel = false,
}: FieldProps & { placeholder?: string; rows?: number; hideLabel?: boolean }) {
  const { register, getFieldState, formState } = useFormContext<AnnualValues>();
  const id = useId();
  const error = getFieldState(name, formState).error?.message;
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-xs text-firm-primary'}>
        {label}
      </label>
      <textarea
        id={id}
        {...register(name)}
        disabled={disabled}
        rows={rows}
        maxLength={1000}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="w-full rounded-control border border-border bg-surface px-2 py-1 text-xs text-text disabled:bg-subtle"
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
export function NameFields({
  prefix,
  label = 'Full Legal Name *',
  disabled = false,
}: {
  prefix: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 text-xs text-firm-primary">{label}</legend>
      <div className="grid grid-cols-3 gap-1 [&_label]:sr-only">
        {(['first', 'middle', 'last'] as const).map((part) => (
          <TextField
            key={part}
            name={`${prefix}.${part}` as FieldPath<AnnualValues>}
            label={`${prefix === 'personal' ? '' : `${label} `}${part === 'middle' ? 'Middle name (if any)' : `${part === 'first' ? 'First' : 'Last'} name`}`}
            placeholder={
              part === 'middle' ? 'Middle (if any)' : part === 'first' ? 'First' : 'Last'
            }
            autoComplete="off"
          />
        ))}
      </div>
    </fieldset>
  );
}
export function AddressFields({
  prefix,
  label,
  disabled = false,
}: {
  prefix: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1 text-xs text-firm-primary">{label}</legend>
      <div className="space-y-1 [&_label]:sr-only">
        <TextField
          name={`${prefix}.street` as FieldPath<AnnualValues>}
          label={`${label} street`}
          placeholder="Street Address"
          autoComplete="off"
        />
        <div className="grid grid-cols-4 gap-1">
          <div className="col-span-2">
            <TextField
              name={`${prefix}.city` as FieldPath<AnnualValues>}
              label={`${label} city`}
              placeholder="City"
            />
          </div>
          <SelectField
            name={`${prefix}.state` as FieldPath<AnnualValues>}
            label={`${label} state`}
            options={states}
          />
          <TextField
            name={`${prefix}.zip` as FieldPath<AnnualValues>}
            label={`${label} ZIP code`}
            placeholder="ZIP Code"
            inputMode="numeric"
            maxLength={10}
          />
        </div>
      </div>
    </fieldset>
  );
}
