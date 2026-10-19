'use client';

import { CalendarBlank, CaretDown, type Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useSyncExternalStore, type ReactNode } from 'react';
import type { BillingEstimate } from '../../../../../../mocks/admin-billing';

/** Small parts the Estimates pages share: layout switch, formats, rules, buttons, filters. */

/** The width where the design's details panel sits beside the list (1440 px). */
const WIDE = '(min-width: 90rem)';
const subscribeWide = (listener: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
/** True at 1440 px and up: the details panel is a column; below it, the kit's Drawer. */
export function useWideLayout(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/** "10/10/2026 11:20 AM" from an ISO time, in the platform time zone (Created On). */
export function formatStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((row) => row.type === type)?.value ?? '';
  return `${part('month')}/${part('day')}/${part('year')} ${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
}

/** The fields the estimate actions need. */
export type EstimateRef = Pick<
  BillingEstimate,
  'id' | 'number' | 'status' | 'clientName' | 'convertedInvoiceId' | 'convertedInvoiceNumber'
>;

/** What an estimate allows in its status (docx §10; the mock refuses the rest anyway). */
export function estimateAbilities(estimate: EstimateRef) {
  const converted = estimate.status === 'CONVERTED' || estimate.convertedInvoiceId !== null;
  const { status } = estimate;
  return {
    converted,
    edit: !converted,
    send: !converted && status !== 'DECLINED',
    approve: !converted && status !== 'DRAFT' && status !== 'APPROVED',
    decline: !converted && status !== 'DRAFT' && status !== 'DECLINED',
    convert: !converted && (status === 'SENT' || status === 'PENDING' || status === 'APPROVED'),
    remove: !converted,
  };
}

/** Why a panel button is off, for its tooltip. */
export function convertBlockedReason(estimate: EstimateRef): string {
  if (estimate.status === 'DRAFT') return 'Send the estimate before converting it.';
  if (estimate.status === 'DECLINED') return 'A declined estimate cannot be converted.';
  if (estimate.status === 'EXPIRED') return 'This estimate has expired. Resend it first.';
  return 'This estimate cannot be converted.';
}

/** The success line after a save on Create or Edit Estimate (`?saved=`). */
export const SAVED_NOTICES: Record<string, string> = {
  draft: 'Estimate saved as a draft.',
  saved: 'Estimate saved.',
  sent: 'Estimate saved and emailed to the client.',
  marked: 'Estimate saved and marked as sent.',
  updated: 'Estimate changes saved.',
};

const BUTTON_TONES = {
  primary: 'border-action bg-action text-on-action hover:bg-action-hover',
  outline: 'border-action bg-surface text-action hover:bg-accent-soft',
  danger: 'border-danger bg-surface text-danger hover:bg-danger-soft',
} as const;

/** A full-width panel button (Estimate Details): a link when `href`, else a button. */
export function PanelButton({
  icon: Glyph,
  tone = 'outline',
  href,
  onClick,
  disabled,
  title,
  testId,
  children,
}: {
  icon: Icon;
  tone?: keyof typeof BUTTON_TONES;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Why it is off. */
  title?: string;
  testId?: string;
  children: ReactNode;
}) {
  const className = `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:border-border disabled:bg-surface disabled:text-disabled-text ${BUTTON_TONES[tone]}`;
  const content = (
    <>
      <Glyph aria-hidden weight="fill" className="size-5 shrink-0" />
      {children}
    </>
  );
  if (href && !disabled)
    return (
      <Link href={href} data-testid={testId} className={className}>
        {content}
      </Link>
    );
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      title={disabled ? title : undefined}
      onClick={onClick}
      className={className}
    >
      {content}
    </button>
  );
}

/** A filter-row select (no visible label, as drawn) with the thin chevron. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  testId?: string;
}) {
  return (
    <label className="relative block min-w-0 flex-1 basis-36 sm:flex-none sm:basis-34">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 appearance-none truncate rounded-lg border border-divider bg-surface pr-9 pl-3 text-sm text-heading focus:outline-2 focus:outline-focus"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CaretDown
        aria-hidden
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-heading"
      />
    </label>
  );
}

/**
 * "Start Date" / "End Date": a date box with the calendar on the left and its name inside while
 * empty, as drawn. A click opens the browser's calendar.
 */
export function DateBox({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <label className="relative block min-w-0 flex-1 basis-36 sm:flex-none sm:basis-44">
      <span className="sr-only">{label}</span>
      <CalendarBlank
        aria-hidden
        weight="fill"
        className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-heading"
      />
      <input
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => event.currentTarget.showPicker?.()}
        className={`peer h-10 w-full min-w-0 rounded-lg border border-divider bg-surface pr-3 pl-10 text-sm focus:outline-2 focus:outline-focus [&::-webkit-calendar-picker-indicator]:hidden ${value ? 'text-heading' : 'text-transparent focus:text-heading'}`}
      />
      {value ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-10 -translate-y-1/2 text-sm text-heading peer-focus:hidden"
        >
          {label}
        </span>
      )}
    </label>
  );
}
