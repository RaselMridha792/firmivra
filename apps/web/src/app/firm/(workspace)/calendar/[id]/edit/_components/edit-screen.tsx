'use client';

import { Skeleton } from '@firmivra/ui';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import { NOT_LOADED, SCHEDULING } from '../../../_components/appointments-parts';
import { ScheduleForm, ScheduleHeader } from '../../../_components/schedule-form';

const EDIT_ERRORS: Record<string, string> = {
  NOT_FOUND:
    'This appointment was not found. It may have been removed, or you may not have access.',
};

/**
 * Edit Existing (appointments-overview-and-calendar.jpg, guide §11, §17): the Schedule Appointment
 * form filled from the record (`api.scheduling.record`), saved into the same appointment with its
 * `version` (`updateDetails`; 409 SAVE_CONFLICT explained). A change of time, staff, place or link
 * sends the client an update notice (API).
 */
export function EditScreen({ id }: { id: string }) {
  const record = useApiQuery([...SCHEDULING, 'record', id], () => api.scheduling.record(id));
  if (record.data) return <ScheduleForm key={record.data.version} record={record.data} />;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ScheduleHeader editing />
      {record.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <p
          data-testid="edit-unavailable"
          className="rounded-xl border border-divider bg-surface p-6 text-sm text-muted shadow-sm"
        >
          {errorMessage(record.error, { ...EDIT_ERRORS, INTERNAL_ERROR: NOT_LOADED })}
        </p>
      )}
    </div>
  );
}
