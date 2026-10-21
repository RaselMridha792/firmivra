'use client';

import {
  type AppointmentType,
  type AppointmentTypeConfig,
  CreateAppointmentTypeRequest,
  type LocationKind,
  type MeetingMethod,
} from '@firmivra/types';
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
  Textarea,
} from '@firmivra/ui';
import { ArrowLeft, GearSix, ListChecks, Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { BackToWorkflow } from '../../../settings/workflow/_components/back-to-workflow';
import { RowMenu } from '../../../team/_components/row-menu';
import { METHOD_LABELS, NOT_LOADED, SCHEDULING } from '../../_components/appointments-parts';

const TYPES_KEY = [...SCHEDULING, 'types'];

const LOCATIONS: Record<LocationKind, string> = {
  IN_PERSON: 'In Person',
  PHONE: 'Phone',
  VIDEO: 'Zoom / Video',
};

const TYPE_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'Another appointment type already has this name.',
  FORBIDDEN: 'Only an Owner or an Admin can change appointment types.',
  NOT_FOUND: 'This type has no settings yet.',
};

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';

/**
 * Appointments > Manage Appointment Types (guide §10; no design: Quick Actions opens it): the
 * types (R12 `api.appointmentTypes`: name, length, location, client self-booking, change cutoff,
 * active or archived) with Add, Edit, Archive and Restore, and each type's settings
 * (`api.scheduling.typeConfig`: description, methods, buffers, notice, booking window, default
 * reminder). Owner and Admin change them; everyone else reads. Opened from Settings > Workflow &
 * Automations (`fromWorkflow`), Back to Workflow & Automations sits beside Back to Appointments.
 */
export function TypesScreen({ fromWorkflow = false }: { fromWorkflow?: boolean }) {
  const { role } = useFirm();
  const manages = role === 'OWNER' || role === 'ADMIN';
  const types = useApiQuery([...TYPES_KEY, 'all'], () =>
    api.appointmentTypes.list({ status: 'all' }),
  );
  const [editing, setEditing] = useState<AppointmentType | 'new' | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const toggle = useApiMutation(
    (t: AppointmentType) =>
      t.archivedAt ? api.appointmentTypes.restore(t.id) : api.appointmentTypes.archive(t.id),
    { invalidate: TYPES_KEY },
  );
  const list = types.data ?? [];
  const selected = list.find((t) => t.id === picked) ?? list.find((t) => !t.archivedAt);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link
          href="/calendar"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Appointments
        </Link>
        {fromWorkflow ? <BackToWorkflow /> : null}
      </div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <ListChecks aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              Appointment Types
            </h1>
            <p className="text-base text-link">
              The kinds of appointments clients and staff can book, and how each one works.
            </p>
          </div>
        </div>
        {manages ? (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Type
          </Button>
        ) : null}
      </header>

      {message || toggle.error ? (
        <p
          role={toggle.error ? 'alert' : 'status'}
          data-testid="types-result"
          className={`text-sm ${toggle.error ? 'text-danger' : 'text-success'}`}
        >
          {toggle.error ? errorMessage(toggle.error, TYPE_ERRORS) : message}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-[1fr_24rem]">
        <section aria-label="Appointment types" data-testid="types-list" className={card}>
          <Table
            rows={list}
            loading={types.isPending}
            rowKey={(t) => t.id}
            caption="Appointment types"
            noun="types"
            dense
            showPagination={false}
            columns={[
              {
                id: 'name',
                label: 'Name',
                cell: (t) => (
                  <button
                    type="button"
                    aria-pressed={t.id === selected?.id}
                    onClick={() => setPicked(t.id)}
                    className="text-left font-semibold text-heading hover:underline"
                  >
                    {t.name}
                  </button>
                ),
              },
              { id: 'length', label: 'Length', cell: (t) => `${t.durationMinutes} min` },
              { id: 'where', label: 'Location', cell: (t) => LOCATIONS[t.locationKind] },
              {
                id: 'book',
                label: 'Clients Can Book',
                cell: (t) => (t.clientBookable ? 'Yes' : 'No'),
              },
              {
                id: 'cutoff',
                label: 'Changes Until',
                cell: (t) =>
                  t.cancelCutoffHours ? `${t.cancelCutoffHours} h before` : 'The start',
              },
              {
                id: 'status',
                label: 'Status',
                cell: (t) =>
                  t.archivedAt ? (
                    <Badge tone="neutral">Archived</Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  ),
              },
            ]}
            rowActions={(t) =>
              manages ? (
                <RowMenu
                  label={`Actions for ${t.name}`}
                  items={[
                    { label: 'Edit', onSelect: () => setEditing(t) },
                    { label: 'Settings', onSelect: () => setPicked(t.id) },
                    {
                      label: t.archivedAt ? 'Restore' : 'Archive',
                      danger: !t.archivedAt,
                      onSelect: () =>
                        toggle.mutate(t, {
                          onSuccess: () =>
                            setMessage(
                              t.archivedAt
                                ? `${t.name} is active again.`
                                : `${t.name} is archived; past appointments keep it.`,
                            ),
                        }),
                    },
                  ]}
                />
              ) : null
            }
            emptyTitle={types.isError ? 'Types are not available' : 'No appointment types yet'}
            emptyText={
              types.isError ? NOT_LOADED : 'Add the first kind of appointment your firm offers.'
            }
          />
        </section>

        <section aria-label="Type Settings" data-testid="type-settings" className={card}>
          <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
            <GearSix aria-hidden weight="fill" className="size-5 text-action" />
            {selected ? `${selected.name} Settings` : 'Type Settings'}
          </h2>
          {selected ? (
            <TypeSettings key={selected.id} type={selected} manages={manages} />
          ) : types.isPending ? (
            <Skeleton className="h-64" />
          ) : (
            <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
              {types.isError ? NOT_LOADED : 'Choose a type to see its settings.'}
            </p>
          )}
        </section>
      </div>

      {editing ? (
        <TypeModal
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null);
            setMessage(text);
          }}
        />
      ) : null}
    </div>
  );
}

