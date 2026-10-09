'use client';

import type { AppointmentType, LocationKind, MemberAvailability, Slot } from '@firmivra/types';
import { Button, Input, Select } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { APPOINTMENTS, CALENDAR, CALENDAR_ERRORS } from './shared';
import { SlotPicker } from './slot-picker';
import { timeLabel } from './time';

const DETAILS_LABEL: Record<LocationKind, string> = {
  IN_PERSON: 'Address',
  PHONE: 'Phone number',
  VIDEO: 'Video link',
};

interface NewProps {
  timeZone: string;
  members: MemberAvailability[];
  /** The day the free times open on. */
  date: string;
  onDone: () => void;
}

/**
 * Books an appointment for a client at a free time of a type, with one staff member or anyone
 * free. Staff see only their own clients (the API decides). A taken time says so and reloads.
 */
export function NewAppointment(props: NewProps) {
  const types = useApiQuery([...APPOINTMENTS, 'types'], () => api.appointmentTypes.list());
  return (
    <PageState query={types} empty="Add an appointment type first.">
      {(list) => <BookingForm types={list} {...props} />}
    </PageState>
  );
}

function BookingForm({
  types,
  timeZone,
  members,
  date: firstDate,
  onDone,
}: NewProps & { types: AppointmentType[] }) {
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [staff, setStaff] = useState('');
  const [date, setDate] = useState(firstDate);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [round, setRound] = useState(0);
  const [details, setDetails] = useState('');
  const clients = useApiQuery(['clients', 'pick', search], () =>
    api.clients.list({ ...(search ? { search } : {}), limit: 20 }),
  );
  const book = useApiMutation(
    (slot: Slot) =>
      api.appointments.book({
        clientId,
        staffUserId: slot.staff.userId,
        typeId,
        startsAt: slot.startsAt,
        locationDetails: details,
      }),
    { invalidate: CALENDAR },
  );
  const type = types.find((item) => item.id === typeId);
  const unpick = () => setPicked(null);

  return (
    <div className="flex flex-col gap-4">
      <Input
        label="Find a client"
        type="search"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          // A new search must not keep a client the list no longer shows.
          setClientId('');
        }}
      />
      <PageState query={clients}>
        {({ items }) =>
          items.length ? (
            <Select
              label="Client"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              options={[
                { value: '', label: 'Choose a client' },
                ...items.map((client) => ({ value: client.id, label: client.displayName })),
              ]}
            />
          ) : (
            <p className="text-sm text-muted">No clients match.</p>
          )
        }
      </PageState>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Type"
          value={typeId}
          onChange={(event) => {
            setTypeId(event.target.value);
            unpick();
          }}
          options={types.map((item) => ({
            value: item.id,
            label: `${item.name} (${item.durationMinutes} min)`,
          }))}
        />
        <Select
          label="Staff"
          value={staff}
          onChange={(event) => {
            setStaff(event.target.value);
            unpick();
          }}
          options={[
            { value: '', label: 'Anyone free' },
            ...members.map(({ member }) => ({ value: member.userId, label: member.name })),
          ]}
        />
      </div>
      <SlotPicker
        typeId={typeId}
        {...(staff ? { staffUserId: staff } : {})}
        timeZone={timeZone}
        date={date}
        picked={picked}
        round={round}
        onDate={(next) => {
          setDate(next);
          unpick();
        }}
        onPick={setPicked}
      />
      <Input
        label={type ? DETAILS_LABEL[type.locationKind] : 'Where'}
        maxLength={500}
        value={details}
        onChange={(event) => setDetails(event.target.value)}
      />
      <Button
        disabled={!picked || !clientId || book.isPending}
        onClick={() =>
          picked &&
          book.mutate(picked, {
            onSuccess: onDone,
            onError: (error) => {
              if (errorCode(error) !== 'SLOT_TAKEN') return;
              unpick();
              setRound(round + 1);
            },
          })
        }
      >
        {book.isPending
          ? 'Booking…'
          : !clientId
            ? 'Choose a client'
            : picked
              ? `Book ${timeLabel(picked.startsAt, timeZone)}`
              : 'Pick a free time'}
      </Button>
      {book.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(book.error, CALENDAR_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
