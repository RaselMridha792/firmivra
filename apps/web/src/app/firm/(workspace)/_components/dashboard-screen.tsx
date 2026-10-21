'use client';

import { Skeleton } from '@firmivra/ui';
import {
  CalendarDots,
  ChatCircleDots,
  CurrencyDollar,
  type Icon,
  PaperPlaneTilt,
  UploadSimple,
  UserPlus,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { RequireRole } from '../../../../components/require-role';
import { useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';
import { todayIn } from '../calendar/_components/time';
import { RevenueOverview, ServiceBreakdown } from './charts';
import { IconTile } from './icon-tile';
import { KpiCards } from './kpi-cards';
import { RecentMessages, TasksDue, UpcomingAppointments } from './lists';
import { PipelineWidget } from './pipeline-widget';

const actions: {
  title: string;
  hint: string;
  button: string;
  href: string;
  icon: Icon;
  managers?: true;
  outline?: true;
}[] = [
  {
    title: 'Add a New Client',
    hint: 'Manually add a client to your database.',
    button: 'Add Client',
    href: '/clients',
    icon: UserPlus,
  },
  {
    title: 'Send a Message',
    hint: 'Send a portal message to a client.',
    button: 'Send Message',
    href: '/messages',
    icon: ChatCircleDots,
  },
  {
    title: 'Create a Bulk Email',
    hint: 'Send updates to multiple clients at once.',
    button: 'Go to Communications',
    href: '/communications',
    icon: PaperPlaneTilt,
  },
  {
    title: 'Generate an Invoice',
    hint: 'Create and send an invoice in seconds.',
    button: 'Create Invoice',
    href: '/invoices',
    icon: CurrencyDollar,
    managers: true,
  },
  {
    title: 'Upload Documents',
    hint: 'Upload and organize client documents securely.',
    button: 'Upload Now',
    href: '/documents',
    icon: UploadSimple,
    outline: true,
  },
];

/** The firm dashboard (Octavia's "Firm dashboard"): every number and row comes from the API. */
export function DashboardScreen() {
  const { me } = useMe();
  const summary = useApiQuery(['dashboard', 'summary'], () => api.dashboard.summary());
  // The firm's time zone: every role may read it, and "today" is the firm's today.
  const availability = useApiQuery(['availability'], () => api.availability.get());
  const timeZone = availability.data?.timezone;
  const today = timeZone ? todayIn(timeZone) : null;
  const [now] = useState(() => new Date());
  const first = me.user.name.trim().split(/\s+/)[0] ?? '';
  const dateText =
    timeZone && new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full' }).format(now);

  return (
    <div className="flex flex-col gap-6" data-testid="firm-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 data-testid="page-title" className="text-4xl font-extrabold text-heading">
            Welcome back, <span className="text-gold">{first}!</span>
          </h1>
          <p className="mt-1 text-lg text-muted">
            Here&apos;s what&apos;s happening with your firm today.
          </p>
        </div>
        {dateText ? (
          <div className="flex items-center gap-3 md:border-l md:border-border md:pl-6">
            <span className="flex size-12 items-center justify-center rounded-control border-2 border-heading text-heading">
              <CalendarDots aria-hidden weight="fill" className="size-7" />
            </span>
            <p className="text-lg font-medium text-heading">{dateText}</p>
          </div>
        ) : null}
      </div>

      <KpiCards summary={summary} />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <PipelineWidget summary={summary} />
        <RevenueOverview summary={summary} />
        <ServiceBreakdown summary={summary} />
        {timeZone && today ? (
          <>
            <RecentMessages timeZone={timeZone} today={today} />
            <TasksDue summary={summary} />
            <UpcomingAppointments timeZone={timeZone} today={today} />
          </>
        ) : availability.isError ? (
          <p role="alert" className="text-danger">
            We couldn&apos;t load messages and appointments.{' '}
            <button type="button" className="underline" onClick={() => void availability.refetch()}>
              Try again
            </button>
          </p>
        ) : (
          <div aria-busy="true" className="contents">
            <span className="sr-only">Loading…</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))}
          </div>
        )}
      </div>

      <section aria-label="Quick actions" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {actions.map(({ title, hint, button, href, icon: Glyph, managers, outline }) => (
          <RequireRole
            key={title}
            roles={managers ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'STAFF']}
          >
            <div
              data-testid="quick-action"
              className="flex h-full flex-col gap-3 rounded-xl bg-surface p-4 shadow-md"
            >
              <div className="flex gap-3">
                <IconTile icon={Glyph} tone="blue" small />
                <div className="min-w-0">
                  <h2 className="font-bold text-heading">{title}</h2>
                  <p className="text-sm text-muted">{hint}</p>
                </div>
              </div>
              <Link
                href={href}
                className={`mt-auto inline-flex min-h-10 items-center justify-center rounded-control px-3 text-center text-sm font-semibold ${outline ? 'border border-action text-action hover:bg-folder-surface' : 'bg-action text-on-action hover:bg-action-hover'}`}
              >
                {button}
              </Link>
            </div>
          </RequireRole>
        ))}
      </section>
    </div>
  );
}