/** Add or edit a type's basics (R12): name, length, location, self-booking and change cutoff. */
function TypeModal({
  type,
  onClose,
  onDone,
}: {
  type: AppointmentType | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [name, setName] = useState(type?.name ?? '');
  const [minutes, setMinutes] = useState(String(type?.durationMinutes ?? 30));
  const [location, setLocation] = useState<LocationKind>(type?.locationKind ?? 'VIDEO');
  const [bookable, setBookable] = useState(type?.clientBookable ?? false);
  const [cutoff, setCutoff] = useState(String(type?.cancelCutoffHours ?? 24));
  const [error, setError] = useState('');
  const save = useApiMutation(
    () => {
      const body = {
        name: name.trim(),
        durationMinutes: Number(minutes),
        locationKind: location,
        clientBookable: bookable,
        cancelCutoffHours: Number(cutoff),
      };
      return type ? api.appointmentTypes.update(type.id, body) : api.appointmentTypes.create(body);
    },
    { invalidate: TYPES_KEY },
  );
  return (
    <Modal open title={type ? `Edit ${type.name}` : 'Add Appointment Type'} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const check = CreateAppointmentTypeRequest.safeParse({
            name: name.trim(),
            durationMinutes: Number(minutes),
            locationKind: location,
            clientBookable: bookable,
            cancelCutoffHours: Number(cutoff),
          });
          if (!check.success) {
            setError(
              name.trim()
                ? (check.error.issues[0]?.message ?? 'Check the fields.')
                : 'Enter a name.',
            );
            return;
          }
          setError('');
          save.mutate(undefined, {
            onSuccess: (t) => onDone(type ? `${t.name} saved.` : `${t.name} added.`),
          });
        }}
      >
        <Input
          label="Name *"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Length"
            options={[15, 30, 45, 60, 90, 120].map((m) => ({
              value: String(m),
              label: `${m} minutes`,
            }))}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <Select
            label="Location"
            options={Object.entries(LOCATIONS).map(([value, label]) => ({ value, label }))}
            value={location}
            onChange={(e) => setLocation(e.target.value as LocationKind)}
          />
        </div>
        <Checkbox
          label="Clients can book this type in the portal"
          checked={bookable}
          onChange={(e) => setBookable(e.target.checked)}
          className="text-sm"
        />
        <Select
          label="Clients can change or cancel until"
          options={[0, 2, 12, 24, 48, 72].map((h) => ({
            value: String(h),
            label: h ? `${h} hours before` : 'The start',
          }))}
          value={cutoff}
          onChange={(e) => setCutoff(e.target.value)}
        />
        {error || save.error ? (
          <p role="alert" className="text-sm text-danger">
            {error || errorMessage(save.error, TYPE_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {type ? 'Save Changes' : 'Add Type'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The type's settings beyond its basics (`typeConfig` / `setTypeConfig`). */
function TypeSettings({ type, manages }: { type: AppointmentType; manages: boolean }) {
  const config = useApiQuery([...TYPES_KEY, 'config', type.id], () =>
    api.scheduling.typeConfig(type.id),
  );
  if (config.isPending) return <Skeleton className="h-64" />;
  if (!config.data)
    return <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>;
  return (
    <SettingsForm
      key={JSON.stringify(config.data)}
      type={type}
      config={config.data}
      manages={manages}
    />
  );
}

function SettingsForm({
  type,
  config: c,
  manages,
}: {
  type: AppointmentType;
  config: AppointmentTypeConfig;
  manages: boolean;
}) {
  const [description, setDescription] = useState(c.description ?? '');
  const [methods, setMethods] = useState<MeetingMethod[]>(c.methods);
  const [before, setBefore] = useState(String(c.bufferBeforeMinutes));
  const [after, setAfter] = useState(String(c.bufferAfterMinutes));
  const [notice, setNotice] = useState(String(c.minNoticeHours));
  const [windowDays, setWindowDays] = useState(String(c.maxWindowDays));
  const [reminder, setReminder] = useState(c.defaultReminders.some((r) => r.channel === 'EMAIL'));
  const [saved, setSaved] = useState('');
  const save = useApiMutation(
    async () => {
      await api.scheduling.setTypeConfig(type.id, {
        description: description.trim() || null,
        methods,
        bufferBeforeMinutes: Number(before),
        bufferAfterMinutes: Number(after),
        minNoticeHours: Number(notice),
        maxWindowDays: Number(windowDays),
        defaultReminders: reminder ? [{ channel: 'EMAIL', amount: 1, unit: 'DAYS' }] : [],
      });
      setSaved('Settings saved.');
    },
    { invalidate: TYPES_KEY },
  );
  const minutes = (list: number[]) =>
    list.map((m) => ({ value: String(m), label: m ? `${m} min` : 'None' }));
  const off = !manages || save.isPending;
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!methods.length) return;
        save.mutate(undefined);
      }}
    >
      <Textarea
        label="Description"
        rows={2}
        maxLength={500}
        disabled={off}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-sm font-medium text-text">Meeting methods</legend>
        {(Object.entries(METHOD_LABELS) as [MeetingMethod, string][]).map(([m, label]) => (
          <Checkbox
            key={m}
            label={label}
            disabled={off}
            checked={methods.includes(m)}
            onChange={(e) =>
              setMethods(e.target.checked ? [...methods, m] : methods.filter((x) => x !== m))
            }
            className="min-h-8 text-sm"
          />
        ))}
        {methods.length ? null : <p className="text-xs text-danger">Choose at least one method.</p>}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Buffer before"
          disabled={off}
          options={minutes([0, 5, 10, 15, 30])}
          value={before}
          onChange={(e) => setBefore(e.target.value)}
        />
        <Select
          label="Buffer after"
          disabled={off}
          options={minutes([0, 5, 10, 15, 30])}
          value={after}
          onChange={(e) => setAfter(e.target.value)}
        />
        <Select
          label="Minimum notice"
          disabled={off}
          options={[0, 2, 12, 24, 48, 72].map((h) => ({
            value: String(h),
            label: h ? `${h} hours` : 'None',
          }))}
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
        />
        <Select
          label="Booking window"
          disabled={off}
          options={[14, 30, 60, 90, 180, 365].map((d) => ({
            value: String(d),
            label: `${d} days ahead`,
          }))}
          value={windowDays}
          onChange={(e) => setWindowDays(e.target.value)}
        />
      </div>
      <Checkbox
        label="Email reminder 1 day before, by default"
        disabled={off}
        checked={reminder}
        onChange={(e) => setReminder(e.target.checked)}
        className="text-sm"
      />
      {save.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error, TYPE_ERRORS)}
        </p>
      ) : saved ? (
        <p role="status" data-testid="type-settings-saved" className="text-sm text-success">
          {saved}
        </p>
      ) : null}
      {manages ? (
        <Button type="submit" className="self-end" disabled={off || !methods.length}>
          Save Settings
        </Button>
      ) : null}
    </form>
  );
}
