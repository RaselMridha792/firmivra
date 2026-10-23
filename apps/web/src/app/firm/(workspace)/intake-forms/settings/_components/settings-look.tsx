'use client';

import { type Icon, NotePencil } from '@phosphor-icons/react';
import { Card, Input, Select, Skeleton, Toggle } from '@firmivra/ui';
import Link from 'next/link';
import { type ReactNode, useId } from 'react';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { type SectionId, sectionDomId } from './settings-model';

/** The quiet line a frame shows instead of its content (empty, not available, no access). */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

/**
 * A frame whose data did not load keeps its frame and says so quietly (docs/design-match.md
 * rule 2): never one error panel for the page, never a made-up value.
 */
export function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (errorCode(error) === 'FORBIDDEN')
    return <Quiet>You don&apos;t have permission to see these settings.</Quiet>;
  return (
    <p className="text-sm text-muted" title={errorMessage(error)} data-testid="frame-failed">
      Could not load this right now.{' '}
      <button type="button" onClick={onRetry} className="font-medium text-link underline">
        Try again
      </button>
    </p>
  );
}

export function RowsLoading({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 py-1">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="flex-1" />
          <Skeleton className="w-24" />
        </div>
      ))}
    </div>
  );
}

/** Where a frame's data stands: loading, failed (with its retry) or ready. */
export type FrameState =
  { kind: 'loading' } | { kind: 'failed'; error: unknown; retry: () => void } | { kind: 'ready' };

const editClass =
  'inline-flex shrink-0 items-center gap-1 rounded-control text-sm font-medium text-link hover:text-action-hover';

/**
 * One settings card: the solid blue icon, the bold title and Edit on the right. Edit opens its
 * category (the nav selects it and the first field takes focus), or `editHref` for a category
 * kept in another module (Branding lives in Settings).
 */
export function SettingsCard({
  section,
  title,
  icon: Glyph,
  state,
  rows,
  onEdit,
  editHref,
  editLabel,
  children,
}: {
  section: SectionId;
  title: string;
  icon: Icon;
  state: FrameState;
  /** How many skeleton rows show while loading. */
  rows: number;
  onEdit: (section: SectionId) => void;
  editHref?: string;
  editLabel?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const edit = (
    <>
      <NotePencil aria-hidden weight="fill" className="size-4" />
      Edit
    </>
  );
  return (
    <Card
      variant="elevated"
      id={sectionDomId(section)}
      aria-labelledby={titleId}
      className="flex min-w-0 scroll-mt-20 flex-col gap-1 p-4!"
      data-testid={`settings-card-${section}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2
          id={titleId}
          className="flex min-w-0 items-center gap-3 text-base font-bold text-heading"
        >
          <Glyph aria-hidden weight="fill" className="size-6 shrink-0 text-action" />
          <span className="min-w-0">{title}</span>
        </h2>
        {editHref ? (
          <Link href={editHref} aria-label={editLabel ?? `Edit ${title}`} className={editClass}>
            {edit}
          </Link>
        ) : (
          <button
            type="button"
            aria-label={editLabel ?? `Edit ${title}`}
            onClick={() => onEdit(section)}
            className={editClass}
          >
            {edit}
          </button>
        )}
      </div>
      {state.kind === 'loading' ? (
        <RowsLoading rows={rows} />
      ) : state.kind === 'failed' ? (
        <LoadFailed error={state.error} onRetry={state.retry} />
      ) : (
        children
      )}
    </Card>
  );
}

/** A label on the left and its control on the right, as every card row in the design. */
function Row({
  labelId,
  htmlFor,
  label,
  control,
  width,
  labelWidth,
  labelClass = 'text-sm text-text',
  top,
}: {
  labelId?: string;
  htmlFor?: string;
  label: ReactNode;
  control: ReactNode;
  /** The control column's width (a spacing class), so a card's controls line up. */
  width?: string;
  /** A fixed label column instead; the control then takes the rest (text boxes). */
  labelWidth?: string;
  labelClass?: string;
  top?: boolean;
}) {
  const text = `min-w-0 ${labelWidth ? `shrink-0 ${labelWidth}` : 'flex-1'} ${labelClass}`;
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${top ? 'items-start' : 'items-center'}`}>
      {htmlFor ? (
        <label id={labelId} htmlFor={htmlFor} className={text}>
          {label}
        </label>
      ) : (
        <span id={labelId} className={text}>
          {label}
        </span>
      )}
      <div className={`min-w-0 ${labelWidth ? 'flex-1' : `shrink-0 ${width ?? ''}`}`}>
        {control}
      </div>
    </div>
  );
}

/** A switch with "On"/"Off" beside it; `fixed` shows a setting that cannot be switched off. */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  fixed,
  width,
  labelClass,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Why it cannot change ("Client pages always fit a phone"). */
  fixed?: string;
  width: string;
  labelClass?: string;
}) {
  const hintId = useId();
  return (
    <Row
      label={label}
      width={width}
      labelClass={labelClass}
      control={
        <span className="flex items-center gap-2">
          <Toggle
            label={label}
            checked={checked}
            onChange={onChange}
            disabled={disabled || !!fixed}
            title={fixed}
            aria-describedby={fixed ? hintId : undefined}
          />
          <span aria-hidden className="text-sm whitespace-nowrap text-text">
            {checked ? 'On' : 'Off'}
          </span>
          {fixed ? (
            <span id={hintId} className="sr-only">
              {fixed}
            </span>
          ) : null}
        </span>
      }
    />
  );
}

