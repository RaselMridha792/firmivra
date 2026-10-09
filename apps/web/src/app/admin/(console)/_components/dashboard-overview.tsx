'use client';

import type {
  AdminDashboard,
  FirmApplicationListItem,
  ListFirmApplicationsResponse,
} from '@firmivra/types';
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
import { useSyncExternalStore, type ReactNode } from 'react';
import { PageState } from '../../../../components/page-state';
import { useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';
import { mocked } from '../../../../lib/mock';
import { useApiQuery } from '../../../../lib/query';
import { attentionItems, dashboardStats, platformModules, systemStatuses } from './dashboard-data';

const subscribeToNothing = () => () => {};
const localDateLabel = () =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
const serverDateLabel = () => '';

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
    green: 'bg-success/10 text-success',
    purple: 'bg-brand-50 text-brand-700',
    gold: 'bg-warning-soft text-warning',
  }[stat.tone];
  const formattedValue =
    stat.key === 'monthlyRevenueCents'
      ? value === null
        ? 'Not available yet'
        : (value / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      : value === null
        ? 'Not available yet'
        : value.toLocaleString('en-US');

  return (
    <Card data-testid={stat.testId} className="!p-4">
      <div className="flex items-center gap-6">
        <span
          className={'flex size-16 shrink-0 items-center justify-center rounded-card ' + iconTone}
        >
          <Icon aria-hidden className="size-7" />
        </span>
        <div className="min-w-0">
          <p
            data-testid={`${stat.testId}-value`}
            className={
              value === null
                ? 'text-sm font-medium text-muted'
                : 'text-2xl font-semibold text-brand-900'
            }
          >
            {formattedValue}
          </p>
          <p className="text-sm text-text">{stat.label}</p>
          {stat.href ? (
            <Link
              href={stat.href}
              className="mt-1 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
            >
              View {stat.href === '/applications' ? 'Applications' : 'Firms'}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : null}
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

function statusPresentation(status: FirmApplicationListItem['status']) {
  const label = status
    .toLowerCase()
    .split('_')
    .map((part: string) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
  const tone =
    status === 'APPROVED'
      ? 'bg-success/10 text-success'
      : status === 'DECLINED'
        ? 'bg-danger/10 text-danger'
        : 'bg-accent-500/10 text-accent-600';
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
      className="grid gap-2 rounded-control border border-border p-3 text-sm xl:grid-cols-[1.3fr_1fr_1.35fr_0.9fr_1fr_0.65fr] xl:items-center xl:gap-2 xl:rounded-none xl:border-0 xl:border-b xl:px-3 xl:py-4"
    >
      <span className="font-semibold text-text">
        <span className="text-xs text-muted xl:hidden">Business: </span>
        {application.legalName}
      </span>
      <span>
        <span className="text-xs text-muted xl:hidden">Contact: </span>
        {application.contactName}
      </span>
      <span className="break-words xl:truncate">
        <span className="text-xs text-muted xl:hidden">Email: </span>
        {application.contactEmail}
      </span>
      <time dateTime={application.submittedAt}>
        <span className="text-xs text-muted xl:hidden">Submitted: </span>
        {submittedDate}
        <span className="block text-muted">{submittedTime}</span>
      </time>
      <span>
        <span className={'rounded-full px-2 py-1 text-xs font-medium ' + status.tone}>
          {status.label}
        </span>
      </span>
      <span>
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
        <p data-testid="dashboard-date" className="flex items-center gap-3 text-sm text-muted">
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
            <PageState<ListFirmApplicationsResponse>
              query={recent}
              empty="No applications yet"
              isEmpty={(result) => result.items.length === 0}
            >
              {(result) => (
                <ul aria-label="Recent applications" className="grid gap-3">
                  {result.items.map((application) => (
                    <RecentApplication key={application.id} application={application} />
                  ))}
                </ul>
              )}
            </PageState>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
            <Card data-testid="platform-growth" className="!p-4 min-h-70">
              <SectionTitle icon={ChartColumn}>
                Platform Growth <span className="text-sm font-normal text-muted">(Beta)</span>
              </SectionTitle>
              <p className="flex min-h-40 items-center justify-center text-sm text-muted">
                Coming soon
              </p>
            </Card>
            <Card className="!p-4">
              <SectionTitle icon={CircleCheck}>Tasks Requiring Attention</SectionTitle>
              <ul className="divide-y divide-border">
                {attentionItems.map(({ label, key, icon: Icon, href }, index) => {
                  const count = key && dashboard.data ? (dashboard.data[key] ?? '—') : '—';
                  const canOpen = href && typeof count === 'number' && count > 0;
                  return (
                    <li
                      key={label}
                      className="flex items-center gap-3 border-b border-border py-0.5 first:pt-0 last:border-0 last:pb-0"
                    >
                      <span
                        className={
                          'flex size-9 shrink-0 items-center justify-center rounded-control ' +
                          [
                            'bg-brand-50 text-brand-700',
                            'bg-danger/10 text-danger',
                            'bg-accent-500/10 text-accent-600',
                            'bg-brand-100 text-brand-900',
                            'bg-success/10 text-success',
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
                        <span className="min-w-0 flex-1 text-sm text-text">{label}</span>
                      )}
                    </li>
                  );
                })}
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
              <button
                type="button"
                disabled
                className="flex cursor-not-allowed items-center gap-3 rounded-control bg-accent-500/10 px-3 py-3 text-left text-sm text-accent-600"
              >
                <Settings aria-hidden className="size-5" />
                <span className="flex-1">Platform Settings</span>
                <ChevronRight aria-hidden className="size-4" />
              </button>
            </div>
          </Card>

          <Card data-testid="system-status" className="!p-4">
            <SectionTitle icon={Database}>System Status</SectionTitle>
            <ul className="divide-y divide-border">
              {systemStatuses.map((label) => (
                <li key={label} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span
                    aria-hidden
                    className={
                      'size-2 shrink-0 rounded-full ' + (isMockMode ? 'bg-success' : 'bg-muted')
                    }
                  />
                  <span className="min-w-0 flex-1 text-sm text-text">{label}</span>
                  <span
                    className={
                      'flex items-center gap-1.5 text-xs font-semibold ' +
                      (isMockMode ? 'text-success' : 'text-muted')
                    }
                  >
                    {isMockMode ? 'Online' : 'Not checked yet'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-0.5 !p-4 !pt-3">
        <SectionTitle icon={Building}>Platform Modules</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {platformModules.map(([label, Icon], index) => (
            <li key={label} className="flex items-center gap-3 rounded-control bg-canvas px-3 py-2">
              <span
                className={
                  'flex size-11 shrink-0 items-center justify-center rounded-control ' +
                  [
                    'bg-brand-50 text-brand-700',
                    'bg-accent-500/10 text-accent-600',
                    'bg-brand-100 text-brand-900',
                    'bg-danger/10 text-danger',
                    'bg-danger/10 text-danger',
                    'bg-success/10 text-success',
                    'bg-brand-50 text-brand-700',
                    'bg-accent-500/10 text-accent-600',
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
