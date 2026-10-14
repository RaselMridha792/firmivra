'use client';

import { Skeleton } from '@firmivra/ui';
import { CalendarDots, ChatCircleDots, FileText, type Icon, UserPlus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { RequireRole } from '../../../../components/require-role';
import { useFirm } from '../../../../components/firm-context';
import { useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';
import { todayIn } from '../calendar/_components/time';
import { IconTile } from './icon-tile';
import { KpiCards } from './kpi-cards';
import { RecentMessages, UpcomingAppointments } from './lists';
import { PipelineWidget } from './pipeline-widget';

const actions: { label: string; hint: string; href: string; icon: Icon; managers?: true }[] = [
  { label: 'Add a client', hint: 'Add a client to your firm.', href: '/clients', icon: UserPlus },
  {
    label: 'Send a message',
    hint: 'Write to a client in the portal.',
    href: '/messages',
    icon: ChatCircleDots,
  },
  {
    label: 'Create an invoice',
    hint: 'Bill a client for your services.',
    href: '/invoices',
    icon: FileText,
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
        {actions.map(({ label, hint, href, icon: Glyph, managers }) => (
          <RequireRole
            key={label}
            roles={managers ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'STAFF']}
          >
            <Link
              href={href}
              className="flex items-center gap-4 rounded-xl bg-surface p-4 shadow-md hover:bg-canvas"
            >
              <IconTile icon={Glyph} tone="blue" />
              <span className="flex flex-col">
                <span className="font-bold text-heading">{label}</span>
                <span className="text-sm text-muted">{hint}</span>
              </span>
            </Link>
          </RequireRole>
        ))}
      </section>
    </div>
  );
}
