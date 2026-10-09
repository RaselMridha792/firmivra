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
import {
  APPOINTMENT_ERRORS,
  firstDay,
  LOCATION_LABELS,
  myAppointmentsKey,
  STALE,
  TAKEN,
  today,
  when,
} from './shared';

/** A line above the list: what just changed, or why a change could not be made. */
type Notice = { text: string; failed: boolean };

/** The client's scheduled appointments, soonest first, with Reschedule and Cancel until the cutoff. */
export function UpcomingAppointments({ slug }: { slug: string }) {
  const upcoming = useApiQuery([...myAppointmentsKey(slug), 'upcoming'], () =>
    api.myAppointments(slug).list({ when: 'upcoming' }),
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  return (
    <Card title="Upcoming appointments">
      {notice ? (
        <p
          role={notice.failed ? 'alert' : 'status'}
          className={`mb-3 text-sm font-medium ${notice.failed ? 'text-danger' : 'text-success'}`}
        >
          {notice.text}
        </p>
      ) : null}
      <PageState query={upcoming} empty="You have no upcoming appointments.">
        {(items) => (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <Upcoming
                key={item.id}
                slug={slug}
                item={item}
                onNotice={setNotice}
                onStale={(error) => {
                  setNotice({ text: errorMessage(error, APPOINTMENT_ERRORS), failed: true });
                  void upcoming.refetch();
                }}
              />
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
  onNotice,
  onStale,
}: {
  slug: string;
  item: MyAppointment;
  onNotice: (notice: Notice | null) => void;
  /** The cutoff passed or the firm changed it meanwhile: say why and refresh the list. */
  onStale: (error: unknown) => void;
}) {
  const [action, setAction] = useState<'reschedule' | 'cancel' | null>(null);
  const open = (next: 'reschedule' | 'cancel') => {
    setAction(action === next ? null : next);
    onNotice(null);
  };
  const done = (text: string) => () => {
    setAction(null);
    onNotice({ text, failed: false });
  };
  const stale = (error: unknown) => {
    setAction(null);
    onStale(error);
  };
  const details = item.locationDetails;
  return (
    <li data-testid="my-appointment" className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-heading">{item.type?.name ?? 'Appointment'}</p>
          <p className="text-text">{when(item.startsAt)}</p>
          <p className="break-words text-muted">
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
            {/* Free times are per kind of appointment: one without a kind can only be cancelled. */}
            {item.type ? (
              <Button variant="outline" onClick={() => open('reschedule')}>
                Reschedule
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => open('cancel')}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        {!item.changeableUntil
          ? 'To change this appointment, please contact us.'
          : item.type
            ? `You can change this online until ${when(item.changeableUntil)}.`
            : `You can cancel this online until ${when(item.changeableUntil)}. To move it, please contact us.`}
      </p>
      {action === 'reschedule' && item.type ? (
        <Reschedule
          slug={slug}
          item={item}
          typeId={item.type.id}
          onDone={done('Your appointment was moved.')}
          onStale={stale}
        />
      ) : null}
      {action === 'cancel' ? (
        <Cancel
          slug={slug}
          id={item.id}
          onDone={done('Your appointment was cancelled.')}
          onStale={stale}
        />
      ) : null}
    </li>
  );
}

function Reschedule({
  slug,
  item,
  typeId,
  onDone,
  onStale,
}: {
  slug: string;
  item: MyAppointment;
  typeId: string;
  onDone: () => void;
  onStale: (error: unknown) => void;
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
        current={item.startsAt}
        date={date}
        min={firstDay(first)}
        picked={picked}
        round={round}
        onDate={(next) => {
          setDate(next);
          setPicked(null);
          move.reset();
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
              const code = errorCode(error) ?? '';
              if (STALE.has(code)) return onStale(error);
              if (!TAKEN.has(code)) return;
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

function Cancel({
  slug,
  id,
  onDone,
  onStale,
}: {
  slug: string;
  id: string;
  onDone: () => void;
  onStale: (error: unknown) => void;
}) {
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
      onSubmit={form.handleSubmit((body) =>
        cancel.mutate(body, {
          onSuccess: onDone,
          onError: (error) => (STALE.has(errorCode(error) ?? '') ? onStale(error) : undefined),
        }),
      )}
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
