'use client';

import { CancelAppointmentRequest } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { CALENDAR, CALENDAR_ERRORS } from './shared';

/** Cancels an appointment, with an optional reason the history keeps. */
export function CancelForm({ id, onDone }: { id: string; onDone: () => void }) {
  const form = useForm({
    resolver: zodResolver(CancelAppointmentRequest),
    defaultValues: { reason: '' },
  });
  const cancel = useApiMutation(
    (body: CancelAppointmentRequest) => api.appointments.cancel(id, body),
    { invalidate: CALENDAR },
  );
  return (
    <form
      onSubmit={form.handleSubmit((body) => cancel.mutate(body, { onSuccess: onDone }))}
      noValidate
      className="flex flex-col items-start gap-3 rounded-card border border-border p-4"
    >
      <div className="w-full">
        <Input
          label="Reason (optional)"
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
      </div>
      <Button type="submit" disabled={cancel.isPending}>
        {cancel.isPending ? 'Cancelling…' : 'Cancel appointment'}
      </Button>
      {cancel.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(cancel.error, CALENDAR_ERRORS)}
        </p>
      ) : null}
    </form>
  );
}
