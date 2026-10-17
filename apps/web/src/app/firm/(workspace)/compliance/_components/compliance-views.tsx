'use client';

import type { ComplianceDeadlineRow } from '@firmivra/types';
import { Badge, CalendarGrid, type CalendarEvent, type Column, Table } from '@firmivra/ui';
import { MagnifyingGlass, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import {
  COMPLIANCE_KEY,
  FAMILY_LABEL,
  StatusPill,
  TYPE_LABEL,
  dayText,
  isoDay,
  quiet,
  subtle,
} from './compliance-shared';

const frame = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';

/** By Client: every client with deadlines, how many are open, overdue or due soon. */
export function ByClientView() {
  const [search, setSearch] = useState('');
  const [risk, setRisk] = useState(false);
  const [page, setPage] = useState(1);
  const list = useApiQuery([...COMPLIANCE_KEY, 'by-client', search, risk, page], () =>
    api.compliance.byClient({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(risk ? { atRisk: true } : {}),
      page,
      pageSize: 10,
    }),
  );
  type Row = NonNullable<typeof list.data>['items'][number];
  const columns: Column<Row>[] = [
    {
      id: 'client',
      label: 'Client',
      cell: (r) => <span className="font-medium text-heading">{r.client.displayName}</span>,
    },
    { id: 'open', label: 'Open', cell: (r) => r.open },
    {
      id: 'overdue',
      label: 'Overdue',
      cell: (r) => (
        <span className={r.overdue ? 'font-semibold text-danger' : ''}>{r.overdue}</span>
      ),
    },
    { id: 'soon', label: 'Due Soon', cell: (r) => r.dueSoon },
    { id: 'done', label: 'Completed', cell: (r) => r.completed },
    { id: 'next', label: 'Next Due', cell: (r) => (r.nextDueOn ? dayText(r.nextDueOn) : '—') },
    {
      id: 'risk',
      label: 'Risk',
      cell: (r) =>
        r.atRisk ? <Badge tone="danger">At risk</Badge> : <Badge tone="success">On track</Badge>,
    },
  ];
  return (
    <section className={frame} aria-label="By Client" data-testid="by-client">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex h-10 min-w-48 flex-1 items-center gap-2 rounded-lg border border-divider bg-canvas px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
          <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
          <span className="sr-only">Search clients</span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search clients..."
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={risk}
            onChange={(e) => {
              setRisk(e.target.checked);
              setPage(1);
            }}
          />
          Only clients at risk
        </label>
      </div>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.client.id}
          caption="Deadlines by client"
          dense
          noun="clients"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Clients are not available' : 'No clients with deadlines'}
          emptyText={
            list.isError
              ? 'We could not load the clients. Try again in a moment.'
              : 'Add a deadline for a client to see them here.'
          }
          rowActions={(r) => (
            <Link href={`/clients/${r.client.id}`} className="text-sm font-medium text-link">
              View<span className="sr-only"> {r.client.displayName}</span>
            </Link>
          )}
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (next: number) => setPage(next),
            onSort: () => undefined,
          }}
        />
      </div>
    </section>
  );
}

