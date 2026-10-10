'use client';

import type {
  AdminDashboard,
  FirmApplicationListItem,
  ListFirmApplicationsResponse,
} from '@firmivra/types';
import { Card } from '@firmivra/ui';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Database,
  FileText,
  Info,
  LayoutGrid,
  Settings,
  SquareCheckBig,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { PageState } from '../../../../components/page-state';
import { useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';
import { mocked } from '../../../../lib/mock';
import { useApiQuery } from '../../../../lib/query';
import { attentionItems, dashboardStats, platformModules, systemStatuses } from './dashboard-data';
import { EmailText } from './list-parts';
import { PlatformGrowth } from './platform-growth';
import { SectionTitle } from './section-title';

const subscribeToNothing = () => () => {};
const localDateLabel = () =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
const serverDateLabel = () => '';

function StatCard({
  stat,
  value,
}: {
  stat: (typeof dashboardStats)[number];
  value: number | null;
}) {
  const Icon = stat.icon;
  const iconTone = {
    blue: 'bg-brand-50 text-brand-700',
    green: 'bg-success-soft text-success',
    purple: 'bg-purple-soft text-purple',
    gold: 'bg-warning-soft text-warning',
  }[stat.tone];
  // A figure the API cannot give yet (users, revenue) shows a dash, never a made-up zero.
  const formattedValue =
    value === null
      ? '—'
      : stat.key === 'monthlyRevenueCents'
        ? (value / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        : value.toLocaleString('en-US');
  const linkClass = 'mt-1 inline-flex items-center gap-1 whitespace-nowrap text-sm text-brand-700';

  return (
    // Four cards share a row from xl; until 2xl a smaller icon keeps "View Applications" on one line.
    <Card variant="elevated" data-testid={stat.testId} className="!p-4 xl:!p-3 2xl:!p-4">
      <div className="flex items-center gap-4 xl:gap-3 2xl:gap-4">
        <span
          className={
            'flex size-16 shrink-0 xl:size-12 2xl:size-16 items-center justify-center rounded-card ' +
            iconTone
          }
        >
          <Icon aria-hidden className="size-7" />
        </span>
        <div className="min-w-0">
          <p
            data-testid={`${stat.testId}-value`}
            title={value === null ? 'Not available yet' : undefined}
            className="text-3xl font-semibold text-brand-900"
          >
            {value === null ? <span aria-hidden>{formattedValue}</span> : formattedValue}
            {value === null ? <span className="sr-only"> Not available yet</span> : null}
          </p>
          <p className="flex items-center gap-1 text-base text-text">
            {stat.label}
            {stat.key === 'monthlyRevenueCents' ? (
              <span title="Revenue billed this month" className="inline-flex">
                <Info aria-hidden className="size-4 text-muted" />
                <span className="sr-only">(Revenue billed this month)</span>
              </span>
            ) : null}
          </p>
          {stat.href ? (
            <Link href={stat.href} className={`${linkClass} hover:underline`}>
              {stat.linkLabel}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : (
            // Users and Billing pages come after the first release (Soon in the menu).
            <span title="Coming soon" className={linkClass}>
              {stat.linkLabel}
              <ArrowRight aria-hidden className="size-4" />
              <span className="sr-only"> (coming soon)</span>
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function localSubmissionLabel(value: string) {
  const date = new Date(value);
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${dateLabel}\n${timeLabel}`;
}

/** The recent applications' columns from xl: spans of a 20-column grid, near the mockup's widths. */
// Spans of 20. Below 2xl the email sits under the contact's name, so the pill and button fit.
const COLUMNS = [
  'xl:col-span-5 2xl:col-span-4',
  'xl:col-span-5 2xl:col-span-3',
  'xl:hidden 2xl:block 2xl:col-span-5',
  'xl:col-span-3',
  'xl:col-span-4 2xl:col-span-3',
  'xl:col-span-3 2xl:col-span-2',
] as const;

function statusPresentation(status: FirmApplicationListItem['status']) {
  const label = status
    .toLowerCase()
    .split('_')
    .map((part: string) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
  const tone =
    status === 'APPROVED'
      ? 'bg-success-soft text-success'
      : status === 'DECLINED'
        ? 'bg-danger-soft text-danger'
        : 'bg-warning-soft text-warning';
  return { label, tone };
}

function RecentApplication({ application }: { application: FirmApplicationListItem }) {
  const submission = useSyncExternalStore(
    subscribeToNothing,
    () => localSubmissionLabel(application.submittedAt),
    serverDateLabel,
  );
  const [submittedDate = '', submittedTime = ''] = submission.split('\n');
  const status = statusPresentation(application.status);

  return (
    <li
      data-testid="recent-application"
      className="grid gap-2 rounded-control border border-border p-3 text-sm xl:grid-cols-20 xl:items-center xl:gap-2 xl:rounded-none xl:border-0 xl:border-b xl:px-4 xl:py-4 xl:last:border-b-0"
    >
      <span className={`font-semibold text-text ${COLUMNS[0]}`}>
        <span className="text-xs text-muted xl:hidden">Business: </span>
        {application.legalName}
      </span>
      <span className={COLUMNS[1]}>
        <span className="text-xs text-muted xl:hidden">Contact: </span>
        {application.contactName}
        <span className="hidden text-muted wrap-anywhere xl:block 2xl:hidden">
          <EmailText value={application.contactEmail} />
        </span>
      </span>
      <span className={`wrap-anywhere ${COLUMNS[2]}`}>
        <span className="text-xs text-muted xl:hidden">Email: </span>
        <EmailText value={application.contactEmail} />
      </span>
      <time dateTime={application.submittedAt} className={COLUMNS[3]}>
        <span className="text-xs text-muted xl:hidden">Submitted: </span>
        {submittedDate}
        <span className="block text-muted">{submittedTime}</span>
      </time>
      <span className={COLUMNS[4]}>
        <span
          className={'whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ' + status.tone}
        >
          {status.label}
        </span>
      </span>
      <span className={COLUMNS[5]}>
        <Link
          href={`/applications/${application.id}`}
          className="inline-flex items-center justify-center rounded-control bg-brand-900 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Review
        </Link>
      </span>
    </li>
  );
}

type Health = 'online' | 'degraded' | 'offline' | 'checking' | 'unknown';
const HEALTH: Record<Health, { label: string; dot: string; text: string }> = {
  online: { label: 'Online', dot: 'bg-success', text: 'text-success' },
  degraded: { label: 'Degraded', dot: 'bg-warning', text: 'text-warning' },
  offline: { label: 'Offline', dot: 'bg-danger', text: 'text-danger' },
  checking: { label: 'Checking…', dot: 'bg-muted', text: 'text-muted' },
  unknown: { label: 'Not checked yet', dot: 'bg-muted', text: 'text-muted' },
};

/**
 * The API's health check answers for the platform (the API itself) and its database. File
 * storage, email and the client portals have no check yet, so they say so instead of guessing.
 */
function healthOf(
  label: string,
  check: { data?: { status: 'ok' | 'degraded'; db: 'ok' | 'down' } | null; isError: boolean },
  mock: boolean,
): Health {
  if (mock) return 'online';
  if (label !== 'Platform' && label !== 'Database') return 'unknown';
  if (check.isError) return 'offline';
  if (!check.data) return 'checking';
  if (label === 'Database') return check.data.db === 'ok' ? 'online' : 'offline';
  return check.data.status === 'ok' ? 'online' : 'degraded';
}

export function DashboardOverview() {
  const { me } = useMe();
  const today = useSyncExternalStore(subscribeToNothing, localDateLabel, serverDateLabel);
  const dashboard = useApiQuery(['firm-applications', 'dashboard'], () =>
    api.firmApplications.dashboard(),
  );
  const recent = useApiQuery(['firm-applications', 'recent'], () =>
    api.firmApplications.list({ pageSize: 5 }),
  );
  const firstName = me.user.name.trim().split(/\s+/)[0] || 'there';
  const isMockMode = mocked('firmApplications');
  // Mock mode has no API behind it: the statuses show the mockup's Online.
  const health = useApiQuery(['health'], () => (isMockMode ? Promise.resolve(null) : api.health()));

  return (
    <div data-testid="dashboard" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-900">
            Welcome back, {firstName}!
          </h1>
          <p className="mt-1 text-lg text-muted">
            Here&apos;s an overview of your Firmivra platform.
          </p>
        </div>
        <p data-testid="dashboard-date" className="flex items-center gap-3 text-base text-text">
          <CalendarDays aria-hidden className="size-5 text-brand-900" />
          {today}
        </p>
      </div>

      <PageState<AdminDashboard> query={dashboard}>
        {(data) => (
          <div className="grid min-h-30 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {dashboardStats.map((stat) => (
              <StatCard key={stat.key} stat={stat} value={data[stat.key]} />
            ))}
          </div>
        )}
      </PageState>

      <div className="mt-1 grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="grid content-start gap-4 lg:col-span-8 xl:col-span-9">
          <Card variant="elevated" className="!p-4 xl:min-h-48">
            <SectionTitle
              icon={FileText}
              action={
                <Link
                  href="/applications"
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm text-brand-700 hover:underline"
                >
                  View All <ArrowRight aria-hidden className="size-4" />
                </Link>
              }
            >
              Recent Firm Applications
            </SectionTitle>
            <div className="xl:overflow-hidden xl:rounded-card xl:border xl:border-border">
              <div className="hidden gap-2 bg-subtle px-4 py-3 text-sm font-medium text-text xl:grid xl:grid-cols-20">
                {[
                  'Business Name',
                  'Owner / Contact',
                  'Email',
                  'Submitted',
                  'Status',
                  'Actions',
                ].map((label, index) => (
                  <span key={label} className={`whitespace-nowrap ${COLUMNS[index]}`}>
                    {label}
                  </span>
                ))}
              </div>
              <PageState<ListFirmApplicationsResponse>
                query={recent}
                empty="No applications yet"
                isEmpty={(result) => result.items.length === 0}
              >
                {(result) => (
                  <ul aria-label="Recent applications" className="grid gap-3 xl:gap-0">
                    {result.items.map((application) => (
                      <RecentApplication key={application.id} application={application} />
                    ))}
                  </ul>
                )}
              </PageState>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-13">
            <Card variant="elevated" data-testid="platform-growth" className="!p-4 xl:col-span-7">
              <PlatformGrowth />
            </Card>
            <Card variant="elevated" className="!p-4 xl:col-span-6">
              <SectionTitle icon={SquareCheckBig} iconClassName="text-purple">
                Tasks Requiring Attention
              </SectionTitle>
              <ul className="divide-y divide-border">
                {attentionItems.map(({ label, key, icon: Icon, href }, index) => {
                  // Payments, support and renewals have nothing to count yet, and an unknown count shows 0.
                  const count = key && dashboard.data ? (dashboard.data[key] ?? 0) : 0;
                  const canOpen = href && count > 0;
                  return (
                    <li
                      key={label}
                      className="flex min-h-11 items-center gap-3 border-b border-border py-1 first:pt-0 last:border-0 last:pb-0"
                    >
                      <span
                        className={
                          'flex size-9 shrink-0 items-center justify-center rounded-control ' +
                          [
                            'bg-purple-soft text-purple',
                            'bg-danger-soft text-danger',
                            'bg-warning-soft text-warning',
                            'bg-purple-soft text-purple',
                            'bg-accent-soft text-accent',
                          ][index]
                        }
                      >
                        <Icon aria-hidden className="size-5" />
                      </span>
                      <span className="font-semibold text-text">{count}</span>
                      {canOpen ? (
                        <Link
                          href={href}
                          aria-label={`Open ${label}`}
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-sm text-text hover:text-brand-700"
                        >
                          {label}
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                        </Link>
                      ) : (
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-2 text-sm text-text">
                          {label}
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        </div>

        <div className="grid content-start gap-4 lg:col-span-4 xl:col-span-3">
          <Card variant="elevated" className="!p-4">
            <SectionTitle icon={Zap} iconClassName="text-warning">
              Quick Actions
            </SectionTitle>
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
                className="flex items-center gap-3 rounded-control bg-success-soft px-3 py-3 text-sm font-medium text-success hover:bg-success-soft/80"
              >
                <Building2 aria-hidden className="size-5" />
                <span className="flex-1">View Firms</span>
                <ChevronRight aria-hidden className="size-4" />
              </Link>
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-3 rounded-control bg-purple-soft px-3 py-3 text-left text-sm font-medium text-purple"
              >
                <Settings aria-hidden className="size-5" />
                <span className="flex-1">Platform Settings</span>
                <ChevronRight aria-hidden className="size-4" />
              </button>
            </div>
          </Card>

          <Card variant="elevated" data-testid="system-status" className="!p-4">
            <SectionTitle icon={Database}>System Status</SectionTitle>
            <ul className="divide-y divide-border">
              {systemStatuses.map((label) => {
                const state = HEALTH[healthOf(label, health, isMockMode)];
                return (
                  <li key={label} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span aria-hidden className={`size-3 shrink-0 rounded-full ${state.dot}`} />
                    <span className="min-w-0 flex-1 text-sm text-text">{label}</span>
                    <span
                      className={`flex items-center gap-1.5 text-sm font-semibold ${state.text}`}
                    >
                      {state.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <Card variant="elevated" className="mt-0.5 !p-4 !pt-3">
        <SectionTitle icon={LayoutGrid} iconClassName="text-brand-900">
          Platform Modules
        </SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {platformModules.map(([label, Icon], index) => (
            <li
              key={label}
              className="flex items-center gap-4 overflow-hidden rounded-control bg-canvas pr-3"
            >
              <span
                className={
                  'flex size-15 shrink-0 items-center justify-center rounded-control ' +
                  [
                    'bg-info-soft text-info',
                    'bg-info-soft text-info',
                    'bg-purple-soft text-purple',
                    'bg-danger-soft text-danger',
                    'bg-danger-soft text-danger',
                    'bg-success-soft text-success',
                    'bg-info-soft text-info',
                    'bg-info-soft text-info',
                  ][index]
                }
              >
                <Icon aria-hidden className="size-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text">{label}</span>
                <span className="text-sm text-muted">Coming Soon</span>
              </span>
              <ChevronRight aria-hidden className="size-4 text-muted" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
