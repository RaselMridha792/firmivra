'use client';

import type { AgendaEntry, AgendaItem, AppointmentDisplayStatus } from '@firmivra/types';
import { Badge, Button, SearchField, Select, Table, type Column } from '@firmivra/ui';
import { CalendarBlank, PencilSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { RowMenu, type RowMenuItem } from '../../../team/_components/row-menu';
import {
  AppointmentsHeader,
  AppointmentsToolbar,
  NOT_LOADED,
  SCHEDULING,
  STATUS_LOOKS,
  SummaryCards,
  dateAndTime,
  initials,
  placeOf,
} from '../../_components/appointments-parts';
import { AppointmentsSide } from '../../_components/appointments-side';

const DAY = 86_400_000;
const PERIODS = [
  { value: 'next7', label: 'Next 7 days' },
  { value: 'next30', label: 'Next 30 days' },
  { value: 'past30', label: 'Last 30 days' },
] as const;
type Period = (typeof PERIODS)[number]['value'];

function range(period: Period) {
  const now = Date.now();
  const start = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  if (period === 'past30')
    return { from: new Date(start - 30 * DAY).toISOString(), to: new Date(now).toISOString() };
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + (period === 'next7' ? 8 : 31) * DAY).toISOString(),
  };
}

const LIST_ERRORS: Record<string, string> = {
  NOT_FOUND: 'This appointment was changed or removed. The list is up to date again.',
};

/**
 * Appointments > List (appointments.jpg, guide §2, §10): the Appointments frame (KPI cards, the
 * view switch with this view's search, status and period, New Appointment, and the right
 * column), with the appointments as the design's Upcoming table from `api.scheduling.agenda`,
 * 50 at a time (Load more). Row actions: Edit, Reschedule, and the menu (View Details, Confirm,
 * Send Reminder, Join Meeting). Another member's appointment shows as Busy.
 */
