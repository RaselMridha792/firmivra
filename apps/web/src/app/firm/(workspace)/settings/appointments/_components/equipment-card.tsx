'use client';

import {
  CreateEquipmentRequest,
  type FirmEquipment,
  type NamedItem,
  UpdateEquipmentRequest,
} from '@firmivra/types';
import { Badge, Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { ProjectorScreen } from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { SettingsCard } from '../../_components/settings-parts';
import { RESOURCE_ERRORS, RESOURCES, upcomingLabel, useResourceChange } from './shared';

const ANY_OFFICE = 'Any office';
const officeOptions = (offices: NamedItem[]) => [
  { value: '', label: ANY_OFFICE },
  ...offices.map((o) => ({ value: o.id, label: o.name })),
];
/** The Office select's '' is "Any office" (null). */
const officeValue = (v: string | null) => v || null;

/**
 * Appointments Review 2 (A2): the equipment staff book with an appointment (Schedule
 * Appointment's Equipment), one row per physical item: an office's own, booked only for an
 * in-person appointment there, or any office's. An item holds one appointment at a time. Add,
 * Edit, Archive and Restore; an archived item keeps the appointments that hold it.
 */
export function EquipmentCard() {
  const resources = useApiQuery(RESOURCES, () => api.appointmentResources.list());
  return (
    <SettingsCard
      title="Equipment"
      subtitle="Projectors, signature pads and other items staff book with an appointment. An item goes to one appointment at a time."
      icon={ProjectorScreen}
      tone="purple"
      testId="equipment-card"
    >
      <PageState query={resources}>
        {(data) => (
          <div className="flex flex-col gap-4">
            <AddEquipment offices={data.offices} />
            <EquipmentList items={data.equipment} offices={data.offices} />
          </div>
        )}
      </PageState>
    </SettingsCard>
  );
}

function AddEquipment({ offices }: { offices: NamedItem[] }) {
  const form = useForm<CreateEquipmentRequest>({
    resolver: zodResolver(CreateEquipmentRequest),
    defaultValues: { name: '', officeId: null, description: '' },
  });
  const add = useResourceChange((body: CreateEquipmentRequest) =>
    api.appointmentResources.addEquipment(body),
  );
  return (
    <form
      noValidate
      aria-label="Add equipment"
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit((body) =>
        add.mutate(body, {
          onSuccess: () => form.reset({ name: '', officeId: null, description: '' }),
        }),
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Item name"
          data-testid="new-item-name"
          placeholder="Projector"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <Select
          label="Office"
          data-testid="new-item-office"
          hint="An office's item goes only to in-person appointments there."
          options={officeOptions(offices)}
          {...form.register('officeId', { setValueAs: officeValue })}
        />
      </div>
      <Textarea
        label="Description (optional)"
        data-testid="new-item-description"
        rows={2}
        maxLength={500}
        error={form.formState.errors.description?.message}
        {...form.register('description')}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add Equipment'}
        </Button>
        {add.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(add.error, RESOURCE_ERRORS)}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function EquipmentList({ items, offices }: { items: FirmEquipment[]; offices: NamedItem[] }) {
  const [archiving, setArchiving] = useState<FirmEquipment | null>(null);
  if (items.length === 0) {
    return <p className="text-sm text-muted">No equipment yet. Add the first item above.</p>;
  }
  const sorted = [...items].sort(
    (a, b) =>
      Number(a.archivedAt !== null) - Number(b.archivedAt !== null) || a.name.localeCompare(b.name),
  );
  return (
    <>
      <ul className="flex flex-col divide-y divide-divider rounded-card border border-border">
        {sorted.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            offices={offices}
            onArchive={() => setArchiving(item)}
          />
        ))}
      </ul>
      {archiving ? <ArchiveItem item={archiving} onClose={() => setArchiving(null)} /> : null}
    </>
  );
}

function ItemRow({
  item,
  offices,
  onArchive,
}: {
  item: FirmEquipment;
  offices: NamedItem[];
  onArchive: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const restore = useResourceChange((id: string) => api.appointmentResources.restoreEquipment(id));
  const archived = item.archivedAt !== null;
  if (editing) {
    return (
      <li data-testid="equipment-row" className="p-3">
        <EditItem item={item} offices={offices} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li data-testid="equipment-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2">
          <span data-testid="equipment-name" className="font-semibold text-heading">
            {item.name}
          </span>
          {archived ? <Badge>Archived</Badge> : null}
        </span>
        <span className="text-sm text-muted">
          {item.office?.name ?? ANY_OFFICE} · {upcomingLabel(item.upcoming)}
        </span>
        {item.description ? (
          <span className="text-sm break-words text-text">{item.description}</span>
        ) : null}
      </div>
      <span className="flex flex-wrap gap-2">
        {archived ? (
          <Button
            variant="secondary"
            aria-label={`Restore ${item.name}`}
            disabled={restore.isPending}
            onClick={() => restore.mutate(item.id)}
          >
            Restore
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              aria-label={`Edit ${item.name}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button variant="secondary" aria-label={`Archive ${item.name}`} onClick={onArchive}>
              Archive
            </Button>
          </>
        )}
      </span>
      {restore.error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {errorMessage(restore.error, RESOURCE_ERRORS)}
        </p>
      ) : null}
    </li>
  );
}

function EditItem({
  item,
  offices,
  onDone,
}: {
  item: FirmEquipment;
  offices: NamedItem[];
  onDone: () => void;
}) {
  const form = useForm<UpdateEquipmentRequest>({
    resolver: zodResolver(UpdateEquipmentRequest),
    defaultValues: {
      name: item.name,
      officeId: item.office?.id ?? null,
      description: item.description ?? '',
    },
  });
  const save = useResourceChange((body: UpdateEquipmentRequest) =>
    api.appointmentResources.updateEquipment(item.id, body),
  );
  return (
    <form
      noValidate
      aria-label={`Edit ${item.name}`}
      className="flex flex-col gap-3"
      onSubmit={form.handleSubmit((body) => save.mutate(body, { onSuccess: onDone }))}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Item name"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <Select
          label="Office"
          options={officeOptions(offices)}
          {...form.register('officeId', { setValueAs: officeValue })}
        />
      </div>
      <Textarea
        label="Description (optional)"
        rows={2}
        maxLength={500}
        error={form.formState.errors.description?.message}
        {...form.register('description')}
      />
      {item.upcoming > 0 ? (
        <p className="text-sm text-muted">
          Its {upcomingLabel(item.upcoming).toLowerCase()} keep it; a new office applies to new
          bookings.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, RESOURCE_ERRORS)}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function ArchiveItem({ item, onClose }: { item: FirmEquipment; onClose: () => void }) {
  const archive = useResourceChange((id: string) => api.appointmentResources.archiveEquipment(id));
  return (
    <Modal
      open
      title={`Archive ${item.name}?`}
      subtitle={item.office?.name ?? ANY_OFFICE}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={archive.isPending}
            onClick={() => archive.mutate(item.id, { onSuccess: onClose })}
          >
            {archive.isPending ? 'Archiving…' : 'Archive Equipment'}
          </Button>
        </>
      }
    >
      <div className="flex max-w-md flex-col gap-2 text-sm text-text">
        <p>
          It is no longer offered for new appointments, and its name is free for a new item. You can
          restore it later while no live item has its name.
        </p>
        <p>
          {item.upcoming === 0
            ? 'No upcoming appointments hold it.'
            : `Its ${upcomingLabel(item.upcoming).toLowerCase()} keep it.`}
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
