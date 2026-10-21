'use client';

import { Drawer } from '@firmivra/ui';
import { CheckCircle, RadioButton, type Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useApiQuery } from '../../../../../lib/query';
import {
  adminSales,
  appointmentTypeLabel,
  type ActivityKind,
  type SalesActivity,
  type SalesAppointment,
} from './sales-api';
import { dateText, dateTimeText, FrameState, SALES_KEY, timeText } from './sales-ui';

/** The coloured ring before an activity line: blue moves, green done, red lost, purple new. */
export function activityMarker(kind: ActivityKind): { icon: Icon; className: string } {
  switch (kind) {
    case 'CREATED':
      return { icon: RadioButton, className: 'text-purple' };
    case 'APPOINTMENT_SCHEDULED':
    case 'FOLLOW_UP_COMPLETED':
    case 'WON':
    case 'CONTACTED':
      return { icon: CheckCircle, className: 'text-success' };
    case 'LOST':
      return { icon: RadioButton, className: 'text-danger' };
    case 'TRANSACTION_LINKED':
    case 'UNDER_CONTRACT':
    case 'CLOSED':
    case 'TERMINATED':
      return { icon: RadioButton, className: 'text-heading' };
    case 'TRIAL_STARTED':
    case 'PROPOSAL_SENT':
      return { icon: RadioButton, className: 'text-gold' };
    default:
      return { icon: RadioButton, className: 'text-action' };
  }
}

export function ActivityLine({
  entry,
  compact = false,
}: {
  entry: SalesActivity;
  compact?: boolean;
}) {
  const marker = activityMarker(entry.kind);
  const Glyph = marker.icon;
  return (
    <li
      className={`flex items-start border-b border-divider last:border-0 ${compact ? 'gap-2 py-2' : 'gap-3 py-2.5'}`}
    >
      <Glyph
        aria-hidden
        weight="fill"
        className={`shrink-0 ${compact ? 'size-4' : 'mt-0.5 size-5'} ${marker.className}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <Link
          href={`/sales/opportunities/${entry.opportunityId}`}
          className={`min-w-0 text-text hover:text-action hover:underline ${compact ? 'text-xs leading-snug' : 'text-sm'}`}
        >
          {entry.text}
          {!compact && entry.detail ? (
            <span className="block text-xs text-muted">{entry.detail}</span>
          ) : null}
        </Link>
        <span
          className={`flex shrink-0 flex-col text-xs text-muted sm:items-end ${compact ? 'whitespace-nowrap' : 'sm:text-sm'}`}
        >
          <time dateTime={entry.at}>{dateTimeText(entry.at)}</time>
          {!compact ? <span>{entry.actor.name}</span> : null}
        </span>
      </div>
    </li>
  );
}

/** "View All" activity: the full user-facing feed, newest first, each line opening its record. */
export function ActivityDrawer({
  kinds,
  pipelineId,
  onClose,
}: {
  kinds: 'sales' | 'all';
  pipelineId?: string;
  onClose: () => void;
}) {
  const feed = useApiQuery([...SALES_KEY, 'activity', kinds, pipelineId ?? 'all', 'drawer'], () =>
    adminSales.activity({ kinds, pipelineId, limit: 100 }),
  );
  return (
    <Drawer
      open
      title={kinds === 'sales' ? 'Recent Sales Activity' : 'Recent Activity'}
      subtitle="The latest 100 entries. The full audit trail keeps everything."
      onClose={onClose}
    >
      <FrameState query={feed} empty="No activity yet." lines={8}>
        {(entries) => (
          <ul aria-label="All activity">
            {entries.map((entry) => (
              <ActivityLine key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </FrameState>
    </Drawer>
  );
}

/** "View All" appointments and follow-ups: everything booked from now on. */
export function AppointmentsDrawer({
  title,
  pipelineId,
  onClose,
}: {
  title: string;
  pipelineId?: string;
  onClose: () => void;
}) {
  const list = useApiQuery([...SALES_KEY, 'appointments', pipelineId ?? 'all', 'drawer'], () =>
    adminSales.appointments({ pipelineId, limit: 100 }),
  );
  return (
    <Drawer
      open
      title={title}
      subtitle="Everything booked from today on, soonest first."
      onClose={onClose}
    >
      <FrameState query={list} empty="Nothing is booked yet." lines={8}>
        {(items) => (
          <ul aria-label={title}>
            {items.map((item) => (
              <AppointmentLine key={item.id} item={item} />
            ))}
          </ul>
        )}
      </FrameState>
    </Drawer>
  );
}

function AppointmentLine({ item }: { item: SalesAppointment }) {
  return (
    <li className="border-b border-divider py-2.5 last:border-0">
      <Link
        href={`/sales/opportunities/${item.opportunityId}`}
        className="flex flex-col gap-0.5 text-sm hover:text-action"
      >
        <span className="font-medium text-heading">{item.firmName}</span>
        <span className="text-text">
          {appointmentTypeLabel(item.type)} with {item.contactName}
        </span>
        <span className="text-muted">
          <time dateTime={item.startsAt}>
            {dateText(item.startsAt)}, {timeText(item.startsAt)}
          </time>
          {item.assignedName ? ` · ${item.assignedName}` : ''}
        </span>
      </Link>
    </li>
  );
}
