'use client';

import { Card } from '@firmivra/ui';
import {
  ArrowRight,
  Building,
  CalendarDays,
  ChartColumn,
  ChevronRight,
  CircleCheck,
  Database,
  FileText,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useMe } from '../../../../components/signed-in';
import {
  attentionItems,
  dashboardStats,
  growthPeriods,
  platformModules,
  recentApplications,
  sampleApplicationId,
  systemStatuses,
} from './dashboard-data';

const growthRows = [
  [26, '4'],
  [53, '3'],
  [80, '2'],
  [108, '1'],
  [136, '0'],
] as const;
const growthColumns = [30, 105, 180, 255, 330, 414];

function SectionTitle({
  icon: Icon,
  children,
  action,
}: {
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-900">
        <Icon aria-hidden className="size-5 text-brand-700" />
        {children}
      </h2>
      {action}
    </div>
  );
}

function StatCard({ stat }: { stat: (typeof dashboardStats)[number] }) {
  const [label, value, href, Icon, tone] = stat;
  const iconTone = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    purple: 'bg-violet-50 text-violet-700',
    gold: 'bg-amber-50 text-amber-700',
  }[tone];
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-6">
        <span
          className={'flex size-16 shrink-0 items-center justify-center rounded-card ' + iconTone}
        >
          <Icon aria-hidden className="size-7" />
        </span>
        <div className="min-w-0">
          <p className="text-2xl font-semibold text-brand-900">{value}</p>
          <p className="text-sm text-text">{label}</p>
          {href && (
            <Link
              href={href}
              className="mt-1 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
            >
              View {href === '/applications' ? 'Applications' : 'Firms'}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
          {!href && <span className="mt-1 block text-xs text-muted">No sample data available</span>}
        </div>
      </div>
    </Card>
  );
}

