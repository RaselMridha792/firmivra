'use client';

import type { BookableType, MySlot } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useState } from 'react';
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
  TAKEN,
  today,
  when,
} from './shared';

/** Booking answers 404 for a kind of appointment that is no longer offered. */
const TYPE_GONE = new Set(['NOT_FOUND', 'TYPE_ARCHIVED']);
const BOOKING_ERRORS = {
  ...APPOINTMENT_ERRORS,
  NOT_FOUND: 'This kind of appointment is no longer offered.',
};

/**
 * "Schedule an Appointment": a modal with the booking steps (a kind of appointment, then a free
 * time, then confirm). `date` starts the day picker on a day picked in the month calendar.
 */
export function ScheduleModal({
  slug,
  open,
  date,
  onClose,
  onBooked,
}: {
  slug: string;
  open: boolean;
  date?: string;
  onClose: () => void;
  /** Booked: the page says so above the list. */
  onBooked: (text: string) => void;
}) {
  return (
    <Modal open={open} title="Schedule an Appointment" onClose={onClose}>
      {open ? <BookableTypes slug={slug} date={date} onBooked={onBooked} /> : null}
    </Modal>
  );
}

function BookableTypes({
  slug,
  date,
  onBooked,
}: {
  slug: string;
  date?: string;
  onBooked: (text: string) => void;
}) {
  const types = useApiQuery([...myAppointmentsKey(slug), 'types'], () =>
    api.myAppointments(slug).types(),
  );
  return (
    <PageState query={types} empty="There are no appointments to book online. Please contact us.">
      {(list) => (
        <Booking
          slug={slug}
          types={list}
          initialDate={date}
          onBooked={onBooked}
          onTypeGone={() => void types.refetch()}
        />
      )}
    </PageState>
  );
}

function Booking({
  slug,
  types,
  initialDate,
  onBooked,
  onTypeGone,
}: {
  slug: string;
  types: BookableType[];
  initialDate?: string;
  onBooked: (text: string) => void;
  onTypeGone: () => void;
}) {
  const [first] = useState(today);
  const [type, setType] = useState<BookableType | null>(null);
  const [date, setDate] = useState(() =>
    initialDate && initialDate > first ? initialDate : first,
  );
  const [picked, setPicked] = useState<MySlot | null>(null);
  const [round, setRound] = useState(0);
  const book = useApiMutation(
    (slot: MySlot) =>
      api.myAppointments(slug).book({ typeId: type?.id ?? '', startsAt: slot.startsAt }),
    { invalidate: myAppointmentsKey(slug) },
  );
  const choose = (next: BookableType) => {
    setType(next);
    setPicked(null);
    book.reset();
  };
  const confirm = (slot: MySlot) =>
    book.mutate(slot, {
      onSuccess: (appointment) => {
        onBooked(
          `Booked: ${appointment.type?.name ?? 'Appointment'}, ${when(appointment.startsAt)}.`,
        );
      },
      onError: (error) => {
        const code = errorCode(error) ?? '';
        if (TYPE_GONE.has(code)) {
          setType(null);
          setPicked(null);
          onTypeGone();
          return;
        }
        if (!TAKEN.has(code)) return;
        setPicked(null);
        setRound(round + 1);
      },
    });

  return (
    <div className="flex flex-col gap-4">
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
          min={firstDay(first)}
          picked={picked}
          round={round}
          onDate={(next) => {
            setDate(next);
            setPicked(null);
            book.reset();
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
          {errorMessage(book.error, BOOKING_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
