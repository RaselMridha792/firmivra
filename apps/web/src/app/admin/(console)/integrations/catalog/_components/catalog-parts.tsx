'use client';

import { Badge, Button, Card, Modal, Skeleton, tintTones, type TileTone } from '@firmivra/ui';
import { Warning, type Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { errorMessage } from '../../../../../../lib/errors';
import {
  CATALOG_STATUS_LABELS,
  type CatalogAuthType,
  type CatalogItem,
  type CatalogStatus,
} from '../../_components/integrations-contract';
import { INTEGRATION_ERROR_TEXTS } from '../../_components/integration-states';

/**
 * Parts the catalog list (customer-integration-catalog-dashboard.jpg) and the catalog edit page
 * share: the white summary cards that filter the list, the plan pills, the status words, the
 * blue-text outline button, the access-loss confirmation (docx §7: warn before a change removes
 * access from firms already connected) and the quiet not-found card.
 */

/** The module's error texts, with the catalog's meaning of a duplicate. */
export const catalogErrorMessage = (error: unknown) =>
  errorMessage(error, {
    ...INTEGRATION_ERROR_TEXTS,
    DUPLICATE_CONNECTION: 'The catalog already has an entry with this provider key.',
  });

/** How firms connect, in words (docx §7 Customer Setup). */
export const CATALOG_AUTH_LABELS: Record<CatalogAuthType, string> = {
  OAUTH: 'OAuth sign-in',
  API_KEY: 'API key or credentials',
  ACCOUNT_LINK: 'Account link',
  NONE: 'No sign-in needed',
};

/** "Enter … as a full address": the URL rule the API applies (https only). */
export function urlProblem(value: string, label: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return `The ${label} must start with https://.`;
    if (url.username || url.password) return `The ${label} cannot contain a user name.`;
    return null;
  } catch {
    return `Enter the ${label} as a full address (https://…).`;
  }
}

/** One summary card: a button that filters the list by its status, pressed while it does. */
export function CatalogKpi({
  icon: Glyph,
  tone,
  label,
  value,
  note,
  good,
  loading,
  pressed,
  disabled,
  onClick,
  testId,
}: {
  icon: Icon;
  tone: TileTone;
  label: string;
  value: ReactNode;
  note: ReactNode;
  /** The note in green (the design's "↑ 2 this month" and Enabled's share). */
  good?: boolean;
  loading: boolean;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-0 items-center gap-5 rounded-xl border border-border bg-surface p-5 text-left shadow-card transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:shadow-card ${pressed ? 'ring-2 ring-action' : ''}`}
    >
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-full ${tintTones[tone]}`}
      >
        <Glyph aria-hidden weight="fill" className="size-7" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-semibold text-heading">{label}</span>
        {loading ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <span
            data-testid={`${testId}-value`}
            className="text-3xl leading-none font-bold text-heading"
          >
            {value}
          </span>
        )}
        <span className={`text-sm ${good ? 'text-success' : 'text-muted'}`}>{note}</span>
      </span>
    </button>
  );
}

/** "All Plans", or one pill per plan the entry is on. */
export function PlanPills({ item }: { item: Pick<CatalogItem, 'planAccess' | 'plans'> }) {
  const names =
    item.planAccess === 'ALL_PLANS' ? ['All Plans'] : item.plans.map((plan) => plan.name);
  return (
    <ul aria-label="Plan access" className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <li
          key={name}
          className="rounded-md bg-folder-surface px-2 py-1 text-xs whitespace-nowrap text-heading"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}

/** The status words beside the switch: Enabled on soft green, the others plain. */
export function CatalogStatusWord({ status }: { status: CatalogStatus }) {
  return status === 'ENABLED' ? (
    <Badge tone="success">{CATALOG_STATUS_LABELS.ENABLED}</Badge>
  ) : (
    <span
      className={`text-sm whitespace-nowrap ${status === 'DISABLED' ? 'text-text' : 'text-heading'}`}
    >
      {CATALOG_STATUS_LABELS[status]}
    </span>
  );
}

const OUTLINE_SIZES = { md: 'min-h-11 px-4 py-2', sm: 'min-h-9 px-3 py-1.5' };
/** The designs' white button with blue text (View in Catalog, Back to Catalog). */
export function OutlineButton({
  className = '',
  type = 'button',
  size = 'md',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: keyof typeof OUTLINE_SIZES }) {
  return (
    <button
      type={type}
      className={`relative inline-flex items-center justify-center gap-2 rounded-control border border-border bg-surface text-sm font-semibold whitespace-nowrap text-action transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-surface ${OUTLINE_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

/**
 * The confirmation before a save hides the entry from firms that are connected now. `firms` is
 * the count when the page knows it (every connected firm, when the entry is disabled).
 */
export function AccessLossDialog({
  name,
  firms,
  change,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  firms: number | null;
  /** "becomes Disabled", "these changes are saved". */
  change: string;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open
      title="Remove access for connected firms?"
      subtitle={name}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? 'Saving…' : 'Save and Remove Access'}
          </Button>
        </>
      }
    >
      <div data-testid="access-loss" className="flex max-w-lg flex-col gap-4 text-sm text-text">
        <div className="flex items-start gap-3 rounded-lg bg-warning-soft p-3">
          <Warning aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-gold" />
          <p>
            {firms
              ? `${firms} connected ${firms === 1 ? 'firm loses' : 'firms lose'} access to ${name} when it ${change}.`
              : `Firms that are connected now lose access to ${name} when ${change}.`}{' '}
            They no longer see it in their catalog, and their connection stops until access is
            restored.
          </p>
        </div>
        <p className="text-muted">
          The change and the number of firms affected go to the audit log.
        </p>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** The quiet card an unknown id shows in place of the page's frames. */
export function NotFoundCard({ text }: { text: string }) {
  return (
    <Card data-testid="not-found" className="flex flex-col items-start gap-2 p-6!">
      <h2 className="text-lg font-bold text-heading">Catalog integration not found</h2>
      <p className="text-sm text-muted">{text}</p>
      <Link
        href="/integrations/catalog"
        className="text-sm font-semibold text-link hover:underline"
      >
        Back to Customer Integration Catalog
      </Link>
    </Card>
  );
}