export function DashboardOverview({ today }: { today: string }) {
  const { me } = useMe();
  const [growthRange, setGrowthRange] = useState<keyof typeof growthPeriods>('month');
  const firstName = me.user.name.trim().split(/\s+/)[0] || 'there';
  const growthDates = growthPeriods[growthRange].dates.map((label, index, dates) => ({
    x: 30 + (315 * index) / (dates.length - 1),
    label,
    applications: index === dates.length - 1 ? 1 : 0,
  }));

  return (
    <div data-testid="dashboard" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-brand-900">
            Welcome back, {firstName}!
          </h1>
          <p className="mt-1 text-lg text-muted">
            Here&apos;s an overview of your Firmivra platform.
          </p>
        </div>
        <p data-testid="dashboard-date" className="flex items-center gap-3 text-sm text-muted">
          <CalendarDays aria-hidden className="size-5 text-brand-900" />
          {today}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((stat) => (
          <StatCard key={stat[0]} stat={stat} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="grid content-start gap-4 lg:col-span-8 xl:col-span-9">
          <Card className="!p-4 xl:min-h-48">
            <SectionTitle
              icon={FileText}
              action={
                <Link
                  href="/applications"
                  className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
                >
                  View All <ArrowRight aria-hidden className="size-4" />
                </Link>
              }
            >
              Recent Firm Applications
            </SectionTitle>
            <div className="hidden gap-2 bg-canvas px-3 py-3 text-xs text-muted xl:grid xl:grid-cols-[1.3fr_1fr_1.35fr_0.9fr_1fr_0.65fr]">
              {['Business Name', 'Owner / Contact', 'Email', 'Submitted', 'Status', 'Actions'].map(
                (label) => (
                  <span key={label}>{label}</span>
                ),
              )}
            </div>
            <ul className="grid gap-3">
              {recentApplications.map(([business, contact, email, submittedAt, time]) => (
                <li
                  key={business}
                  className="grid gap-2 rounded-control border border-border p-3 text-sm xl:grid-cols-[1.3fr_1fr_1.35fr_0.9fr_1fr_0.65fr] xl:items-center xl:gap-2 xl:rounded-none xl:border-0 xl:border-b xl:px-3 xl:py-4"
                >
                  <span className="font-semibold text-text">
                    <span className="text-xs text-muted xl:hidden">Business: </span>
                    {business}
                  </span>
                  <span>
                    <span className="text-xs text-muted xl:hidden">Contact: </span>
                    {contact}
                  </span>
                  <span className="break-words xl:truncate">
                    <span className="text-xs text-muted xl:hidden">Email: </span>
                    {email}
                  </span>
                  <span>
                    <span className="text-xs text-muted xl:hidden">Submitted: </span>
                    {submittedAt}
                    <span className="block text-muted">{time}</span>
                  </span>
                  <span>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                      Pending Review
                    </span>
                  </span>
                  <span>
                    <Link
                      href={'/applications/' + sampleApplicationId}
                      className="inline-flex items-center justify-center rounded-control bg-brand-900 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                    >
                      Review
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
            <Card data-testid="platform-growth" className="!p-4">
              <SectionTitle
                icon={ChartColumn}
                action={
                  <label className="relative inline-flex items-center">
                    <span className="sr-only">Growth date range</span>
                    <select
                      aria-label="Growth date range"
                      value={growthRange}
                      onChange={(event) =>
                        setGrowthRange(event.target.value as keyof typeof growthPeriods)
                      }
                      className="rounded-control border border-border bg-surface px-3 py-2 pr-8 text-xs text-muted"
                    >
                      {Object.entries(growthPeriods).map(([key, period]) => (
                        <option key={key} value={key}>
                          {period.label}
                        </option>
                      ))}
                    </select>
                  </label>
                }
              >
                Platform Growth <span className="text-sm font-normal text-muted">(Beta)</span>
              </SectionTitle>
              <svg
                role="img"
                aria-label={`Platform growth chart, ${growthPeriods[growthRange].label}, one sample application`}
                viewBox="0 0 420 160"
                className="h-40 w-full text-blue-600"
              >
                {growthRows.map(([y, label]) => (
                  <g key={y} className="fill-muted text-xs">
                    <path d={`M30 ${y}H414`} className="stroke-border" />
                    <text x="8" y={y + 4}>
                      {label}
                    </text>
                  </g>
                ))}
                {growthColumns.map((x) => (
                  <path key={x} d={`M${x} 26V136`} className="stroke-border" />
                ))}
                {growthDates.map(({ x, label }) => (
                  <text key={label} x={x - 12} y="157" className="fill-muted text-xs">
                    {label}
                  </text>
                ))}
                <path d="M30 136H345" className="stroke-current" strokeWidth="2" />
                <polyline
                  points={growthDates
                    .map(({ x, applications }) => `${x},${136 - applications * 28}`)
                    .join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                {growthDates.map(({ x, applications }) => (
                  <circle
                    key={x}
                    cx={x}
                    cy={136 - applications * 28}
                    r="4"
                    className="fill-current"
                  />
                ))}
              </svg>
              <div className="mt-4 flex justify-center gap-5 text-xs text-muted">
                <span className="flex items-center gap-1 text-blue-700">
                  <span className="size-2 rounded-full bg-blue-600" /> Applications
                </span>
                <span className="flex items-center gap-1 text-emerald-700">
                  <span className="size-2 rounded-full bg-emerald-600" /> Active Firms
                </span>
                <span className="flex items-center gap-1 text-violet-700">
                  <span className="size-2 rounded-full bg-violet-600" /> Revenue
                </span>
              </div>
            </Card>
            <Card className="!p-4">
              <SectionTitle icon={CircleCheck}>Tasks Requiring Attention</SectionTitle>
              <ul className="divide-y divide-border">
                {attentionItems.map(([label, count, Icon], index) => (
                  <li
                    key={label}
                    className="flex items-center gap-3 border-b border-border py-0.5 first:pt-0 last:border-0 last:pb-0"
                  >
                    <span
                      className={
                        'flex size-9 shrink-0 items-center justify-center rounded-control ' +
                        [
                          'bg-violet-50 text-violet-700',
                          'bg-red-50 text-red-600',
                          'bg-amber-50 text-amber-700',
                          'bg-violet-50 text-violet-700',
                          'bg-teal-50 text-teal-700',
                        ][index]
                      }
                    >
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="font-semibold text-text">{count}</span>
                    <span className="min-w-0 flex-1 text-sm text-text">{label}</span>
                    <ChevronRight aria-hidden className="size-4 text-muted" />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>

        <div className="grid content-start gap-4 lg:col-span-4 xl:col-span-3">
          <Card className="!p-4">
            <SectionTitle icon={Zap}>Quick Actions</SectionTitle>
            <div className="grid gap-2">
              <Link
                href="/applications"
                className="flex items-center gap-3 rounded-control bg-brand-50 px-3 py-3 text-sm font-medium text-brand-700 hover:bg-brand-100"
              >
                <FileText aria-hidden className="size-5" />
                <span className="flex-1">View Firm Applications</span>
                <ChevronRight aria-hidden className="size-4" />
              </Link>
              <Link
                href="/firms"
                className="flex items-center gap-3 rounded-control bg-accent-500/10 px-3 py-3 text-sm font-medium text-accent-600 hover:bg-accent-500/20"
              >
                <Building aria-hidden className="size-5" />
                <span className="flex-1">View Firms</span>
                <ChevronRight aria-hidden className="size-4" />
              </Link>
              <div className="flex items-center gap-3 rounded-control bg-violet-50 px-3 py-3 text-sm text-violet-700">
                <Settings aria-hidden className="size-5" />
                <span className="flex-1">Platform Settings</span>
                <ChevronRight aria-hidden className="size-4" />
              </div>
            </div>
          </Card>

          <Card data-testid="system-status" className="!p-4">
            <SectionTitle icon={Database}>System Status</SectionTitle>
            <ul className="divide-y divide-border">
              {systemStatuses.map((label) => (
                <li key={label} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
                  <span className="min-w-0 flex-1 text-sm text-text">{label}</span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
                    Online
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="!p-4 !pt-3">
        <SectionTitle icon={Building}>Platform Modules</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {platformModules.map(([label, Icon], index) => (
            <li key={label} className="flex items-center gap-3 rounded-control bg-canvas px-3 py-2">
              <span
                className={
                  'flex size-11 shrink-0 items-center justify-center rounded-control ' +
                  [
                    'bg-blue-50 text-blue-700',
                    'bg-cyan-50 text-cyan-700',
                    'bg-violet-50 text-violet-700',
                    'bg-pink-50 text-pink-700',
                    'bg-rose-50 text-rose-700',
                    'bg-emerald-50 text-emerald-700',
                    'bg-sky-50 text-sky-700',
                    'bg-cyan-50 text-cyan-700',
                  ][index]
                }
              >
                <Icon aria-hidden className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text">{label}</span>
                <span className="text-xs text-muted">Coming Soon</span>
              </span>
              <ChevronRight aria-hidden className="size-4 text-muted" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
