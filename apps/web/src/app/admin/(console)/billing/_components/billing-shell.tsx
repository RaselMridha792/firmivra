'use client';

import {
  ArrowCounterClockwise,
  Buildings,
  CalendarCheck,
  CaretDown,
  CaretRight,
  FileText,
  GearSix,
  Receipt,
  Ticket,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { useApiQuery } from '../../../../../lib/query';
import { adminBilling } from './billing-api';

/** The page title row every Billing page shares: breadcrumbs, title, subtitle and buttons. */

/** One breadcrumb; the last one is the current page and has no link. */
export interface Crumb {
  label: string;
  href?: string;
}

/** "Billing › Invoices › INV-0011" above a page title. */
export function BillingBreadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-muted md:text-base">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${item.href ?? 'here'}`} className="flex items-center gap-2">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-action hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="text-heading">
                  {item.label}
                </span>
              )}
              {last ? null : <CaretRight aria-hidden weight="bold" className="size-3.5" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The page's title (sans, bold, as drawn), with what sits around it. */
export function BillingHeader({
  title,
  subtitle,
  breadcrumbs,
  badge,
  meta,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  /** A status badge right after the title (Invoice Details). */
  badge?: ReactNode;
  /** A small line under the title ("Created on … | Last updated …"). */
  meta?: ReactNode;
  /** The buttons on the right; the primary one last. */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {breadcrumbs ? <BillingBreadcrumbs items={breadcrumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              data-testid="page-title"
              className="text-3xl font-bold tracking-tight text-heading md:text-4xl"
            >
              {title}
            </h1>
            {badge}
          </div>
          {subtitle ? <p className="text-base text-muted md:text-lg">{subtitle}</p> : null}
          {meta ? <p className="text-sm text-muted">{meta}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}

/** The Billing module's sections, in the design's order. Subscriptions is its own module. */
export type BillingTabId =
  | 'invoices'
  | 'recurring'
  | 'subscriptions'
  | 'estimates'
  | 'credit-notes'
  | 'payments'
  | 'settings';
export const BILLING_TABS: { id: BillingTabId; label: string; href: string; icon: Icon }[] = [
  { id: 'invoices', label: 'Invoices', href: '/billing', icon: FileText },
  { id: 'recurring', label: 'Recurring', href: '/billing/recurring', icon: ArrowCounterClockwise },
  { id: 'subscriptions', label: 'Subscriptions', href: '/subscriptions', icon: CalendarCheck },
  { id: 'estimates', label: 'Estimates', href: '/billing/estimates', icon: Ticket },
  { id: 'credit-notes', label: 'Credit Notes', href: '/billing/credit-notes', icon: Receipt },
  { id: 'payments', label: 'Payments', href: '/billing/payments', icon: Wallet },
  { id: 'settings', label: 'Settings', href: '/billing/settings', icon: GearSix },
];

/** The tab a Billing path belongs to (the console serves /billing behind /admin/billing). */
export function billingTabOf(pathname: string): BillingTabId {
  const path = pathname.replace(/^\/admin(?=\/|$)/, '') || '/';
  const section = path.split('/')[2] ?? '';
  const match = BILLING_TABS.find((tab) => tab.id === section);
  return match?.id ?? 'invoices';
}

/**
 * The Billing tab bar: links to each section's page, the current one underlined in blue.
 * `icons={false}` for the designs that draw the tabs as text only (Estimates). `compact` draws
 * smaller tabs (text-sm, tighter padding, size-4 icons) for a narrower column, so all seven
 * fit beside the Payments details panel at 1440 px.
 */
export function BillingTabs({
  active,
  icons = true,
  compact = false,
}: {
  active?: BillingTabId;
  icons?: boolean;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const current = active ?? billingTabOf(pathname);
  const size = compact ? 'gap-1.5 px-2.5 text-sm 2xl:px-3' : 'gap-2 px-3 text-base md:px-4';
  return (
    <nav aria-label="Billing sections" className="border-b border-divider">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {BILLING_TABS.map(({ id, label, href, icon: Glyph }) => {
          const on = id === current;
          return (
            <li key={id} className="shrink-0">
              <Link
                href={href}
                aria-current={on ? 'page' : undefined}
                className={`inline-flex min-h-12 items-center border-b-2 font-medium whitespace-nowrap ${size} ${on ? 'border-action text-action' : 'border-transparent text-muted hover:text-heading'}`}
              >
                {icons ? (
                  <Glyph aria-hidden weight="fill" className={compact ? 'size-4' : 'size-5'} />
                ) : null}
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// The firm picked in "All Firms", shared by the Billing pages while the console is open.
let firmFilter = '';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const readFirm = () => firmFilter;
const readNoFirm = () => '';
function setBillingFirm(firmId: string) {
  firmFilter = firmId;
  listeners.forEach((listener) => listener());
}

/** The selected firm id ('' for All Firms), kept as the user moves between Billing pages. */
export function useBillingFirm(): [string, (firmId: string) => void] {
  return [useSyncExternalStore(subscribe, readFirm, readNoFirm), setBillingFirm];
}

/** The header's "All Firms" picker (building icon, chevron); `value` '' is All Firms. */
export function FirmSelect({
  value,
  onChange,
  label = 'Firm',
  allLabel = 'All Firms',
  className = '',
}: {
  value: string;
  onChange: (firmId: string) => void;
  label?: string;
  allLabel?: string;
  className?: string;
}) {
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  return (
    <label className={`relative block min-w-0 ${className}`}>
      <span className="sr-only">{label}</span>
      <Buildings
        aria-hidden
        weight="fill"
        className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-heading"
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid="billing-firm-filter"
        className="h-12 w-full min-w-0 appearance-none truncate rounded-lg border border-divider bg-surface pr-10 pl-12 text-base text-text shadow-sm focus:outline-2 focus:outline-focus"
      >
        <option value="">{allLabel}</option>
        {(firms.data ?? []).map((firm) => (
          <option key={firm.id} value={firm.id}>
            {firm.name}
          </option>
        ))}
      </select>
      <CaretDown
        aria-hidden
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-heading"
      />
    </label>
  );
}
