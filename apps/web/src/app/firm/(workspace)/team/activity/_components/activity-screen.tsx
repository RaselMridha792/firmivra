'use client';

import type { AuditEntry, AuditLogQuery, StaffRef } from '@firmivra/types';
import { Badge, Callout, Select, Table, type Column } from '@firmivra/ui';
import {
  ArrowLeft,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  type Icon,
  Info,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, createElement, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED } from '../../_components/quiet-card';

const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const WORDS: Record<string, string> = {
  'auth.signed_in': 'Signed in',
  'auth.sign_in_failed': 'Sign-in failed',
  'auth.signed_out': 'Signed out',
};

/** "client.created" → "Client created"; the sign-in events in plain words. */
export function activityLabel(action: string): string {
  const known = WORDS[action];
  if (known) return known;
  const text = action.replaceAll('.', ' ').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A period ending now, as the audit log's `from` and `to`. */
function range(days: string): Pick<AuditLogQuery, 'from' | 'to'> {
  const to = new Date();
  const from = new Date(to.getTime() - Number(days) * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** One audit list with its own pages (the log's cursor; Previous steps back). */
function useAuditPages(base: AuditLogQuery) {
  const [cursors, setCursors] = useState<string[]>([]);
  const [key, setKey] = useState(JSON.stringify(base));
  // A new filter starts again from the first page.
  if (key !== JSON.stringify(base)) {
    setKey(JSON.stringify(base));
    setCursors([]);
  }
  const cursor = cursors.at(-1);
  const query = { ...base, limit: 25, ...(cursor ? { cursor } : {}) };
  const list = useApiQuery(['audit-log', 'team', query], () => api.auditLog.list(query));
  const next = list.data?.nextCursor ?? null;
  return {
    list,
    server: list.data
      ? {
          page: cursors.length + 1,
          hasPrevious: cursors.length > 0,
          hasNext: next !== null,
          onPrevious: () => setCursors(cursors.slice(0, -1)),
          onNext: () => next && setCursors([...cursors, next]),
          onSort: () => undefined,
        }
      : undefined,
  };
}

function Card({
  title,
  subtitle,
  icon,
  testId,
  children,
}: {
  title: string;
  subtitle: string;
  icon: Icon;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info"
        >
          {createElement(icon, { weight: 'fill', className: 'size-6' })}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-heading">{title}</h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Staff Management > Activity & Login History (`/team/activity`, guide §14, §16): the team's
 * sign-ins and actions from the audit log, with the Login History and Activity cards of
 * staff-account-access-and-security.jpg. Filters: one member and the period. A name opens that
 * member's Access & Security activity. Read-only.
 */
export function ActivityScreen() {
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const [person, setPerson] = useState('');
  const [days, setDays] = useState('30');
  const people: StaffRef[] = options.data?.managers ?? [];
  const byUser = new Map(people.map((p) => [p.userId, p]));
  // Recomputed only when the filters change, so paging keeps its place.
  const [period, setPeriod] = useState(() => ({ days, ...range(days) }));
  if (period.days !== days) setPeriod({ days, ...range(days) });
  const base = {
    from: period.from,
    to: period.to,
    ...(person ? { actorUserId: person } : {}),
  };
  const logins = useAuditPages({ ...base, action: 'auth.' });
  const actions = useAuditPages(base);

  const staff = (e: AuditEntry) => {
    if (!e.actor) return 'System';
    const member = e.actor.userId ? byUser.get(e.actor.userId) : undefined;
    return member ? (
      <Link
        href={`/team/${member.id}/security/activity`}
        className="font-semibold text-link hover:underline"
      >
        {member.name}
      </Link>
    ) : (
      e.actor.name
    );
  };
  const loginColumns: Column<AuditEntry>[] = [
    { id: 'at', label: 'Date & Time', cell: (e) => when(e.at) },
    { id: 'who', label: 'Staff Member', cell: staff },
    {
      id: 'status',
      label: 'Status',
      cell: (e) =>
        e.action === 'auth.sign_in_failed' ? (
          <Badge tone="danger" icon={XCircle}>
            Failed
          </Badge>
        ) : (
          <Badge tone="success" icon={CheckCircle}>
            {activityLabel(e.action)}
          </Badge>
        ),
    },
    { id: 'ip', label: 'IP Address', cell: (e) => e.ip ?? '—' },
  ];
  const actionColumns: Column<AuditEntry>[] = [
    { id: 'at', label: 'Date & Time', cell: (e) => when(e.at) },
    { id: 'who', label: 'Staff Member', cell: staff },
    {
      id: 'label',
      label: 'Activity',
      cell: (e) => <span className="font-medium text-heading">{activityLabel(e.action)}</span>,
    },
    {
      id: 'record',
      label: 'Record',
      cell: (e) => <span className="text-muted">{activityLabel(e.entity.type)}</span>,
    },
  ];
  // Clients sign in too: this page is about the team.
  const staffOnly = (rows: AuditEntry[] = []) => rows.filter((e) => e.actor?.kind !== 'CLIENT');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/team"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Staff Management
        </Link>
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <ClockCounterClockwise aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              Activity &amp; Login History
            </h1>
            <p className="text-base text-link">
              See who on your team signed in and what they did, from the audit log.
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm">
        <div className="w-full sm:w-64">
          <Select
            label="Staff member"
            options={[
              { value: '', label: 'All staff' },
              ...people.map((p) => ({ value: p.userId, label: p.name })),
            ]}
            value={person}
            onChange={(event) => setPerson(event.target.value)}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            label="Period"
            options={PERIODS}
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </div>
        <Link
          href="/audit-log"
          className="inline-flex min-h-11 items-center rounded-control border border-action px-4 text-sm font-semibold text-action hover:bg-folder-surface sm:ml-auto"
        >
          Open Full Audit Log
        </Link>
      </div>

      <Card
        title="Login History"
        subtitle="Staff sign-ins and failed attempts, newest first."
        icon={ClockCounterClockwise}
        testId="team-login-history"
      >
        <Table
          rows={staffOnly(logins.list.data?.items)}
          loading={logins.list.isPending}
          rowKey={(e) => e.id}
          caption="Staff login history"
          dense
          columns={loginColumns}
          server={logins.server}
          emptyTitle={logins.list.isError ? 'Login history is not available' : 'No sign-ins'}
          emptyText={
            logins.list.isError ? NOT_LOADED : 'No staff sign-ins in this period. Try a longer one.'
          }
        />
      </Card>

      <Card
        title="Team Activity"
        subtitle="What staff did in the workspace, newest first."
        icon={ClipboardText}
        testId="team-activity"
      >
        <Table
          rows={staffOnly(actions.list.data?.items)}
          loading={actions.list.isPending}
          rowKey={(e) => e.id}
          caption="Team activity"
          dense
          columns={actionColumns}
          server={actions.server}
          emptyTitle={actions.list.isError ? 'Activity is not available' : 'No activity'}
          emptyText={actions.list.isError ? NOT_LOADED : 'Nothing was recorded in this period.'}
        />
      </Card>

      <Callout icon={Info} tone="navy" surface="plain" size="compact">
        IP addresses are approximate security telemetry, not proof of where someone was. Only Owners
        and Admins see this page, and it never shows a password, code or token.
      </Callout>
    </div>
  );
}