export function ListScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<AppointmentDisplayStatus | ''>('');
  const [period, setPeriod] = useState<Period>('next30');
  const [limit, setLimit] = useState(50);
  const [message, setMessage] = useState('');
  const [span, setSpan] = useState(() => range('next30'));
  const { from, to } = span;
  const query = {
    from,
    to,
    limit,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status ? { status } : {}),
  };
  const agenda = useApiQuery([...SCHEDULING, 'agenda', 'list', query], () =>
    api.scheduling.agenda(query),
  );
  const confirm = useApiMutation((id: string) => api.scheduling.confirm(id), {
    invalidate: SCHEDULING,
  });
  const remind = useApiMutation((id: string) => api.scheduling.sendReminder(id), {
    invalidate: SCHEDULING,
  });
  const tz = agenda.data?.timezone ?? 'America/New_York';
  const rows = agenda.data?.items ?? [];
  const filtered = Boolean(search.trim() || status);
  const error = confirm.error ?? remind.error;

  const menu = (a: AgendaItem): RowMenuItem[] => [
    { label: 'View Details', onSelect: () => router.push(`/calendar/${a.id}`) },
    ...(a.status === 'PENDING'
      ? [
          {
            label: 'Confirm',
            onSelect: () =>
              confirm.mutate(a.id, {
                onSuccess: () => setMessage(`${a.contact.name}'s appointment is confirmed.`),
              }),
          },
        ]
      : []),
    ...(a.status === 'PENDING' || a.status === 'CONFIRMED' || a.status === 'RESCHEDULED'
      ? [
          {
            label: 'Send Reminder',
            onSelect: () =>
              remind.mutate(a.id, {
                onSuccess: (r) =>
                  setMessage(
                    r.sent
                      ? `Reminder sent to ${a.contact.name}.`
                      : `No reminder could be sent to ${a.contact.name}.`,
                  ),
              }),
          },
        ]
      : []),
    ...(a.videoUrl
      ? [
          {
            label: 'Join Meeting',
            onSelect: () => window.open(a.videoUrl ?? '', '_blank', 'noopener'),
          },
        ]
      : []),
  ];

  const columns: Column<AgendaEntry>[] = [
    {
      id: 'when',
      label: 'Date & Time',
      cell: (a) => {
        const [d, t] = dateAndTime(a.startsAt, tz);
        return (
          <span className="whitespace-nowrap">
            {d}
            <span className="block text-muted">{t}</span>
          </span>
        );
      },
    },
    {
      id: 'contact',
      label: 'Client / Lead',
      cell: (a) =>
        a.restricted ? (
          <span className="text-muted">Busy</span>
        ) : (
          <Link
            href={`/calendar/${a.id}`}
            className="flex items-center gap-2 font-semibold text-heading hover:underline"
          >
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-purple-soft text-xs font-bold text-purple"
            >
              {a.internal ? 'TM' : initials(a.contact.name)}
            </span>
            {a.internal ? 'Team Meeting' : a.contact.name}
          </Link>
        ),
    },
    {
      id: 'service',
      label: 'Service',
      cell: (a) => (a.restricted ? '—' : (a.service?.name ?? '—')),
    },
    { id: 'type', label: 'Type', cell: (a) => (a.restricted ? '—' : (a.type?.name ?? '—')) },
    {
      id: 'status',
      label: 'Status',
      cell: (a) => <Badge tone={STATUS_LOOKS[a.status].tone}>{STATUS_LOOKS[a.status].label}</Badge>,
    },
    { id: 'staff', label: 'Staff Member', cell: (a) => a.staff.map((s) => s.name).join(', ') },
    { id: 'where', label: 'Location', cell: (a) => (a.restricted ? '—' : placeOf(a)) },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <AppointmentsHeader />
      <SummaryCards />
      <AppointmentsToolbar current="list">
        <SearchField
          label="Search appointments"
          placeholder="Search by name, email, phone, or service..."
          value={search}
          minWidth="14rem"
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(50);
          }}
        />
        <div className="w-36">
          <Select
            label="Status"
            hideLabel
            options={[
              { value: '', label: 'All Statuses' },
              ...Object.entries(STATUS_LOOKS)
                .filter(([k]) => k !== 'DRAFT')
                .map(([value, l]) => ({ value, label: l.label })),
            ]}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AppointmentDisplayStatus | '');
              setLimit(50);
            }}
          />
        </div>
        <div className="w-40">
          <Select
            label="Period"
            hideLabel
            options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
            value={period}
            onChange={(e) => {
              const next = e.target.value as Period;
              setPeriod(next);
              setSpan(range(next));
              setLimit(50);
            }}
          />
        </div>
      </AppointmentsToolbar>
      <div className="grid grid-cols-1 items-start gap-4 min-[1280px]:grid-cols-[1fr_18rem]">
        <section
          aria-labelledby="appointments-list"
          data-testid="appointments-list"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <h2 id="appointments-list" className="text-lg font-bold text-heading">
            Appointments
          </h2>
          {message || error ? (
            <p
              role={error ? 'alert' : 'status'}
              data-testid="list-result"
              className={`text-sm ${error ? 'text-danger' : 'text-success'}`}
            >
              {error ? errorMessage(error, LIST_ERRORS) : message}
            </p>
          ) : null}
          <Table
            rows={rows}
            loading={agenda.isPending}
            rowKey={(a) => a.id}
            caption="Appointments"
            noun="appointments"
            dense
            tableClassName="[&_td]:px-2 [&_th]:px-2"
            showPagination={false}
            columns={columns}
            rowActions={(a) =>
              a.restricted ? null : (
                <span className="flex items-center gap-1">
                  <Link
                    href={`/calendar/${a.id}/edit`}
                    aria-label={`Edit ${a.contact.name}'s appointment`}
                    title="Edit"
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-divider text-heading hover:bg-canvas"
                  >
                    <PencilSimple aria-hidden weight="bold" className="size-4" />
                  </Link>
                  <Link
                    href={`/calendar/${a.id}/edit`}
                    aria-label={`Reschedule ${a.contact.name}'s appointment`}
                    title="Reschedule"
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-divider text-danger hover:bg-canvas"
                  >
                    <CalendarBlank aria-hidden weight="bold" className="size-4" />
                  </Link>
                  <RowMenu vertical label={`Actions for ${a.contact.name}`} items={menu(a)} />
                </span>
              )
            }
            emptyTitle={
              agenda.isError
                ? 'Appointments are not available'
                : filtered
                  ? 'No matching appointments'
                  : 'No appointments'
            }
            emptyText={
              agenda.isError
                ? NOT_LOADED
                : filtered
                  ? 'Try another search, status or period.'
                  : 'Nothing is booked in this period. Schedule one with New Appointment.'
            }
          />
          {agenda.data?.nextCursor || rows.length >= limit ? (
            <Button
              variant="secondary"
              className="self-center"
              onClick={() => setLimit((l) => Math.min(l + 50, 500))}
            >
              Load more
            </Button>
          ) : null}
        </section>
        <AppointmentsSide />
      </div>
    </div>
  );
}