/** By Type: the same deadlines, grouped under their type. */
export function ByTypeView() {
  const list = useApiQuery([...COMPLIANCE_KEY, 'by-type'], () =>
    api.compliance.deadlines({ tab: 'ALL', pageSize: 100 }),
  );
  const groups = new Map<string, ComplianceDeadlineRow[]>();
  for (const d of list.data?.items ?? []) {
    groups.set(d.type, [...(groups.get(d.type) ?? []), d]);
  }
  if (groups.size === 0) {
    return (
      <p className={`${frame} ${quiet}`}>
        {list.isPending
          ? 'Loading…'
          : list.isError
            ? 'Deadlines are not available right now.'
            : 'No deadlines to group yet.'}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="by-type">
      {[...groups].map(([type, rows]) => (
        <section key={type} className={frame}>
          <h3 className="mb-2 flex items-baseline justify-between text-base font-bold text-heading">
            {TYPE_LABEL[type as keyof typeof TYPE_LABEL]}
            <span className="text-sm font-normal text-muted">{rows.length} deadline(s)</span>
          </h3>
          <ul className="divide-y divide-divider">
            {rows.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/compliance/${d.id}`}
                  className="min-w-0 flex-1 truncate font-medium text-heading hover:underline"
                >
                  {d.name}
                </Link>
                <span className="text-muted">{d.client.displayName}</span>
                <span className={d.displayStatus === 'OVERDUE' ? 'text-danger' : 'text-text'}>
                  {dayText(d.extendedDueOn ?? d.dueOn)}
                </span>
                <StatusPill status={d.displayStatus} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Government Calendars: the versioned library, with its status and when each was last verified. */
export function CalendarsView() {
  const list = useApiQuery([...COMPLIANCE_KEY, 'calendars', 'all'], () =>
    api.compliance.calendars({ pageSize: 50 }),
  );
  const rows = (list.data?.items ?? []).filter((c) => c.status !== 'ARCHIVED');
  const stale = rows.filter((c) => c.stale && c.status === 'PUBLISHED');
  type Row = (typeof rows)[number];
  const tone = {
    DRAFT: 'neutral',
    VERIFIED: 'info',
    PUBLISHED: 'success',
    SUPERSEDED: 'neutral',
    ARCHIVED: 'neutral',
  } as const;
  const columns: Column<Row>[] = [
    {
      id: 'name',
      label: 'Calendar',
      cell: (c) => <span className="font-medium text-heading">{c.name}</span>,
    },
    { id: 'family', label: 'Family', cell: (c) => FAMILY_LABEL[c.family] },
    { id: 'authority', label: 'Authority', cell: (c) => c.authority },
    { id: 'year', label: 'Year', cell: (c) => `${c.effectiveYear} · v${c.version}` },
    {
      id: 'status',
      label: 'Status',
      cell: (c) => (
        <Badge tone={tone[c.status]}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>
      ),
    },
    {
      id: 'verified',
      label: 'Last Verified',
      cell: (c) =>
        c.verifiedAt ? (
          <span className={c.stale ? 'font-semibold text-warning' : ''}>
            {dayText(c.verifiedAt.slice(0, 10))}
            {c.stale ? ' (stale)' : ''}
          </span>
        ) : (
          'Not verified'
        ),
    },
    { id: 'entries', label: 'Entries', cell: (c) => c.entryCount },
  ];
  return (
    <section className={frame} aria-label="Government Calendars" data-testid="calendars-view">
      {stale.length > 0 ? (
        <p
          role="status"
          className="mb-3 flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"
        >
          <Warning aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
          {stale.length} published calendar(s) were verified a long time ago. Check the official
          source and verify them again.
        </p>
      ) : null}
      <div className="relative">
        <Table
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          caption="Government calendars"
          dense
          noun="calendars"
          pageSize={50}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Calendars are not available' : 'No government calendars'}
          emptyText={
            list.isError
              ? 'We could not load the calendars. Try again in a moment.'
              : 'Import an official calendar to start the library.'
          }
          emptyAction={
            <Link
              href="/compliance/recurring/new?tab=import"
              className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-on-action"
            >
              Import Government Calendar
            </Link>
          }
        />
      </div>
      <p className="mt-3 text-sm">
        <Link href="/compliance/recurring/new?tab=library" className={subtle}>
          Open the Calendar Library
        </Link>
      </p>
    </section>
  );
}

/** Tax Calendar: the month as a grid, and the deadlines of the picked day below it. */
export function TaxCalendarView() {
  const router = useRouter();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [day, setDay] = useState<string>();
  const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  const cal = useApiQuery([...COMPLIANCE_KEY, 'tax-calendar', key], () =>
    api.compliance.month({ month: key }),
  );
  const tone = { OVERDUE: 'red', DUE_SOON: 'amber', COMPLETED: 'green' } as const;
  const days = cal.data?.days ?? [];
  const events: CalendarEvent[] = days.flatMap((d) =>
    d.deadlines.map((x) => ({
      id: x.id,
      start: `${d.date}T09:00:00`,
      end: `${d.date}T10:00:00`,
      title: x.name,
      subtitle: x.clientName,
      tone: tone[x.displayStatus as keyof typeof tone] ?? 'blue',
    })),
  );
  const picked = days.find((d) => d.date === day);
  const [y, m, d] = (day ?? '').split('-').map(Number);
  return (
    <section className={frame} aria-label="Tax Calendar" data-testid="tax-calendar">
      <CalendarGrid
        view="month"
        date={month}
        events={events}
        today={new Date()}
        {...(day ? { selected: new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1) } : {})}
        onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        onDateClick={(x) => setDay(isoDay(x))}
        onEventClick={(e) => router.push(`/compliance/${e.id}`)}
      />
      {day ? (
        <div className="mt-4">
          <h3 className="mb-2 text-base font-bold text-heading">{dayText(day)}</h3>
          {picked && picked.deadlines.length > 0 ? (
            <ul className="divide-y divide-divider">
              {picked.deadlines.map((x) => (
                <li
                  key={x.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <Link
                    href={`/compliance/${x.id}`}
                    className="font-medium text-heading hover:underline"
                  >
                    {x.name}
                  </Link>
                  <span className="text-muted">{x.clientName}</span>
                  <StatusPill status={x.displayStatus} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>No deadlines on this day.</p>
          )}
        </div>
      ) : null}
      {cal.isError ? (
        <p className={`${quiet} mt-3`}>The calendar is not available right now.</p>
      ) : null}
    </section>
  );
}
