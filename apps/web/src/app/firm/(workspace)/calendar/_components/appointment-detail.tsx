'use client';

import type {
  AppointmentAction,
  AppointmentDetail as Detail,
  AppointmentStatus,
} from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import type { ReactNode } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { APPOINTMENTS, LOCATION_LABELS } from './shared';
import { dayLabel, localParts, timeLabel } from './time';

const STATUS: Record<AppointmentStatus, [string, 'info' | 'neutral' | 'success' | 'warning']> = {
  SCHEDULED: ['Scheduled', 'info'],
  CANCELLED: ['Cancelled', 'neutral'],
  COMPLETED: ['Completed', 'success'],
  NO_SHOW: ['No-show', 'warning'],
};
const ACTIONS: Record<AppointmentAction, string> = {
  BOOKED: 'Booked',
  RESCHEDULED: 'Moved',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'Marked no-show',
};

interface DetailProps {
  timeZone: string;
}

/** An appointment's details and history. */
export function AppointmentDetail({ id, ...props }: DetailProps & { id: string }) {
  const detail = useApiQuery([...APPOINTMENTS, 'detail', id], () => api.appointments.get(id));
  return (
    <PageState query={detail}>
      {(appointment) => <Body appointment={appointment} {...props} />}
    </PageState>
  );
}

function Body({ appointment, timeZone }: DetailProps & { appointment: Detail }) {
  const at = (iso: string) =>
    `${dayLabel(localParts(iso, timeZone).date)}, ${timeLabel(iso, timeZone)}`;
  const [status, tone] = STATUS[appointment.status];
  const details = appointment.locationDetails;

  return (
    <div data-testid="appointment-detail" className="flex flex-col gap-4">
      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Client">{appointment.client.displayName}</Row>
        <Row label="When">
          {at(appointment.startsAt)} – {timeLabel(appointment.endsAt, timeZone)}
        </Row>
        <Row label="Staff">{appointment.staff.name}</Row>
        <Row label="Type">{appointment.type?.name ?? 'No type'}</Row>
        <Row label="Where">
          {LOCATION_LABELS[appointment.locationKind]}
          {details?.startsWith('https://') ? (
            <a href={details} target="_blank" rel="noreferrer" className="ml-2 break-all text-link">
              {details}
            </a>
          ) : details ? (
            <span className="ml-2 whitespace-pre-wrap">{details}</span>
          ) : null}
        </Row>
        <Row label="Status">
          <Badge tone={tone}>{status}</Badge>
          {appointment.bookedByClient ? (
            <span className="ml-2 text-muted">Booked by the client</span>
          ) : null}
        </Row>
        {appointment.cancelReason ? <Row label="Reason">{appointment.cancelReason}</Row> : null}
      </dl>

      <section aria-label="History">
        <h3 className="mb-2 text-sm font-semibold text-text">History</h3>
        <ol className="flex flex-col gap-1 text-sm text-muted">
          {appointment.history.map((event) => (
            <li key={`${event.at}-${event.action}`}>
              {ACTIONS[event.action]} by {event.by.name} · {at(event.at)}
              {event.reason ? ` · ${event.reason}` : ''}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-text">{children}</dd>
    </div>
  );
}
