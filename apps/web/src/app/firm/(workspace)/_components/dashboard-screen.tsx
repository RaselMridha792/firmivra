'use client';

import { Skeleton } from '@firmivra/ui';
import { FilePlus2, MessageSquarePlus, UserPlus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { RequireRole } from '../../../../components/require-role';
import { useFirm } from '../../../../components/firm-context';
import { useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';
import { todayIn } from '../calendar/_components/time';
import { KpiCards } from './kpi-cards';
import { RecentMessages, UpcomingAppointments } from './lists';
import { PipelineWidget } from './pipeline-widget';

const actions: { label: string; hint: string; href: string; icon: LucideIcon; managers?: true }[] =
  [
    { label: 'Add a client', hint: 'Add a client to your firm.', href: '/clients', icon: UserPlus },
    {
      label: 'Send a message',
      hint: 'Write to a client in the portal.',
      href: '/messages',
      icon: MessageSquarePlus,
    },
    {
      label: 'Create an invoice',
      hint: 'Bill a client for your services.',
      href: '/invoices',
      icon: FilePlus2,
      managers: true,
    },
  ];

/** The firm dashboard (Octavia's "Firm dashboard"): every number and row comes from the API. */
export function DashboardScreen() {
  const { me } = useMe();
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
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
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 data-testid="page-title" className="text-3xl font-semibold text-heading">
            Welcome back, <span className="text-link">{first}</span>!
          </h1>
          <p className="text-muted">Here&apos;s what&apos;s happening with your firm today.</p>
        </div>
        {dateText ? <p className="text-sm font-medium text-text">{dateText}</p> : null}
      </div>

      {timeZone && today ? (
        <>
          <KpiCards manager={manager} timeZone={timeZone} today={today} />
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <PipelineWidget />
            <RecentMessages timeZone={timeZone} />
            <UpcomingAppointments timeZone={timeZone} today={today} />
          </div>
        </>
      ) : availability.isError ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the dashboard.{' '}
          <button type="button" className="underline" onClick={() => void availability.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <span className="sr-only">Loading…</span>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
      )}

      <section aria-label="Quick actions" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map(({ label, hint, href, icon: Icon, managers }) => (
          <RequireRole
            key={label}
            roles={managers ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'STAFF']}
          >
            <Link
              href={href}
              className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 shadow-card hover:bg-canvas"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
                <Icon aria-hidden className="size-6" />
              </span>
              <span className="flex flex-col">
                <span className="font-semibold text-heading">{label}</span>
                <span className="text-sm text-muted">{hint}</span>
              </span>
            </Link>
          </RequireRole>
        ))}
      </section>
    </div>
  );
}
