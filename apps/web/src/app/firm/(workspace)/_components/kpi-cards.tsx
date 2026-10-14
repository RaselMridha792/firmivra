'use client';

import { Skeleton } from '@firmivra/ui';
import {
  CalendarDots,
  CurrencyCircleDollar,
  type Icon,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';
import { addDays, toInstant } from '../calendar/_components/time';
import { IconTile, type Tone } from './icon-tile';

const MAX_PAGE = 100;
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    cents / 100,
  );

function Kpi({
  icon,
  tone,
  value,
  label,
  note,
  href,
  loading,
  failed,
}: {
  icon: Icon;
  tone: Tone;
  value: string;
  label: string;
  note?: string;
  href: string;
  loading: boolean;
  failed: boolean;
}) {
  return (
    <Link
      href={href}
      data-testid="kpi-card"
      className="flex items-center gap-4 rounded-xl bg-surface p-4 shadow-md hover:bg-canvas"
    >
      <IconTile icon={icon} tone={tone} />
      <span className="flex min-w-0 flex-col">
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <span className="text-3xl font-bold text-heading">{failed ? '—' : value}</span>
        )}
        <span className="text-sm text-muted">{label}</span>
        {note && !loading && !failed ? <span className="text-xs text-muted">{note}</span> : null}
        {failed ? <span className="text-xs text-danger">Couldn&apos;t load</span> : null}
      </span>
    </Link>
  );
}

/** Four numbers from the API; a count of 100 or more shows as "100+" because lists come in pages. */
export function KpiCards({
  manager,
  timeZone,
  today,
}: {
  manager: boolean;
  timeZone: string;
  today: string;
}) {
  const clients = useApiQuery(['dashboard', 'clients'], () =>
    api.clients.list({ limit: MAX_PAGE }),
  );
  const leads = useApiQuery(['dashboard', 'leads'], () => api.leads.counts());
  const todays = useApiQuery(['dashboard', 'today', today], () =>
    api.appointments.list({
      from: toInstant(today, '00:00', timeZone),
      to: toInstant(addDays(today, 1), '00:00', timeZone),
    }),
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        icon={UsersThree}
        tone="blue"
        label="Total clients"
        href="/clients"
        loading={clients.isPending}
        failed={clients.isError}
        value={
          clients.data ? `${clients.data.items.length}${clients.data.nextCursor ? '+' : ''}` : ''
        }
        note={
          clients.data
            ? `${clients.data.items.filter((c) => c.createdAt.slice(0, 7) === today.slice(0, 7)).length} added this month`
            : undefined
        }
      />
      <Kpi
        icon={UserPlus}
        tone="amber"
        label="New leads"
        href="/leads"
        loading={leads.isPending}
        failed={leads.isError}
        value={String(leads.data?.submitted ?? 0)}
        note={`${leads.data?.inReview ?? 0} in review`}
      />
      {manager ? <Outstanding /> : null}
      <Kpi
        icon={CalendarDots}
        tone="blue"
        label="Appointments today"
        href="/calendar"
        loading={todays.isPending}
        failed={todays.isError}
        value={String(
          todays.data?.filter((a) => !a.restricted && a.status === 'SCHEDULED').length ?? 0,
        )}
      />
    </div>
  );
}

/** Owner and Admin only: the money still to collect on open invoices. */
function Outstanding() {
  const open = useApiQuery(['dashboard', 'open-invoices'], () =>
    api.invoices.list({ status: 'OPEN', limit: MAX_PAGE }),
  );
  const items = open.data?.items ?? [];
  const currency = items[0]?.currency ?? 'usd';
  const total = items.reduce((sum, i) => sum + i.balanceDueCents, 0);
  return (
    <Kpi
      icon={CurrencyCircleDollar}
      tone="red"
      label="Outstanding invoices"
      href="/invoices"
      loading={open.isPending}
      failed={open.isError}
      value={`${money(total, currency)}${open.data?.nextCursor ? '+' : ''}`}
      note={`${items.length}${open.data?.nextCursor ? '+' : ''} open`}
    />
  );
}
