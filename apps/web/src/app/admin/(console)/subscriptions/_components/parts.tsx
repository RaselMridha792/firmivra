'use client';

import { Badge, Button, Callout, Modal, Skeleton } from '@firmivra/ui';
import { Info, WarningCircle } from '@phosphor-icons/react';
import { useId, type ReactNode } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  adminSubscriptions,
  errorMessage,
  STATUS_LABELS,
  SubscriptionInputError,
  type ActionResult,
  type SubscriptionDetail,
  type SubscriptionStatus,
} from './subscriptions-api';
import { loadErrorText, statusTone } from './format';

/** Every query of the page starts with this key, so one invalidation refreshes them all. */
export const KEY = 'admin-subscriptions';

/** What every action dialog gets from the page. */
export interface DialogProps {
  id: string;
  /** The firm's name, for the subtitle while the record loads. */
  firm: string;
  onClose: () => void;
  /** Closes the dialog and shows the result. */
  onDone: (message: string) => void;
}
/** A dialog's form, once the subscription is loaded. */
export interface FormProps {
  sub: SubscriptionDetail;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function StatusBadge({ status }: { status: SubscriptionStatus }) {
  return (
    <span className="whitespace-nowrap">
      <Badge tone={statusTone[status]}>{STATUS_LABELS[status]}</Badge>
    </span>
  );
}

/** Seats or usage against the allowance: a native progress bar in the token colours. */
export function UsageBar({
  percent,
  tone = 'normal',
  label,
  className = 'w-12',
}: {
  percent: number;
  tone?: 'normal' | 'trial' | 'high';
  label: string;
  className?: string;
}) {
  const fill = {
    normal: '[&::-moz-progress-bar]:bg-accent [&::-webkit-progress-value]:bg-accent',
    trial: '[&::-moz-progress-bar]:bg-gold [&::-webkit-progress-value]:bg-gold',
    high: '[&::-moz-progress-bar]:bg-danger [&::-webkit-progress-value]:bg-danger',
  }[tone];
  return (
    <progress
      max={100}
      value={Math.min(100, percent)}
      aria-label={label}
      className={`h-2 shrink-0 appearance-none overflow-hidden rounded-pill bg-disabled [&::-moz-progress-bar]:rounded-pill [&::-webkit-progress-bar]:rounded-pill [&::-webkit-progress-bar]:bg-disabled [&::-webkit-progress-value]:rounded-pill ${fill} ${className}`}
    />
  );
}

export const usageTone = (status: SubscriptionStatus, percent: number) =>
  status === 'TRIAL' ? 'trial' : percent >= 90 ? 'high' : 'normal';

/** One subscription's full record; the panel and the dialogs share the cache entry. */
export function useDetail(id: string) {
  return useApiQuery([KEY, 'detail', id], () => adminSubscriptions.subscription(id));
}

/** A change from a dialog: refreshes the KPIs, the table and the panel when it succeeds. */
export function useAct<I>(fn: (input: I) => Promise<ActionResult>) {
  return useApiMutation(fn, { invalidate: [KEY] });
}

/** A label and its value (and an optional action on the right), as in the detail panel. */
export function Fact({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5 text-sm">
      <dt className="w-32 shrink-0 text-text">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-start justify-between gap-2 text-heading">
        <span className="min-w-0">{children}</span>
        {action ? <span className="shrink-0">{action}</span> : null}
      </dd>
    </div>
  );
}

/** The small text-link actions in the panel's rows ("Manage Seats", "Update"). */
export function LinkButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-sm font-medium text-link hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
    >
      {children}
    </button>
  );
}

/** A soft box with a heading, as in the dialogs' "Current Plan" and "Current Usage". */
export function InfoBox({
  title,
  children,
  tone = 'plain',
}: {
  title?: string;
  children: ReactNode;
  tone?: 'plain' | 'info' | 'warning' | 'danger';
}) {
  const surface = {
    plain: 'border border-divider bg-surface',
    info: 'bg-info-soft',
    warning: 'bg-amber-surface',
    danger: 'bg-danger-soft',
  }[tone];
  return (
    <div className={`rounded-lg p-3 text-sm text-text ${surface}`}>
      {title ? <p className="mb-1 font-semibold text-heading">{title}</p> : null}
      {children}
    </div>
  );
}

/**
 * A dialog that needs the subscription: the kit Modal with a skeleton until the record is in,
 * then the form (its fields start from the loaded record).
 */
export function DetailDialog({
  id,
  title,
  subtitle,
  onClose,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: (sub: SubscriptionDetail) => ReactNode;
}) {
  const detail = useDetail(id);
  return (
    <Modal open title={title} subtitle={subtitle} onClose={onClose}>
      {detail.data ? (
        children(detail.data)
      ) : detail.isError ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{loadErrorText(detail.error)}</p>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div role="status" aria-label="Loading the subscription" className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      )}
    </Modal>
  );
}

/**
 * The body of an action dialog: its fields, the problem that blocks it (if any), the outcome of
 * an action that ran but failed (a declined card), the error, and Cancel with the action button.
 */
export function ActionForm({
  submitLabel,
  tone = 'primary',
  pending,
  error,
  blocked,
  outcome,
  disabled,
  onSubmit,
  onCancel,
  children,
}: {
  submitLabel: string;
  tone?: 'primary' | 'danger';
  pending: boolean;
  error: unknown;
  /** Why this action can't run for this subscription; replaces the fields. */
  blocked?: string | null;
  outcome?: string | null;
  disabled?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const formId = useId();
  const general =
    error instanceof SubscriptionInputError
      ? error.fields['form']
      : error
        ? errorMessage(error)
        : undefined;
  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && !blocked) onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      {blocked ? (
        <Callout icon={Info} surface="plain" size="compact" tone="grey">
          {blocked}
        </Callout>
      ) : (
        children
      )}
      {outcome ? (
        <Callout
          icon={WarningCircle}
          surface="warning"
          size="compact"
          tone="amber"
          title="Not completed"
        >
          <span data-testid="action-outcome">{outcome}</span>
        </Callout>
      ) : null}
      {general ? (
        <p role="alert" className="text-sm text-danger">
          {general}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {blocked || outcome ? 'Close' : 'Cancel'}
        </Button>
        {blocked ? null : (
          <Button
            type="submit"
            disabled={pending || disabled}
            className={tone === 'danger' ? 'bg-danger! hover:bg-danger/90!' : ''}
          >
            {pending ? 'Saving…' : submitLabel}
          </Button>
        )}
      </div>
    </form>
  );
}

/** "Why this can't run" for a status the action doesn't apply to. */
export const notIn = (
  sub: SubscriptionDetail,
  allowed: readonly SubscriptionStatus[],
  what: string,
): string | null =>
  allowed.includes(sub.status)
    ? null
    : `${what} isn’t possible while ${sub.firm.name} is ${STATUS_LABELS[sub.status]}.`;

/** A radio drawn as a bordered pill ("7 days", "14 days"), as in the Extend Trial design. */
export function ChoicePill({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label
      className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${checked ? 'border-action bg-info-soft font-medium text-action' : 'border-divider bg-surface text-text hover:bg-canvas'}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="size-4 shrink-0"
      />
      {children}
    </label>
  );
}

/** A group of ChoicePills with a visible legend. */
export function ChoiceGroup({
  legend,
  error,
  children,
}: {
  legend: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-text">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </fieldset>
  );
}
