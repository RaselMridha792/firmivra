'use client';

import { Card, IconButton } from '@firmivra/ui';
import { ArrowSquareOut, Check, Copy } from '@phosphor-icons/react';
import Link from 'next/link';
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Small parts of the platform integration manage page (stripe-integration-admin-dashboard.jpg):
 * the white cards with a title row, the boxed tab bar, the blue-text outline buttons, the label
 * and value rows, and the copy and open-in-new-tab buttons.
 */

/** A white card: title, an optional line under it, and the card's button on the right. */
export function Panel({
  title,
  subtitle,
  action,
  children,
  testId,
  className = '',
  flush = false,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
  /** No padding under the title row: a table runs edge to edge (Recent Activity). */
  flush?: boolean;
}) {
  return (
    <Card data-testid={testId} className={`flex min-w-0 flex-col p-0! ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-heading">{title}</h2>
          {subtitle ? <p className="text-sm text-text">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col ${flush ? 'pb-2' : 'px-5 pb-5'}`}>
        {children}
      </div>
    </Card>
  );
}

/** The design's white button with blue text (Test Connection, Reconnect, Edit). */
const OUTLINE_SIZES = {
  md: 'min-h-11 px-4 py-2',
  /** The Edit button's wider box. */
  wide: 'min-h-11 px-7 py-2',
  /** A table row's slimmer button. */
  sm: 'min-h-9 px-3 py-1.5',
};
export function OutlineButton({
  className = '',
  type = 'button',
  size = 'md',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: keyof typeof OUTLINE_SIZES }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-control border border-border bg-surface text-sm font-semibold whitespace-nowrap text-action transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-surface ${OUTLINE_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

export interface BoxTab<T extends string> {
  id: T;
  label: string;
  content: ReactNode;
}

/**
 * The manage page's tab row: separate boxes, the current one solid blue. Only the current panel
 * is mounted, so a tab's data loads when it is opened. Arrow keys, Home and End move between tabs.
 */
export function BoxTabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: BoxTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  const prefixId = useId();
  const current = items.find((item) => item.id === value) ?? items[0];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
        {items.map((item, index) => {
          const on = item.id === current?.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${prefixId}-${item.id}`}
              aria-selected={on}
              aria-controls={`${prefixId}-${item.id}-panel`}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(item.id)}
              onKeyDown={(event) => {
                const moves: Record<string, number> = {
                  ArrowRight: (index + 1) % items.length,
                  ArrowLeft: (index - 1 + items.length) % items.length,
                  Home: 0,
                  End: items.length - 1,
                };
                const next = moves[event.key];
                const target = next === undefined ? undefined : items[next];
                if (!target) return;
                event.preventDefault();
                onChange(target.id);
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[role="tab"]:nth-child(${(next ?? 0) + 1})`)
                  ?.focus();
              }}
              className={`min-h-11 rounded-lg border px-5 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                on
                  ? 'border-action bg-action text-on-action'
                  : 'border-border bg-surface text-heading hover:bg-canvas'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {current ? (
        <div
          role="tabpanel"
          id={`${prefixId}-${current.id}-panel`}
          aria-labelledby={`${prefixId}-${current.id}`}
          className="min-w-0"
        >
          {current.content}
        </div>
      ) : null}
    </div>
  );
}

/** Label and value rows, the label column on the left (Integration Details). */
export function DetailRows({
  rows,
}: {
  rows: { label: string; value: ReactNode; ruled?: boolean }[];
}) {
  return (
    <dl className="flex min-w-0 flex-col text-sm">
      {rows.map((row) => (
        <div
          key={row.label}
          className={`grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-3 sm:items-center sm:gap-3 ${row.ruled ? 'mt-1 border-t border-divider pt-3.5' : ''}`}
        >
          <dt className="text-text">{row.label}</dt>
          <dd className="min-w-0 wrap-anywhere text-heading sm:col-span-2">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Copies a value (a webhook URL, a correlation id) and says so for a moment. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={copied ? 'Copied' : label}
      tone="action"
      className="shrink-0"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    />
  );
}

/** A URL as text, with the small square that opens it in a new tab. */
export function ExternalUrl({
  href,
  label,
  linked = false,
}: {
  href: string;
  /** "provider website": names the button. */
  label: string;
  /** Draw the address itself as a link (Documentation). */
  linked?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {linked ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 wrap-anywhere text-link hover:underline"
        >
          {href}
        </a>
      ) : (
        <span className="min-w-0 wrap-anywhere">{href}</span>
      )}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open the ${label} in a new tab`}
        title={`Open the ${label} in a new tab`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-action hover:bg-folder-hover"
      >
        <ArrowSquareOut aria-hidden weight="fill" className="size-4" />
      </a>
    </span>
  );
}

/** The quiet card an unknown or removed-from-reach id shows in place of the page's frames. */
export function NotFoundCard({
  title,
  text,
  href,
  linkLabel,
}: {
  title: string;
  text: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <Card data-testid="not-found" className="flex flex-col items-start gap-2 p-6!">
      <h2 className="text-lg font-bold text-heading">{title}</h2>
      <p className="text-sm text-muted">{text}</p>
      <Link href={href} className="text-sm font-semibold text-link hover:underline">
        {linkLabel}
      </Link>
    </Card>
  );
}
