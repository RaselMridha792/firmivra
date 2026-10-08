'use client';

import { Button, Card, Checkbox, Input, Radio } from '@firmivra/ui';
import { ArrowRight, ChevronDown, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

export const compactInput = 'min-h-11 w-full px-2! py-1! text-xs! sm:min-h-7';

export function SectionPanel({
  number,
  title,
  subtitle,
  icon,
  iconPosition = 'end',
  aside,
  children,
  className = '',
}: {
  number?: number;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  iconPosition?: 'start' | 'end';
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <Card
      aria-labelledby={titleId}
      className={`min-w-0 border-folder-border! p-3! shadow-none! ${aside ? 'grid items-start gap-x-3 lg:grid-cols-2' : ''} ${className}`}
    >
      <header className="mb-2 flex items-center gap-3">
        {number !== undefined && (
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-navigation font-display text-3xl leading-none text-white"
          >
            {number}
          </span>
        )}
        {icon && iconPosition === 'start' && (
          <span aria-hidden="true" className="shrink-0 text-accent">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-xl leading-tight font-bold text-heading">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-firm-primary">{subtitle}</p>}
        </div>
        {icon && iconPosition === 'end' && (
          <span aria-hidden="true" className="shrink-0 text-accent">
            {icon}
          </span>
        )}
      </header>
      {aside ? (
        <>
          <div className="min-w-0 lg:col-start-1">{children}</div>
          <aside className="mt-3 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
            {aside}
          </aside>
        </>
      ) : (
        children
      )}
    </Card>
  );
}

export function ChoiceGroup({
  label,
  options,
  value,
  onChange,
  multiple = false,
  disabled = false,
  error,
  compact = false,
}: {
  label: string;
  options: readonly string[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  error?: string;
  compact?: boolean;
}) {
  const id = useId();
  const selected = Array.isArray(value) ? value : [value];
  return (
    <fieldset
      disabled={disabled}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
      className={`min-w-0 ${compact ? 'flex flex-wrap items-center justify-between gap-x-2' : ''}`}
    >
      <legend className={compact ? 'sr-only' : 'mb-1 text-xs text-firm-primary'}>{label}</legend>
      {compact && (
        <span aria-hidden="true" className="flex-1 text-xs text-firm-primary">
          {label}
        </span>
      )}
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1">
        {options.map((option) =>
          multiple ? (
            <Checkbox
              key={option}
              name={id}
              label={option}
              className="gap-2! text-xs! sm:min-h-6!"
              checked={selected.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected.filter(Boolean), option]
                    : selected.filter((item) => item !== option),
                )
              }
            />
          ) : (
            <Radio
              key={option}
              name={id}
              label={option}
              className="gap-2! text-xs! sm:min-h-6!"
              checked={value === option}
              onChange={() => onChange(option)}
            />
          ),
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function YesNoQuestion(
  props: Omit<Parameters<typeof ChoiceGroup>[0], 'options' | 'multiple'>,
) {
  return <ChoiceGroup {...props} options={['Yes', 'No']} compact />;
}

export function MaskedInput({
  label,
  value,
  onChange,
  error,
  disabled,
  kind = 'SSN',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  kind?: 'SSN' | 'EIN';
}) {
  const [visible, setVisible] = useState(false);
  const displayed =
    kind === 'SSN'
      ? value.replace(/^(\d{3})(\d{2})(\d{1,4})$/, '$1-$2-$3')
      : value.replace(/^(\d{2})(\d{1,7})$/, '$1-$2');
  return (
    <div className="relative [&_label]:text-xs">
      <Input
        label={label}
        value={visible ? displayed : value}
        type={visible ? 'text' : 'password'}
        autoComplete="off"
        inputMode="numeric"
        maxLength={visible ? 11 : 9}
        placeholder={kind === 'SSN' ? '___-__-____' : '__-_______'}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 9))}
        error={error}
        className={`${compactInput} pr-10!`}
      />
      <Button
        variant="ghost"
        disabled={disabled}
        aria-label={`${visible ? 'Hide' : 'Show'} ${label.replace(' *', '')}`}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
        className="absolute top-5 right-1 min-h-7! px-1! py-1!"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}

export function Repeater({
  title,
  ids,
  children,
  onAdd,
  onRemove,
  disabled = false,
  error,
}: {
  title: string;
  ids: string[];
  children: (index: number) => ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      {ids.map((id, index) => (
        <details
          key={id}
          open
          data-testid={`${title.toLowerCase()}-${index + 1}`}
          className="rounded-control border border-folder-border"
        >
          <summary className="flex cursor-pointer items-center gap-2 rounded-t-control bg-folder-surface px-2 py-1 text-xs font-semibold text-heading">
            <ChevronDown aria-hidden="true" className="size-4" />
            {title} {index + 1}
            <Button
              variant="ghost"
              disabled={disabled}
              aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
              onClick={(event) => {
                event.preventDefault();
                onRemove(index);
              }}
              className="ml-auto min-h-7! px-1! py-1!"
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </summary>
          <div className="space-y-2 p-2">{children(index)}</div>
        </details>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button
        variant="outline"
        disabled={disabled}
        onClick={onAdd}
        className="w-full border-dashed text-xs! sm:min-h-7!"
      >
        <Plus aria-hidden="true" className="size-4" />
        Add Another {title}
      </Button>
    </div>
  );
}

export function IntakeStepper({
  steps,
  current,
  onEdit,
}: {
  steps: { id: number; label: string }[];
  current: number;
  onEdit: (step: number) => void;
}) {
  return (
    <ol aria-label="Intake progress" className="mb-3 flex">
      {steps.map(({ id, label }, index) => (
        <li
          key={id}
          aria-current={current === id ? 'step' : undefined}
          className="relative flex min-w-0 flex-1 flex-col items-center gap-1 text-center text-xs text-firm-primary"
        >
          {index < steps.length - 1 && (
            <span aria-hidden="true" className="absolute top-4 left-1/2 h-px w-full bg-action/40" />
          )}
          <Button
            variant="ghost"
            disabled={id > current}
            onClick={() => onEdit(id)}
            aria-label={`Go to ${label}`}
            className={`relative min-h-9! w-9 rounded-full! p-0! ${current === id ? 'bg-action! text-on-action!' : 'bg-folder-surface!'}`}
          >
            <span aria-hidden="true">{index + 1}</span>
          </Button>
          <span className={`px-1 ${current === id ? 'font-semibold' : ''}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function ReviewCard({
  title,
  onEdit,
  children,
  className = '',
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`min-w-0 border-folder-border! p-3! shadow-none! ${className}`}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-heading">{title}</h3>
        <Button
          variant="outline"
          onClick={onEdit}
          aria-label={`Edit ${title}`}
          className="min-h-7! gap-1! px-2! py-1! text-xs!"
        >
          <Pencil aria-hidden="true" className="size-3" />
          Edit
        </Button>
      </header>
      {children}
    </Card>
  );
}

export function ReviewRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="overflow-hidden rounded-control border border-folder-border text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-2 border-b border-folder-border last:border-0">
          <dt className="border-r border-folder-border px-2 py-1 text-firm-primary">{label}</dt>
          <dd className="min-w-0 px-2 py-1 break-words text-muted">{value || 'Not provided'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ContinueButton({ label = 'Continue' }: { label?: string }) {
  return (
    <Button type="submit" className="min-w-40">
      {label}
      <ArrowRight aria-hidden="true" className="size-4" />
    </Button>
  );
}
