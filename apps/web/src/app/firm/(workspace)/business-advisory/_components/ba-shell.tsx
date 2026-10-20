'use client';

import type { AdvisoryKpi } from '@firmivra/types';
import { KpiCard, type KpiTrend } from '@firmivra/ui';
import {
  ArrowLeft,
  CalendarDots,
  ChartLineUp,
  FileText,
  Info,
  Target,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BASE, BA_KEY } from './ba-shared';

const TABS = [
  { href: BASE, label: 'Overview', match: (p: string) => p === BASE },
  { href: `${BASE}/clients`, label: 'Advisory Clients' },
  { href: `${BASE}/plans`, label: 'Business Plans' },
  { href: `${BASE}/goals`, label: 'Goals & Milestones' },
  { href: `${BASE}/financial-analysis`, label: 'Financial Analysis' },
  { href: `${BASE}/action-plans`, label: 'Action Plans' },
  { href: `${BASE}/resources`, label: 'Resources' },
  { href: `${BASE}/reports`, label: 'Reports' },
].map((t) => ({ ...t, match: t.match ?? ((p: string) => p.startsWith(t.href)) }));

const trend = (k: AdvisoryKpi): { trend?: KpiTrend; note?: string } =>
  k.deltaPercent === null
    ? {}
    : {
        trend: {
          text: `${Math.abs(k.deltaPercent)}%`,
          direction: k.deltaPercent === 0 ? 'flat' : k.deltaPercent > 0 ? 'up' : 'down',
          good: k.deltaPercent >= 0,
        },
        ...(k.comparedTo ? { note: `vs ${k.comparedTo}` } : {}),
      };

/** The overview's four numbers, shown above the tabs on every list page of the module. */
function Kpis() {
  const q = useApiQuery([...BA_KEY, 'overview'], () => api.advisory.overview());
  const o = q.data;
  const items = [
    {
      icon: UsersThree,
      tone: 'green' as const,
      label: 'Active Advisory Clients',
      k: o?.activeClients,
      href: `${BASE}/clients`,
    },
    {
      icon: FileText,
      tone: 'blue' as const,
      label: 'Active Business Plans',
      k: o?.activePlans,
      href: `${BASE}/plans`,
    },
    {
      icon: CalendarDots,
      tone: 'purple' as const,
      label: 'Upcoming Advisory Meetings',
      k: o?.upcomingMeetings,
      href: '/calendar/list',
    },
    {
      icon: Target,
      tone: 'amber' as const,
      label: 'Growth Action Plans In Progress',
      k: o?.actionPlansInProgress,
      href: `${BASE}/action-plans`,
    },
  ];
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="ba-kpis">
      {items.map((x) => (
        <li key={x.label}>
          <Link
            href={x.href}
            className="block rounded-xl focus-visible:outline-2 focus-visible:outline-focus"
          >
            <KpiCard
              icon={x.icon}
              tone={x.tone}
              value={x.k ? String(x.k.value) : '—'}
              label={x.label}
              loading={q.isPending}
              {...(x.k ? trend(x.k) : {})}
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The module's header, numbers and tabs, shared by the overview and its list pages. */
export function BaShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="ba-page">
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
        <span className="font-semibold text-heading">Business Advisory &amp; Development</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <ChartLineUp weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              Business Advisory &amp; Development
            </h1>
            <p className="text-base text-link sm:text-lg">
              Strategic guidance. Sustainable growth. Stronger businesses.
            </p>
          </div>
        </div>
        <div aria-hidden className="hidden items-stretch gap-5 xl:flex" data-testid="ba-tagline">
          <span className="flex flex-col font-display text-base leading-tight font-bold tracking-eyebrow text-heading">
            <span>BUILD</span>
            <span>PLAN</span>
            <span>GROW</span>
            <span>SUCCEED</span>
          </span>
          <span className="w-px bg-gold" />
          <span className="flex flex-col justify-between text-xs font-semibold tracking-eyebrow text-link">
            <span>BUSINESS STRATEGY</span>
            <span>FINANCIAL CLARITY</span>
            <span>OPERATIONAL EFFICIENCY</span>
            <span>LONG-TERM SUCCESS</span>
          </span>
        </div>
      </header>
      <Kpis />
      <nav
        aria-label="Business advisory views"
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

/** Shown wherever a projection or health score is: advisory tools, never guarantees. */
export function Disclaimer({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 text-xs text-info" data-testid="disclaimer">
      <Info aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" /> {text}
    </p>
  );
}