/** A setting that cannot change, shown as its value ("Always on"), not as a switch. */
export function FixedRow({ label, value, width }: { label: string; value: string; width: string }) {
  return (
    <Row
      label={label}
      width={width}
      control={
        <span className="text-sm font-semibold whitespace-nowrap text-heading">{value}</span>
      }
    />
  );
}

/** A compact kit Select with its label on the left; its error shows under it. */
export function SelectRow({
  label,
  value,
  options,
  onChange,
  error,
  disabled,
  width,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  width: string;
}) {
  const id = useId();
  return (
    <Row
      labelId={`${id}-label`}
      htmlFor={id}
      label={label}
      width={width}
      top={!!error}
      control={
        <Select
          id={id}
          label={label}
          hideLabel
          aria-labelledby={`${id}-label`}
          value={value}
          options={options}
          disabled={disabled}
          error={error}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-9 py-1! pr-7! text-sm!"
        />
      }
    />
  );
}

/** A compact kit Input with its label on the left. */
export function InputRow({
  label,
  value,
  onChange,
  error,
  disabled,
  labelWidth,
  type = 'text',
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  /** The label column; the box takes the rest of the row. */
  labelWidth: string;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <Row
      labelId={`${id}-label`}
      htmlFor={id}
      label={label}
      labelWidth={labelWidth}
      top={!!error}
      control={
        <Input
          id={id}
          type={type}
          label={label}
          hideLabel
          aria-labelledby={`${id}-label`}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          error={error}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-9 py-1! text-sm!"
        />
      }
    />
  );
}

/** A text box with its label on the left (Custom thank-you message). */
export function TextareaRow({
  label,
  value,
  onChange,
  error,
  disabled,
  labelWidth,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  /** The label column; the box takes the rest of the row. */
  labelWidth: string;
  maxLength: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <Row
      htmlFor={id}
      label={label}
      labelWidth={labelWidth}
      top
      control={
        <div className="flex flex-col gap-1">
          <textarea
            id={id}
            rows={3}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => onChange(event.target.value)}
            className={`w-full resize-y rounded-control border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-disabled ${error ? 'border-danger' : 'border-border'}`}
          />
          {error ? (
            <p id={`${id}-error`} className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
      }
    />
  );
}

/** A side frame: bold title, a link on the right ("View All"), its rows under it. */
export function SideFrame({
  title,
  testId,
  action,
  children,
}: {
  title: string;
  testId: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card variant="elevated" className="flex min-w-0 flex-col gap-2 p-3!" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 text-base font-bold text-heading">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** The "View All" of a side frame. */
export function SideLink({
  children,
  onClick,
  expanded,
}: {
  children: ReactNode;
  onClick: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className="shrink-0 text-xs font-medium whitespace-nowrap text-link underline hover:text-action-hover"
    >
      {children}
    </button>
  );
}
