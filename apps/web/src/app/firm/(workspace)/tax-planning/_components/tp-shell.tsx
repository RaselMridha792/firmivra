'use client';

import { ArrowLeft, ChartPieSlice, Info } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const TABS = [
  { href: '/tax-planning', label: 'Overview', match: (p: string) => p === '/tax-planning' },
  {
    href: '/tax-planning/clients',
    label: 'Clients',
    match: (p: string) => p.startsWith('/tax-planning/clients'),
  },
  {
    href: '/tax-planning/opportunities',
    label: 'Planning Opportunities',
    match: (p: string) => p.startsWith('/tax-planning/opportunities'),
  },
  {
    href: '/tax-planning/strategies',
    label: 'Strategies & Recommendations',
    match: (p: string) => p.startsWith('/tax-planning/strategies'),
  },
  {
    href: '/tax-planning/calendar',
    label: 'Tax Calendar',
    match: (p: string) => p.startsWith('/tax-planning/calendar'),
  },
  {
    href: '/tax-planning/resources',
    label: 'Resources',
    match: (p: string) => p.startsWith('/tax-planning/resources'),
  },
  {
    href: '/tax-planning/reports',
    label: 'Reports',
    match: (p: string) => p.startsWith('/tax-planning/reports'),
  },
];

/** The module's header and tabs, shared by its list pages. */
export function TpShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="tp-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/" aria-label="Home" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/" className="text-link">
          Home
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Tax Planning &amp; Strategy</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <ChartPieSlice weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              Tax Planning &amp; Strategy
            </h1>
            <p className="text-base text-muted">
              Proactive planning. Bigger opportunities. A stronger financial future.
            </p>
          </div>
        </div>
        {actions}
      </header>
      <nav
        aria-label="Tax planning views"
        role="tablist"
        className="relative flex overflow-x-auto border-b border-divider"
      >
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={t.match(path)}
            className={`-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-4 text-sm whitespace-nowrap ${t.match(path) ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

/** Shown wherever an estimate is: an estimate is never a guarantee. */
export function Disclaimer({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 text-xs text-info" data-testid="disclaimer">
      <Info aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" /> {text}
    </p>
  );
}
