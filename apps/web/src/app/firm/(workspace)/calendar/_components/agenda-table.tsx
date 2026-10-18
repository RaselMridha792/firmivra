'use client';

import type { AgendaEntry } from '@firmivra/types';
import { Avatar, Badge, type Column } from '@firmivra/ui';
import { CalendarBlank, PencilSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { RowMenu, type RowMenuItem } from '../../team/_components/row-menu';
import { STATUS_LOOKS, dateAndTime, initials, placeOf } from './appointments-parts';

/**
 * The design's Upcoming Appointments columns (appointments.jpg), shared by the Calendar view's
 * Upcoming table and the List view: Date & Time, Client / Lead, Service, Type, Status, Staff
 * Member, Location. Another member's appointment shows as Busy.
 */
export function agendaColumns(timeZone: string): Column<AgendaEntry>[] {
  return [
    {
      id: 'when',
      label: 'Date & Time',
      cell: (a) => {
        const [d, t] = dateAndTime(a.startsAt, timeZone);
        return (
          <span className="whitespace-nowrap">
            {d}
            <span className="block">{t}</span>
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
            className="flex items-center gap-2 text-heading hover:underline"
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
    {
      id: 'staff',
      label: 'Staff Member',
      cell: (a) => (
        <span className="flex items-center gap-2">
          {a.staff[0] ? <Avatar name={a.staff[0].name} size="md" /> : null}
          {a.staff.map((s) => s.name).join(', ')}
        </span>
      ),
    },
    { id: 'where', label: 'Location', cell: (a) => (a.restricted ? '—' : placeOf(a)) },
  ];
}

/** Edit, Reschedule and the ⋮ menu of a row; none for another member's Busy time. */
export function AgendaActions({ entry, menu }: { entry: AgendaEntry; menu: RowMenuItem[] }) {
  if (entry.restricted) return null;
  const who = entry.contact.name;
  return (
    <span className="flex items-center gap-1">
      <Link
        href={`/calendar/${entry.id}/edit`}
        aria-label={`Edit ${who}'s appointment`}
        title="Edit"
        className="inline-flex size-8 items-center justify-center rounded-lg border border-divider text-heading hover:bg-canvas"
      >
        <PencilSimple aria-hidden weight="bold" className="size-4" />
      </Link>
      <Link
        href={`/calendar/${entry.id}/edit`}
        aria-label={`Reschedule ${who}'s appointment`}
        title="Reschedule"
        className="inline-flex size-8 items-center justify-center rounded-lg border border-divider text-danger hover:bg-canvas"
      >
        <CalendarBlank aria-hidden weight="bold" className="size-4" />
      </Link>
      <RowMenu vertical label={`Actions for ${who}`} items={menu} />
    </span>
  );
}
