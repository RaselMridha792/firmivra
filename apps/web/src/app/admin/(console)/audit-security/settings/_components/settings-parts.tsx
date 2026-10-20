'use client';

import { Card, IconTile, Radio, Select, Toggle } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import { useId, type ReactNode } from 'react';

/** The pieces of the Security Settings cards (firmivra-security-settings-dashboard.jpg). */

export function SettingsCard({
  id,
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  /** The anchor the section links above jump to. */
  id: string;
  title: string;
  subtitle: string;
  icon: Icon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      id={id}
      data-testid={`settings-${id}`}
      className="flex min-w-0 scroll-mt-4 items-start gap-4 p-5!"
    >
      <span className="hidden sm:block">
        <IconTile icon={icon} tone="blue" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-heading">{title}</h2>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
          {action}
        </div>
        {children}
      </div>
    </Card>
  );
}

/** A switch with its sentence; the sentence is the switch's name and also toggles it. */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-text">
      <Toggle label={label} checked={checked} onChange={onChange} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

/** A radio with the grey line under it, read as its description. */
export function RadioOption({
  name,
  label,
  hint,
  checked,
  onSelect,
  disabled,
}: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const hintId = useId();
  return (
    <div className="flex flex-col">
      <Radio
        name={name}
        label={label}
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={onSelect}
        className="font-medium text-heading"
      />
      <p id={hintId} className="-mt-2 pl-7 text-sm text-muted">
        {hint}
      </p>
    </div>
  );
}

export function YesNoSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Select
      label={label}
      value={value ? 'yes' : 'no'}
      onChange={(event) => onChange(event.target.value === 'yes')}
      options={[
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ]}
    />
  );
}

export function NumberSelect({
  label,
  value,
  choices,
  show,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  choices: readonly number[];
  show: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  // A stored value outside the list (set through the API) is shown as it is.
  const all = choices.includes(value) ? choices : [...choices, value];
  return (
    <Select
      label={label}
      value={String(value)}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      options={all.map((choice) => ({ value: String(choice), label: show(choice) }))}
    />
  );
}
