'use client';

import {
  CreateRoomRequest,
  type FirmRoom,
  type NamedItem,
  UpdateRoomRequest,
} from '@firmivra/types';
import { Badge, Button, Input, Modal, Select } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Door } from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { SettingsCard } from '../../_components/settings-parts';
import { RESOURCE_ERRORS, RESOURCES, upcomingLabel, useResourceChange } from './shared';

/**
 * Appointments Review 2 (A2): the rooms of each office that an in-person appointment can book
 * (Schedule Appointment's Room). Add, Rename, Archive. A room's archive is final (the API keeps
 * it): it is offered no more, and the appointments that hold it keep it.
 */
export function RoomsCard() {
  const resources = useApiQuery(RESOURCES, () => api.appointmentResources.list());
  return (
    <SettingsCard
      title="Rooms"
      subtitle="The rooms of each office that an in-person appointment can book. A room holds one appointment at a time."
      icon={Door}
      testId="rooms-card"
    >
      <PageState query={resources}>
        {(data) => (
          <div className="flex flex-col gap-4">
            <AddRoom offices={data.offices} />
            <RoomList rooms={data.rooms} />
          </div>
        )}
      </PageState>
    </SettingsCard>
  );
}

function AddRoom({ offices }: { offices: NamedItem[] }) {
  const form = useForm<CreateRoomRequest>({
    resolver: zodResolver(CreateRoomRequest),
    defaultValues: { officeId: offices[0]?.id ?? '', name: '' },
  });
  const add = useResourceChange((body: CreateRoomRequest) =>
    api.appointmentResources.addRoom(body),
  );
  if (offices.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="rooms-no-office">
        Add an office in Settings &gt; Locations first. A room belongs to one office.
      </p>
    );
  }
  return (
    <form
      noValidate
      aria-label="Add a room"
      className="flex flex-col gap-3 sm:flex-row sm:items-start"
      onSubmit={form.handleSubmit((body) =>
        add.mutate(body, { onSuccess: () => form.reset({ officeId: body.officeId, name: '' }) }),
      )}
    >
      <div className="sm:w-56">
        <Select
          label="Office"
          data-testid="new-room-office"
          options={offices.map((o) => ({ value: o.id, label: o.name }))}
          error={form.formState.errors.officeId?.message}
          {...form.register('officeId')}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Input
          label="Room name"
          data-testid="new-room-name"
          placeholder="Conference Room 3"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
      </div>
      <Button type="submit" className="sm:mt-6" disabled={add.isPending}>
        {add.isPending ? 'Adding…' : 'Add Room'}
      </Button>
      {add.error ? (
        <p role="alert" className="text-sm text-danger sm:basis-full">
          {errorMessage(add.error, RESOURCE_ERRORS)}
        </p>
      ) : null}
    </form>
  );
}

function RoomList({ rooms }: { rooms: FirmRoom[] }) {
  const [archiving, setArchiving] = useState<FirmRoom | null>(null);
  if (rooms.length === 0) {
    return <p className="text-sm text-muted">No rooms yet. Add the first one above.</p>;
  }
  // Live rooms first, by office; archived ones last.
  const sorted = [...rooms].sort(
    (a, b) =>
      Number(a.archivedAt !== null) - Number(b.archivedAt !== null) ||
      a.office.name.localeCompare(b.office.name) ||
      a.name.localeCompare(b.name),
  );
  return (
    <>
      <ul className="flex flex-col divide-y divide-divider rounded-card border border-border">
        {sorted.map((room) => (
          <RoomRow key={room.id} room={room} onArchive={() => setArchiving(room)} />
        ))}
      </ul>
      {archiving ? <ArchiveRoom room={archiving} onClose={() => setArchiving(null)} /> : null}
    </>
  );
}

function RoomRow({ room, onArchive }: { room: FirmRoom; onArchive: () => void }) {
  const [editing, setEditing] = useState(false);
  const form = useForm<UpdateRoomRequest>({
    resolver: zodResolver(UpdateRoomRequest),
    defaultValues: { name: room.name },
  });
  const rename = useResourceChange((body: UpdateRoomRequest) =>
    api.appointmentResources.renameRoom(room.id, body),
  );
  const archived = room.archivedAt !== null;
  return (
    <li data-testid="room-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      {editing ? (
        <form
          noValidate
          aria-label={`Rename ${room.name}`}
          className="flex min-w-0 flex-1 flex-wrap items-start gap-2"
          onSubmit={form.handleSubmit((body) =>
            rename.mutate(body, { onSuccess: () => setEditing(false) }),
          )}
        >
          <div className="min-w-0 flex-1">
            <Input
              label={`New name for ${room.name}`}
              hideLabel
              error={form.formState.errors.name?.message}
              {...form.register('name')}
            />
          </div>
          <Button type="submit" disabled={rename.isPending}>
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              form.reset({ name: room.name });
              rename.reset();
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          {rename.error ? (
            <p role="alert" className="w-full text-sm text-danger">
              {errorMessage(rename.error, RESOURCE_ERRORS)}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span data-testid="room-name" className="font-semibold text-heading">
              {room.name}
            </span>
            {archived ? <Badge>Archived</Badge> : null}
          </span>
          <span className="text-sm text-muted">
            {room.office.name} · {upcomingLabel(room.upcoming)}
          </span>
        </div>
      )}
      {!editing && !archived ? (
        <span className="flex gap-2">
          <Button
            variant="ghost"
            aria-label={`Rename ${room.name}`}
            onClick={() => setEditing(true)}
          >
            Rename
          </Button>
          <Button variant="secondary" aria-label={`Archive ${room.name}`} onClick={onArchive}>
            Archive
          </Button>
        </span>
      ) : null}
    </li>
  );
}

/** Archiving a room is final, so it asks first and says what stays. */
function ArchiveRoom({ room, onClose }: { room: FirmRoom; onClose: () => void }) {
  const archive = useResourceChange((id: string) => api.appointmentResources.archiveRoom(id));
  return (
    <Modal
      open
      title={`Archive ${room.name}?`}
      subtitle={room.office.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={archive.isPending}
            onClick={() => archive.mutate(room.id, { onSuccess: onClose })}
          >
            {archive.isPending ? 'Archiving…' : 'Archive Room'}
          </Button>
        </>
      }
    >
      <div className="flex max-w-md flex-col gap-2 text-sm text-text">
        <p>
          This is final: the room is no longer offered for new appointments and can&apos;t be
          restored. Its name stays with it, so a new room in this office needs another name.
        </p>
        <p>
          {room.upcoming === 0
            ? 'No upcoming appointments hold it.'
            : `Its ${upcomingLabel(room.upcoming).toLowerCase()} keep it.`}
        </p>
        {archive.error ? (
          <p role="alert" className="text-danger">
            {errorMessage(archive.error, RESOURCE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
