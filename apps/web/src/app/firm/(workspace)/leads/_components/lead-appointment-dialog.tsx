'use client';

import { type LeadRow, type ScheduleAppointmentRequest } from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from './lead-shared';

function zonedDateTimeToIso(value: string, timeZone: string) {
  const [datePart, timePart] = value.split('T');
  if (!datePart || !timePart) return '';
  const [yearText, monthText, dayText] = datePart.split('-');
  const [hourText, minuteText] = timePart.split(':');
  const year = Number(yearText ?? 0);
  const month = Number(monthText ?? 0);
  const day = Number(dayText ?? 0);
  const hour = Number(hourText ?? 0);
  const minute = Number(minuteText ?? 0);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallTime;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    instant += wallTime - represented;
  }
  return new Date(instant).toISOString();
}

/** Uses the firm appointment settings and writes the lead as a LEAD contact. */
export function LeadAppointmentDialog({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const [typeId, setTypeId] = useState('');
  const [staffUserId, setStaffUserId] = useState(lead.assignedTo?.userId ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [method, setMethod] = useState<'IN_PERSON' | 'PHONE' | 'VIDEO' | 'OTHER'>('OTHER');
  const [details, setDetails] = useState('');
  const options = useApiQuery(['scheduling', 'options'], () => api.scheduling.options());
  const schedule = useApiMutation(
    (body: ScheduleAppointmentRequest) => api.scheduling.schedule(body),
    { invalidate: LEAD_PIPELINE_KEY },
  );

  const submit = options.data?.types.find((item) => item.id === typeId);
  const selectedStaff = options.data?.staff.some((staff) => staff.userId === staffUserId);
  const canSubmit = Boolean(submit && selectedStaff && startsAt && !schedule.isPending);

  return (
    <Modal
      open
      title="Schedule Appointment"
      subtitle={`For ${lead.firstName} ${lead.lastName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-appointment-form" disabled={!canSubmit}>
            {schedule.isPending ? 'Scheduling…' : 'Schedule Appointment'}
          </Button>
        </>
      }
    >
      <PageState query={options}>
        {(data) =>
          data.types.length && data.staff.length ? (
            <form
              id="lead-appointment-form"
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!submit || !selectedStaff || !startsAt) return;
                const start = zonedDateTimeToIso(startsAt, data.timezone);
                const end = new Date(
                  Date.parse(start) + submit.durationMinutes * 60_000,
                ).toISOString();
                schedule.mutate(
                  {
                    idempotencyKey: crypto.randomUUID(),
                    contact: { kind: 'LEAD', id: lead.id },
                    typeId: submit.id,
                    startsAt: start,
                    endsAt: end,
                    timezone: data.timezone,
                    allDay: false,
                    method,
                    details,
                    generateVideoLink: false,
                    staffUserIds: [staffUserId],
                    status: 'CONFIRMED',
                    reminders: [],
                    sendConfirmation: true,
                  },
                  { onSuccess: onClose },
                );
              }}
            >
              <Select
                label="Appointment type"
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
                options={[
                  { value: '', label: 'Choose an appointment type' },
                  ...data.types.map((type) => ({
                    value: type.id,
                    label: `${type.name} (${type.durationMinutes} min)`,
                  })),
                ]}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Staff member"
                  value={staffUserId}
                  onChange={(event) => setStaffUserId(event.target.value)}
                  options={data.staff.map((staff) => ({ value: staff.userId, label: staff.name }))}
                />
                <Input
                  label={`Start (${data.timezone})`}
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <Select
                label="Meeting method"
                value={method}
                onChange={(event) => setMethod(event.target.value as typeof method)}
                options={[
                  { value: 'IN_PERSON', label: 'In Person' },
                  { value: 'PHONE', label: 'Phone' },
                  { value: 'VIDEO', label: 'Video' },
                  { value: 'OTHER', label: 'Other' },
                ]}
              />
              <Textarea
                label="Details"
                rows={3}
                maxLength={500}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
              />
              {schedule.error ? (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(schedule.error)}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="text-sm text-muted">
              There are no appointment types or staff members available to schedule.
            </p>
          )
        }
      </PageState>
    </Modal>
  );
}
