'use client';

import type { AgendaEntry, AgendaItem } from '@firmivra/types';
import { Avatar, Badge, type Column, Table } from '@firmivra/ui';
import Link from 'next/link';
import { RowActions, type Notify, useAppointmentActions } from './ap-actions';
import {
  METHOD_SHORT,
  STATUS_LABELS,
  STATUS_TONES,
  clock,
  dateLabel,
  entryName,
  shortName,
} from './ap-shared';

const CLOSED = new Set(['COMPLETED', 'CANCELED', 'NO_SHOW']);

/**
 * The appointments table of List, Today and Upcoming: date and time, client or lead, service,
 * type, status, staff, location and the row's actions. Another member's appointment is a Busy
 * row for Staff (the API sends only the time, the staff member and the status).
 */
export function AppointmentsTable({
  entries,
  timeZone,
  notify,
  loading,
  emptyTitle = 'No appointments',
  emptyText = 'Appointments you schedule will appear here.',
  caption,
}: {
  entries: AgendaEntry[];
  timeZone: string;
  notify: Notify;
  loading?: boolean;
  emptyTitle?: string;
  emptyText?: string;
  caption: string;
}) {
  const actions = useAppointmentActions(notify);
  const columns: Column<AgendaEntry>[] = [
    {
      id: 'when',
      label: 'Date & Time',
      cell: (row) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>{dateLabel(row.startsAt, timeZone)}</span>
          <span>{clock(row.startsAt, timeZone)}</span>
        </span>
      ),
    },
    {
      id: 'client',
      label: 'Client / Lead',
      cell: (row) =>
        row.restricted ? (
          <span className="text-muted">Busy</span>
        ) : (
          <span className="flex items-center gap-2">
            <Avatar name={entryName(row)} size="md" />
            <Link
              href={`/calendar/${row.id}`}
              className="font-medium text-heading hover:underline"
              data-testid="appointment-link"
            >
              {entryName(row)}
            </Link>
          </span>
        ),
    },
    {
      id: 'service',
      label: 'Service',
      cell: (row) => (row.restricted ? '' : (row.service?.name ?? '–')),
    },
    { id: 'type', label: 'Type', cell: (row) => (row.restricted ? '' : (row.type?.name ?? '–')) },
    {
      id: 'status',
      label: 'Status',
      cell: (row) => <Badge tone={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>,
    },
    {
      id: 'staff',
      label: 'Staff Member',
      cell: (row) => {
        const first = row.staff[0];
        return first ? (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Avatar name={first.name} size="md" />
            {shortName(first.name)}
            {row.staff.length > 1 ? (
              <span className="text-xs text-muted">+{row.staff.length - 1}</span>
            ) : null}
          </span>
        ) : null;
      },
    },
    {
      id: 'location',
      label: 'Location',
      cell: (row) => (row.restricted ? '' : METHOD_SHORT[(row as AgendaItem).method]),
    },
  ];
  return (
    <Table
      rows={entries}
      columns={columns}
      rowKey={(row) => row.id}
      caption={caption}
      loading={loading}
      pageSize={8}
      dense
      noun="appointments"
      emptyTitle={emptyTitle}
      emptyText={emptyText}
      emptyAction={
        <Link
          href="/calendar/new"
          className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-on-action"
        >
          Schedule Appointment
        </Link>
      }
      rowActions={(row) =>
        row.restricted ? null : (
          <RowActions
            id={row.id}
            name={entryName(row)}
            actions={actions}
            closed={CLOSED.has(row.status)}
          />
        )
      }
    />
  );
}
