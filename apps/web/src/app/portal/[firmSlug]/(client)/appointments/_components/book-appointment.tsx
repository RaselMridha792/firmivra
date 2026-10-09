'use client';

import type { BookableType, MySlot } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { FreeTimes } from './free-times';
import { APPOINTMENT_ERRORS, LOCATION_LABELS, myAppointmentsKey, today, when } from './shared';

const RETRY = new Set(['SLOT_TAKEN', 'SLOT_UNAVAILABLE']);

/** Book: pick a kind of appointment, then a free time, then confirm. */
export function BookAppointment({ slug }: { slug: string }) {
  const types = useApiQuery([...myAppointmentsKey(slug), 'types'], () =>
    api.myAppointments(slug).types(),
  );
  return (
    <Card title="Book an appointment">
      <PageState query={types} empty="There are no appointments to book online. Please contact us.">
        {(list) => <Booking slug={slug} types={list} />}
      </PageState>
    </Card>
  );
}

function Booking({ slug, types }: { slug: string; types: BookableType[] }) {
  const [first] = useState(today);
  const [type, setType] = useState<BookableType | null>(null);
  const [date, setDate] = useState(first);
  const [picked, setPicked] = useState<MySlot | null>(null);
  const [round, setRound] = useState(0);
  const [booked, setBooked] = useState('');
  const book = useApiMutation(
    (slot: MySlot) =>
      api.myAppointments(slug).book({ typeId: type?.id ?? '', startsAt: slot.startsAt }),
    { invalidate: myAppointmentsKey(slug) },
  );
  const choose = (next: BookableType) => {
    setType(next);
    setPicked(null);
    setBooked('');
  };
  const confirm = (slot: MySlot) =>
    book.mutate(slot, {
      onSuccess: (appointment) => {
        setBooked(
          `Booked: ${appointment.type?.name ?? 'Appointment'}, ${when(appointment.startsAt)}.`,
        );
        setType(null);
        setPicked(null);
      },
      onError: (error) => {
        if (!RETRY.has(errorCode(error) ?? '')) return;
        setPicked(null);
        setRound(round + 1);
      },
    });

  return (
    <div className="flex flex-col gap-4">
      {booked ? (
        <p role="status" className="text-sm font-medium text-success">
          {booked}
        </p>
      ) : null}
      <div role="group" aria-label="Kind of appointment" className="grid gap-3 sm:grid-cols-2">
        {types.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={type?.id === item.id}
            onClick={() => choose(item)}
            className={`rounded-card border p-4 text-left ${type?.id === item.id ? 'border-action bg-accent-soft' : 'border-border bg-surface hover:bg-canvas'}`}
          >
            <span className="block font-semibold text-heading">{item.name}</span>
            <span className="block text-sm text-muted">
              {item.durationMinutes} minutes · {LOCATION_LABELS[item.locationKind]}
            </span>
          </button>
        ))}
      </div>
      {type ? (
        <FreeTimes
          slug={slug}
          typeId={type.id}
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
      ) : null}
      {type && picked ? (
        <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-canvas p-4">
          <p className="text-sm text-text">
            {type.name} · {when(picked.startsAt)}
          </p>
          <Button onClick={() => confirm(picked)} disabled={book.isPending}>
            {book.isPending ? 'Booking…' : 'Confirm booking'}
          </Button>
        </div>
      ) : null}
      {book.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(book.error, APPOINTMENT_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
