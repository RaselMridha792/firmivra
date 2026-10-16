'use client';

import { Badge } from '@firmivra/ui';
import { CalendarBlank, CalendarCheck } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { CardFrame, EmptyPanel, outlineButton } from './profile-cards';
import { useProfile } from './profile-frame';
import { shortName, stamp, wsKey } from './profile-shared';

const tone = (status: string) =>
  /cancel|no.?show/i.test(status) ? 'neutral' : /complete/i.test(status) ? 'info' : 'success';
const label = (status: string) =>
  status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');

/** Appointments tab: the Upcoming Appointments card, and the ones already held. */
export function AppointmentsTab() {
  const { id, profile, open } = useProfile();
  const query = useApiQuery(wsKey(id, 'appointments'), () => api.leadPipeline.appointments(id));
  const all = query.data ?? [];
  const [now] = useState(() => Date.now());
  const upcoming = all.filter((a) => Date.parse(a.endsAt) >= now);
  const past = all.filter((a) => Date.parse(a.endsAt) < now);
  const row = (a: (typeof all)[number]) => (
    <li
      key={a.id}
      className="flex flex-wrap items-center justify-between gap-3 py-3"
      data-testid="lead-appointment"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-lg bg-info-soft text-info"
        >
          <CalendarCheck weight="fill" className="size-5" />
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-heading">{a.type ?? 'Appointment'}</span>
          <span className="text-sm text-muted">
            {stamp(a.startsAt)} · {shortName(a.staff.name)}
          </span>
        </div>
      </div>
      <Badge tone={tone(a.status)}>{label(a.status)}</Badge>
    </li>
  );
  const addLink = (
    <button
      type="button"
      disabled={!profile}
      onClick={() => open('appointment')}
      className="text-sm font-medium text-link underline disabled:opacity-50"
    >
      Add Appointment
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      <CardFrame
        icon={CalendarBlank}
        title="Upcoming Appointments"
        action={addLink}
        testId="card-upcoming-appointments"
      >
        {upcoming.length === 0 ? (
          <EmptyPanel
            icon={CalendarBlank}
            title={
              query.isPending
                ? 'Loading…'
                : query.isError
                  ? 'Appointments are not available right now.'
                  : 'No appointments scheduled yet.'
            }
            text={
              query.isError || query.isPending
                ? undefined
                : 'Schedule a consultation to move this lead forward.'
            }
          >
            <button
              type="button"
              disabled={!profile}
              onClick={() => open('appointment')}
              className={`${outlineButton} mt-2`}
            >
              Schedule Appointment
            </button>
          </EmptyPanel>
        ) : (
          <ul className="divide-y divide-divider">{upcoming.map(row)}</ul>
        )}
      </CardFrame>
      <CardFrame icon={CalendarCheck} title="Past Appointments" testId="card-past-appointments">
        {past.length === 0 ? (
          <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
            No past appointments.
          </p>
        ) : (
          <ul className="divide-y divide-divider">{past.map(row)}</ul>
        )}
      </CardFrame>
    </div>
  );
}
