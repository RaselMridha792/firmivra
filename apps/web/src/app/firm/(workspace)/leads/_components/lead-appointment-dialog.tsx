'use client';

import { type LeadRow, type ScheduleAppointmentRequest } from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { toInstant } from '../../calendar/_components/time';
import { zoneName } from '../[id]/_components/profile-shared';
import { scheduleErrorText } from './lead-appointment';
import { LEAD_PIPELINE_KEY } from './lead-shared';

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
                // In the firm's time zone (Leads time zone, DECISIONS Nov 16).
                const start = toInstant(
                  startsAt.slice(0, 10),
                  startsAt.slice(11, 16),
                  data.timezone,
                );
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
              {/* The lead's saved contact details, as the booking uses them (L12). */}
              <dl aria-label="Lead contact" className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Phone</dt>
                  <dd className="text-text">{lead.phone ?? 'Not on file'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted">Email</dt>
                  <dd className="break-all text-text">{lead.email}</dd>
                </div>
              </dl>
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
                  label={`Start (${zoneName(data.timezone)})`}
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
                  {scheduleErrorText(schedule.error)}
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
