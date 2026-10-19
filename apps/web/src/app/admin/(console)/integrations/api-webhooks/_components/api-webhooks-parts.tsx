'use client';

import { Badge, Button, Callout, Modal } from '@firmivra/ui';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle,
  Clock,
  Copy,
  Prohibit,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import type {
  ApiKey,
  ApiKeyStatus,
  ApiScope,
  WebhookDirection,
  WebhookStatus,
} from '../../../../../../mocks/admin-integrations';

/**
 * Small parts of the API & Webhooks page (docx §8): the key as it may be shown (prefix and last
 * four only), status badges, scope and event pills, the slim row button, the rate-limit meter, and
 * the dialog that shows a new key or signing secret once.
 */

/** "fv_live_8k2q…Zt4P": all the page ever shows of a key after it was issued. */
export const keyText = (key: Pick<ApiKey, 'prefix' | 'lastFour'>) =>
  `${key.prefix}…${key.lastFour}`;

const KEY_LOOK: Record<
  ApiKeyStatus,
  { tone: 'success' | 'warning' | 'neutral'; label: string; icon?: Icon }
> = {
  ACTIVE: { tone: 'success', label: 'Active' },
  EXPIRED: { tone: 'warning', label: 'Expired', icon: Clock },
  REVOKED: { tone: 'neutral', label: 'Revoked', icon: Prohibit },
};
/** An API key's status: Active (dot), Expired or Revoked. */
export function ApiKeyStatusBadge({ status }: { status: ApiKeyStatus }) {
  const look = KEY_LOOK[status];
  return (
    <Badge tone={look.tone} dot={!look.icon} icon={look.icon}>
      {look.label}
    </Badge>
  );
}

/** A webhook endpoint's status: Active or Disabled. */
export function WebhookStatusBadge({ status }: { status: WebhookStatus }) {
  return status === 'ACTIVE' ? (
    <Badge tone="success" icon={CheckCircle}>
      Active
    </Badge>
  ) : (
    <Badge tone="neutral" icon={Prohibit}>
      Disabled
    </Badge>
  );
}

export const DIRECTION_LABELS: Record<WebhookDirection, string> = {
  OUTBOUND: 'Outbound',
  INBOUND: 'Inbound',
};
/** Outbound (Firmivra sends) or inbound (a provider calls Firmivra), with its arrow. */
export function DirectionText({ direction }: { direction: WebhookDirection }) {
  const Glyph = direction === 'OUTBOUND' ? ArrowUpRight : ArrowDownLeft;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-heading">
      <Glyph aria-hidden weight="bold" className="size-4 text-muted" />
      {DIRECTION_LABELS[direction]}
    </span>
  );
}

/** Codes as small pills that wrap: scopes (`integrations:read`) or event names. */
export function CodePills({ items, label }: { items: readonly string[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="rounded-md bg-folder-surface px-2 py-0.5 font-mono text-xs text-heading"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
export const ScopePills = ({ scopes }: { scopes: readonly ApiScope[] }) => (
  <CodePills items={scopes} label="Scopes" />
);

/** The slim outlined button of a table row, the same look as the dashboard's "Manage" link. */
export function RowButton({
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
      className="relative inline-flex min-h-9 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 py-1.5 text-sm font-semibold whitespace-nowrap text-action transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-surface"
    >
      {children}
    </button>
  );
}

/**
 * A bar on its track, its length a share of `max` (the peak use of a key's rate limit). SVG
 * attributes size it, so the length comes from the data without an inline style.
 */
export function Meter({ value, max, warn }: { value: number; max: number; warn: boolean }) {
  const share = max > 0 ? Math.min(100, Math.max(value > 0 ? 2 : 0, (value / max) * 100)) : 0;
  return (
    <svg aria-hidden className="block h-2 w-full">
      <rect width="100%" height="100%" rx="4" className="fill-table-head" />
      {share ? (
        <rect
          width={`${share}%`}
          height="100%"
          rx="4"
          className={warn ? 'fill-gold' : 'fill-chart-blue'}
        />
      ) : null}
    </svg>
  );
}

/**
 * A new API key or signing secret, shown once (docx §8): the full value, a copy button and the
 * warning that it cannot be shown again. The value lives only in this dialog's props; closing the
 * dialog drops it, and the page keeps only the masked hint.
 */
export function SecretOnceDialog({
  title,
  subtitle,
  label,
  secret,
  children,
  onClose,
}: {
  title: string;
  subtitle: string;
  /** "API key" or "Signing secret". */
  label: string;
  secret: string;
  /** What to do with it, under the warning. */
  children: ReactNode;
  onClose: () => void;
}) {
  const labelId = useId();
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  function copy() {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) {
      setCopied('failed');
      return;
    }
    clipboard.writeText(secret).then(
      () => setCopied('done'),
      () => setCopied('failed'),
    );
  }
  return (
    <Modal
      open
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex max-w-xl flex-col gap-4">
        <Callout
          size="compact"
          surface="warning"
          tone="amber"
          icon={Warning}
          title="Copy it now. This is the only time it is shown."
        >
          {children}
        </Callout>
        <div className="flex flex-col gap-1">
          <span id={labelId} className="text-sm font-medium text-text">
            {label}
          </span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              aria-labelledby={labelId}
              data-testid="secret-once"
              className="min-w-0 flex-1 rounded-control border border-border bg-canvas px-3 py-2 font-mono text-sm break-all text-heading select-all"
            >
              {secret}
            </code>
            <Button variant="secondary" onClick={copy}>
              <Copy aria-hidden weight="fill" className="size-4" />
              {copied === 'done' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p aria-live="polite" className="min-h-5 text-xs text-muted">
            {copied === 'done'
              ? 'Copied to the clipboard.'
              : copied === 'failed'
                ? "Couldn't copy it here. Select the text and copy it yourself."
                : ''}
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** A line of facts under a title in a list item: "Attempt 2 · 200 · 240 ms". */
export function Facts({ items }: { items: (string | null | false)[] }) {
  const shown = [...new Set(items.filter((item): item is string => !!item))];
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
      {shown.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </p>
  );
}
