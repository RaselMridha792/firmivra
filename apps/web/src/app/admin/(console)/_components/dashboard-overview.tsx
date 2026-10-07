'use client';

import { Card } from '@firmivra/ui';
import {
  ArrowRight,
  Building,
  ChartColumn,
  ChevronRight,
  CircleCheck,
  FileText,
  Info,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMe } from '../../../../components/signed-in';
import {
  attentionItems,
  dashboardStats,
  platformModules,
  recentApplications,
  sampleApplicationId,
  systemStatuses,
} from './dashboard-data';

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
  const iconTone =
    tone === 'teal'
      ? 'bg-accent-500/10 text-accent-600'
      : tone === 'green'
        ? 'bg-brand-50 text-success'
        : 'bg-brand-50 text-brand-700';
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-4">
        <span
          className={'flex size-12 shrink-0 items-center justify-center rounded-card ' + iconTone}
        >
          <Icon aria-hidden className="size-6" />
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
        </div>
      </div>
    </Card>
  );
}

export function DashboardOverview({ today }: { today: string }) {
  const { me } = useMe();
  const firstName = me.user.name.trim().split(/\s+/)[0] || 'there';

  return (
    <div data-testid="dashboard" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-900">Welcome back, {firstName}!</h1>
          <p className="mt-1 text-muted">Here&apos;s an overview of your Firmivra platform.</p>
        </div>
        <p data-testid="dashboard-date" className="text-sm text-muted">
          {today}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((stat) => (
          <StatCard key={stat[0]} stat={stat} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="!p-4 lg:col-span-8">
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
          <div className="hidden grid-cols-6 gap-2 bg-canvas px-3 py-3 text-xs text-muted lg:grid">
            {['Business Name', 'Owner / Contact', 'Email', 'Submitted', 'Status', 'Actions'].map(
              (label) => (
                <span key={label}>{label}</span>
              ),
            )}
          </div>
          <ul className="grid gap-3">
            {recentApplications.map(([business, contact, email, submittedAt]) => (
              <li
                key={business}
                className="grid gap-2 rounded-control border border-border p-3 text-sm lg:grid-cols-6 lg:items-center lg:gap-2 lg:rounded-none lg:border-0 lg:border-b lg:px-3 lg:py-4"
              >
                <span className="font-semibold text-text">
                  <span className="text-xs text-muted lg:hidden">Business: </span>
                  {business}
                </span>
                <span>
                  <span className="text-xs text-muted lg:hidden">Contact: </span>
                  {contact}
                </span>
                <span className="break-all">
                  <span className="text-xs text-muted lg:hidden">Email: </span>
                  {email}
                </span>
                <span>
                  <span className="text-xs text-muted lg:hidden">Submitted: </span>
                  {submittedAt}
                </span>
                <span>
                  <span className="text-xs text-muted lg:hidden">Status: </span>
                  Pending Review
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

        <Card className="!p-4 lg:col-span-4">
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
            <div className="flex items-center gap-3 rounded-control bg-canvas px-3 py-3 text-sm text-muted">
              <Settings aria-hidden className="size-5" />
              <span className="flex-1">Platform Settings</span>
              <span className="rounded-control bg-brand-100 px-2 py-1 text-xs">Soon</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card data-testid="platform-growth" className="!p-4 lg:col-span-5">
          <SectionTitle icon={ChartColumn}>Platform Growth</SectionTitle>
          <div className="flex min-h-40 items-center justify-center rounded-control border border-dashed border-border bg-canvas text-sm text-muted">
            Coming soon
          </div>
        </Card>
        <Card className="!p-4 lg:col-span-4">
          <SectionTitle icon={CircleCheck}>Tasks Requiring Attention</SectionTitle>
          <ul className="divide-y divide-border">
            {attentionItems.map(([label, count, Icon]) => (
              <li key={label} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <Icon
                  aria-hidden
                  className={'size-5 shrink-0 ' + (count > 0 ? 'text-danger' : 'text-muted')}
                />
                <span className="min-w-0 flex-1 text-sm text-text">{label}</span>
                <span className="font-semibold text-text">{count}</span>
                <ChevronRight aria-hidden className="size-4 text-muted" />
              </li>
            ))}
          </ul>
        </Card>
        <Card data-testid="system-status" className="!p-4 lg:col-span-3">
          <SectionTitle icon={Info}>System Status</SectionTitle>
          <ul className="divide-y divide-border">
            {systemStatuses.map((label) => (
              <li key={label} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
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

      <Card className="!p-4">
        <SectionTitle icon={Building}>Platform Modules</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {platformModules.map(([label, Icon]) => (
            <li key={label} className="flex items-center gap-3 rounded-control bg-canvas px-3 py-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-brand-50 text-brand-700">
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
