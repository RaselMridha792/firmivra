'use client';

import { CancelMyAppointmentRequest, type MyAppointment, type MySlot } from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { FreeTimes } from './free-times';
import { APPOINTMENT_ERRORS, LOCATION_LABELS, myAppointmentsKey, today, when } from './shared';

/** The client's scheduled appointments, soonest first, with Reschedule and Cancel until the cutoff. */
export function UpcomingAppointments({ slug }: { slug: string }) {
  const upcoming = useApiQuery([...myAppointmentsKey(slug), 'upcoming'], () =>
    api.myAppointments(slug).list({ when: 'upcoming' }),
  );
  const [notice, setNotice] = useState('');
  return (
    <Card title="Upcoming appointments">
      {notice ? (
        <p role="status" className="mb-3 text-sm font-medium text-success">
          {notice}
        </p>
      ) : null}
      <PageState query={upcoming} empty="You have no upcoming appointments.">
        {(items) => (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <Upcoming key={item.id} slug={slug} item={item} onChanged={setNotice} />
            ))}
          </ul>
        )}
      </PageState>
    </Card>
  );
}

function Upcoming({
  slug,
  item,
  onChanged,
}: {
  slug: string;
  item: MyAppointment;
  onChanged: (notice: string) => void;
}) {
  const [action, setAction] = useState<'reschedule' | 'cancel' | null>(null);
  const done = (notice: string) => () => {
    setAction(null);
    onChanged(notice);
  };
  const details = item.locationDetails;
  return (
    <li data-testid="my-appointment" className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-heading">{item.type?.name ?? 'Appointment'}</p>
          <p className="text-text">{when(item.startsAt)}</p>
          <p className="text-muted">
            {LOCATION_LABELS[item.locationKind]} with {item.staffName}
            {details?.startsWith('https://') ? (
              <a
                href={details}
                target="_blank"
                rel="noreferrer"
                className="ml-2 break-all text-link"
              >
                Join link
              </a>
            ) : details ? (
              ` · ${details}`
            ) : null}
          </p>
        </div>
        {item.changeableUntil ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setAction(action === 'reschedule' ? null : 'reschedule')}
            >
              Reschedule
            </Button>
            <Button
              variant="ghost"
              onClick={() => setAction(action === 'cancel' ? null : 'cancel')}
            >
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        {item.changeableUntil
          ? `You can change this online until ${when(item.changeableUntil)}.`
          : 'To change this appointment, please contact us.'}
      </p>
      {action === 'reschedule' && item.type ? (
        <Reschedule
          slug={slug}
          item={item}
          typeId={item.type.id}
          onDone={done('Your appointment was moved.')}
        />
      ) : null}
      {action === 'cancel' ? (
        <Cancel slug={slug} id={item.id} onDone={done('Your appointment was cancelled.')} />
      ) : null}
    </li>
  );
}

function Reschedule({
  slug,
  item,
  typeId,
  onDone,
}: {
  slug: string;
  item: MyAppointment;
  typeId: string;
  onDone: () => void;
}) {
  const [first] = useState(today);
  // Start at the appointment's own day (the client's calendar date), never before today.
  const [date, setDate] = useState(() => {
    const day = new Intl.DateTimeFormat('en-CA').format(new Date(item.startsAt));
    return day < first ? first : day;
  });
  const [picked, setPicked] = useState<MySlot | null>(null);
  const [round, setRound] = useState(0);
  const move = useApiMutation(
    (slot: MySlot) => api.myAppointments(slug).reschedule(item.id, { startsAt: slot.startsAt }),
    { invalidate: myAppointmentsKey(slug) },
  );
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-canvas p-4">
      <FreeTimes
        slug={slug}
        typeId={typeId}
        excludeAppointmentId={item.id}
        date={date}
        min={first}
        picked={picked}
        round={round}
        onDate={(next) => {
          setDate(next);
          setPicked(null);
        }}
        onPick={setPicked}
      />
      <Button
        disabled={!picked || move.isPending}
        onClick={() =>
          picked &&
          move.mutate(picked, {
            onSuccess: onDone,
            onError: (error) => {
              if (errorCode(error) !== 'SLOT_TAKEN' && errorCode(error) !== 'SLOT_UNAVAILABLE')
                return;
              setPicked(null);
              setRound(round + 1);
            },
          })
        }
      >
        {move.isPending
          ? 'Moving…'
          : picked
            ? `Move to ${when(picked.startsAt)}`
            : 'Pick a new time'}
      </Button>
      {move.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(move.error, APPOINTMENT_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}

function Cancel({ slug, id, onDone }: { slug: string; id: string; onDone: () => void }) {
  const form = useForm({
    resolver: zodResolver(CancelMyAppointmentRequest),
    defaultValues: { reason: '' },
  });
  const cancel = useApiMutation(
    (body: CancelMyAppointmentRequest) => api.myAppointments(slug).cancel(id, body),
    { invalidate: myAppointmentsKey(slug) },
  );
  return (
    <form
      onSubmit={form.handleSubmit((body) => cancel.mutate(body, { onSuccess: onDone }))}
      noValidate
      className="flex flex-col items-start gap-3 rounded-card border border-border bg-canvas p-4"
    >
      <div className="w-full">
        <Input
          label="Reason (optional)"
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
      </div>
      <Button type="submit" disabled={cancel.isPending}>
        {cancel.isPending ? 'Cancelling…' : 'Cancel this appointment'}
      </Button>
      {cancel.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(cancel.error, APPOINTMENT_ERRORS)}
        </p>
      ) : null}
    </form>
  );
}
