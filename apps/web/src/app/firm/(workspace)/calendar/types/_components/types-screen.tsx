'use client';

import {
  ApiRequestError,
  type AppointmentType,
  type AppointmentTypeConfig,
  CreateAppointmentTypeRequest,
  type LocationKind,
  type MeetingMethod,
  publicItemUrl,
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
import { PublicLinkSection } from '../../../../../../components/public-link';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { publicLinkText } from '../../../../../../lib/public-link';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { BackToWorkflow } from '../../../settings/workflow/_components/back-to-workflow';
import { RowMenu } from '../../../team/_components/row-menu';
import { METHOD_LABELS, NOT_LOADED, SCHEDULING } from '../../_components/appointments-parts';
import { TypeReminders } from './type-reminders';
import {
  reminderRowsProblem,
  remindersFromRows,
  rowsFromReminders,
  type ReminderRow,
} from './type-reminders-model';

const TYPES_KEY = [...SCHEDULING, 'types'];

const LOCATIONS: Record<LocationKind, string> = {
  IN_PERSON: 'In Person',
  PHONE: 'Phone',
  VIDEO: 'Zoom / Video',
};

/** The settings fields an API error can name, in the order shown. */
const SETTING_FIELDS = {
  description: 'Description',
  methods: 'Meeting methods',
  otherVideoPlatform: 'Video platform',
  bufferBeforeMinutes: 'Buffer before',
  bufferAfterMinutes: 'Buffer after',
  minNoticeHours: 'Minimum notice',
  maxWindowDays: 'Booking window',
  defaultReminders: 'Default reminders',
  requiredIntakeFormId: 'Required intake form',
} as const;
type SettingField = keyof typeof SETTING_FIELDS;

const TYPE_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'Another appointment type already has this name.',
  FORBIDDEN: 'Only an Owner or an Admin can change appointment types.',
  NOT_FOUND: 'This type has no settings yet.',
};

const card =
  'flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm';

type Tone = 'success' | 'warning' | 'error';
const TONE: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
};

/** Review 2 (row 3): whether a type's booking link takes bookings, as the API says it. */
const linkState = (t: AppointmentType) =>
  t.archivedAt ? 'ARCHIVED' : t.clientBookable ? 'LIVE' : 'HIDDEN';

/**
 * Octavia's A3 and Review 2 (P1 row 2): how far ahead clients can book: 2, 6 or 12 hours (kept in
 * hours), then whole days (1 to 730; 730 is no limit). A choice is "h6" or "d3".
 */
const WINDOW_HOURS = [2, 6, 12];
const WINDOW_DAYS = [1, 3, 5, 7, 14, 30, 60, 90, 180, 365, 730];
const windowLabel = (d: number) =>
  d === 730 ? 'No limit' : d === 1 ? '1 day ahead (24 hours)' : `${d} days ahead`;
const windowChoices = (current: string) => {
  const hours = WINDOW_HOURS.map((h) => ({ value: `h${h}`, label: `${h} hours ahead` }));
  const days = WINDOW_DAYS.map((d) => ({ value: `d${d}`, label: windowLabel(d) }));
  const all = [...hours, ...days];
  // The saved value stays a choice when it is not one of the presets, so the select never lies.
  if (!all.some((c) => c.value === current)) {
    const n = Number(current.slice(1));
    all.push({
      value: current,
      label: current.startsWith('h') ? `${n} hours ahead` : windowLabel(n),
    });
  }
  return all;
};
/** The saved value stays a choice when it is not one of the presets, so the select never lies. */
const withCurrent = (presets: number[], current: number) =>
  Number.isFinite(current) && !presets.includes(current)
    ? [...presets, current].sort((a, b) => a - b)
    : presets;

/**
 * Appointments > Manage Appointment Types (guide §10; no design: Quick Actions opens it): the
 * types (R12 `api.appointmentTypes`: name, length, location, client self-booking, change cutoff,
 * active or archived) with Add, Edit, Archive and Restore, and each type's settings
 * (`api.scheduling.typeConfig`: description, methods, buffers, notice, booking window, default
 * reminder). Owner and Admin change them; everyone else reads. Opened from Settings > Workflow &
 * Automations (`fromWorkflow`), Back to Workflow & Automations sits beside Back to Appointments.
 * Review 2 (row 3): every type's menu has Copy Booking Link (`portalBase`, the portal's address
 * from config) and Copy Embed Code, for everyone at the firm, and its settings show both.
 */
export function TypesScreen({
  fromWorkflow = false,
  portalBase = '',
}: {
  fromWorkflow?: boolean;
  portalBase?: string;
}) {
  const { role, firm } = useFirm();
  const manages = role === 'OWNER' || role === 'ADMIN';
  const types = useApiQuery([...TYPES_KEY, 'all'], () =>
    api.appointmentTypes.list({ status: 'all' }),
  );
  const [editing, setEditing] = useState<AppointmentType | 'new' | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const [embedding, setEmbedding] = useState<AppointmentType | null>(null);
  const toggle = useApiMutation(
    (t: AppointmentType) =>
      t.archivedAt ? api.appointmentTypes.restore(t.id) : api.appointmentTypes.archive(t.id),
    { invalidate: TYPES_KEY },
  );
  const list = types.data ?? [];
  const selected = list.find((t) => t.id === picked) ?? list.find((t) => !t.archivedAt);

  // Review 2 (row 3): the type's own link, on the portal host from config. A link that takes no
  // bookings is still copied (it stays the same), with what the client will see.
  const copyBookingLink = (t: AppointmentType) => {
    toggle.reset();
    const url = portalBase ? publicItemUrl(portalBase, firm.slug, 'APPOINTMENT_TYPE', t.id) : '';
    // Without the address here, the dialog reads the link from the API.
    if (!url) {
      setEmbedding(t);
      return;
    }
    const notice = publicLinkText('APPOINTMENT_TYPE', linkState(t)).notice;
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(
        () =>
          setMessage(
            notice
              ? { text: `Booking link for ${t.name} copied. ${notice}`, tone: 'warning' }
              : {
                  text: `Booking link for ${t.name} copied. It opens booking for this type in your client portal.`,
                  tone: 'success',
                },
          ),
        () => {
          setMessage({
            text: 'The link could not be copied. Copy it from the box.',
            tone: 'error',
          });
          setEmbedding(t);
        },
      );
  };

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
          role={toggle.error || message?.tone === 'error' ? 'alert' : 'status'}
          data-testid="types-result"
          className={`text-sm ${toggle.error ? 'text-danger' : TONE[message?.tone ?? 'success']}`}
        >
          {toggle.error ? errorMessage(toggle.error, TYPE_ERRORS) : message?.text}
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
            rowActions={(t) => (
              <RowMenu
                label={`Actions for ${t.name}`}
                items={[
                  ...(manages ? [{ label: 'Edit', onSelect: () => setEditing(t) }] : []),
                  { label: 'Settings', onSelect: () => setPicked(t.id) },
                  // Review 2 (row 3): every type, for everyone at the firm.
                  { label: 'Copy Booking Link', onSelect: () => copyBookingLink(t) },
                  { label: 'Copy Embed Code', onSelect: () => setEmbedding(t) },
                  ...(manages
                    ? [
                        {
                          label: t.archivedAt ? 'Restore' : 'Archive',
                          danger: !t.archivedAt,
                          onSelect: () =>
                            toggle.mutate(t, {
                              onSuccess: () =>
                                setMessage({
                                  text: t.archivedAt
                                    ? `${t.name} is active again.`
                                    : `${t.name} is archived; past appointments keep it.`,
                                  tone: 'success',
                                }),
                            }),
                        },
                      ]
                    : []),
                ]}
              />
            )}
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
            <>
              <TypeSettings key={selected.id} type={selected} manages={manages} />
              <div data-testid="type-booking-link" className="border-t border-divider pt-3">
                <BookingLinkBlock key={selected.id} type={selected} />
              </div>
            </>
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
            setMessage({ text, tone: 'success' });
          }}
        />
      ) : null}
      {embedding ? <EmbedDialog type={embedding} onClose={() => setEmbedding(null)} /> : null}
    </div>
  );
}

/**
 * Review 2 (row 3): the type's booking link and its website button, from the API
 * (`api.appointmentTypes.publicLink`), in the shared Copy link / embed block. The block says
 * when the link takes no bookings (archived, or clients can't book the type online).
 */
function BookingLinkBlock({ type }: { type: AppointmentType }) {
  const link = useApiQuery([...TYPES_KEY, 'public-link', type.id], () =>
    api.appointmentTypes.publicLink(type.id),
  );
  return (
    <PublicLinkSection
      kind="APPOINTMENT_TYPE"
      link={link.data}
      emptyText={
        link.isError
          ? 'The booking link is not available right now. Try again in a moment.'
          : link.isPending
            ? 'Loading the booking link…'
            : undefined
      }
    />
  );
}

/**
 * Copy Embed Code: the code is a button that opens the type's booking page, and the dialog says
 * why it is not an embedded page.
 */
function EmbedDialog({ type, onClose }: { type: AppointmentType; onClose: () => void }) {
  return (
    <Modal open title={`Embed Code for ${type.name}`} onClose={onClose}>
      <div data-testid="type-embed-dialog" className="flex flex-col gap-4">
        <p className="text-sm text-text">
          Put a Book button on your website: paste the embed code where the button should show. It
          opens booking for {type.name} in your client portal, in a new tab.
        </p>
        <p data-testid="embed-why-button" className="rounded-lg bg-subtle p-3 text-sm text-text">
          <span className="font-semibold text-heading">
            Why a button and not an embedded page:{' '}
          </span>
          booking needs your client to sign in to your portal, and browsers don&apos;t let the
          portal&apos;s secure sign-in work inside another website&apos;s frame. The button opens
          the booking page itself instead.
        </p>
        <BookingLinkBlock type={type} />
      </div>
    </Modal>
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
  const [platform, setPlatform] = useState(c.otherVideoPlatform ?? '');
  const [before, setBefore] = useState(String(c.bufferBeforeMinutes));
  const [after, setAfter] = useState(String(c.bufferAfterMinutes));
  const [notice, setNotice] = useState(String(c.minNoticeHours));
  const [windowChoice, setWindowChoice] = useState(
    c.maxWindowHours ? `h${c.maxWindowHours}` : `d${c.maxWindowDays}`,
  );
  // Octavia's A7: every reminder the type has, each with its channels (no longer one checkbox
  // that replaced them all with "Email, 1 day before").
  const [reminders, setReminders] = useState<ReminderRow[]>(() =>
    rowsFromReminders(c.defaultReminders),
  );
  // Octavia's A9: the service intake this type asks for; sent from the appointment, which then
  // shows whether it is completed.
  const [intakeForm, setIntakeForm] = useState(c.requiredIntakeFormId ?? '');
  const forms = useApiQuery(['intake-forms', 'published', 'for-types'], () =>
    api.intakeForms.forms({ templates: 'all', status: 'PUBLISHED' }),
  );
  const formChoices = (forms.data ?? []).filter(
    (f) => f.id === c.requiredIntakeFormId || !c.serviceId || f.service?.id === c.serviceId,
  );
  const [saved, setSaved] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SettingField, string>>>({});
  const save = useApiMutation(
    async () => {
      await api.scheduling.setTypeConfig(type.id, {
        description: description.trim() || null,
        methods,
        otherVideoPlatform: methods.includes('OTHER') ? platform.trim() || null : null,
        bufferBeforeMinutes: Number(before),
        bufferAfterMinutes: Number(after),
        minNoticeHours: Number(notice),
        // Review 2 (P1 row 2): hours replace the days while set; a day choice clears them.
        ...(windowChoice.startsWith('h')
          ? { maxWindowHours: Number(windowChoice.slice(1)) }
          : { maxWindowDays: Number(windowChoice.slice(1)), maxWindowHours: null }),
        defaultReminders: remindersFromRows(reminders),
        requiredIntakeFormId: intakeForm || null,
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
        const form = e.currentTarget;
        // Review 2 (P1 row 1): an Other Video Meeting names its platform.
        if (methods.includes('OTHER') && !platform.trim()) {
          setFieldErrors({
            otherVideoPlatform: 'Name the video platform of the Other Video Meeting.',
          });
          form.querySelector<HTMLElement>('[data-testid="other-video-platform"] input')?.focus();
          return;
        }
        const problem = reminderRowsProblem(reminders);
        if (problem) {
          setFieldErrors({ defaultReminders: problem });
          form.querySelector<HTMLElement>('[data-testid="type-reminders"] input')?.focus();
          return;
        }
        setFieldErrors({});
        save.mutate(undefined, {
          onError: (error) => {
            // Each refused field on its field; the entries stay as they are.
            const next: Partial<Record<SettingField, string>> = {};
            const details = error instanceof ApiRequestError ? (error.details ?? []) : [];
            for (const d of details) {
              const key = d.path.split('.')[0] as SettingField;
              if (key in SETTING_FIELDS) next[key] ??= d.message;
            }
            setFieldErrors(next);
            requestAnimationFrame(() =>
              form
                .querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid] input')
                ?.focus(),
            );
          },
        });
      }}
    >
      <Textarea
        label="Description (staff only)"
        rows={2}
        maxLength={500}
        disabled={off}
        value={description}
        error={fieldErrors.description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {/* Octavia's A10: the description is internal; no client view or email carries it. */}
      <p className="-mt-2 text-xs text-muted" data-testid="type-description-note">
        For your team only: clients never see it, in the portal, booking or emails.
      </p>
      <fieldset
        className="flex flex-col"
        data-testid="meeting-methods"
        data-invalid={fieldErrors.methods ? true : undefined}
        aria-describedby={fieldErrors.methods ? `methods-error-${type.id}` : undefined}
      >
        <legend className="mb-1 text-sm font-medium text-text">Meeting methods</legend>
        {(Object.entries(METHOD_LABELS) as [MeetingMethod, string][]).map(([m, label]) => (
          <Checkbox
            key={m}
            label={label}
            disabled={off}
            checked={methods.includes(m)}
            onChange={(e) => {
              setMethods(e.target.checked ? [...methods, m] : methods.filter((x) => x !== m));
              setFieldErrors(({ methods: _, ...rest }) => rest);
            }}
            className="min-h-8 text-sm"
          />
        ))}
        {methods.includes('OTHER') ? (
          <div className="mt-1 max-w-sm" data-testid="other-video-platform">
            <Input
              label="Video platform *"
              maxLength={60}
              placeholder="Teams, Google Meet…"
              disabled={off}
              value={platform}
              error={fieldErrors.otherVideoPlatform}
              onChange={(e) => {
                setPlatform(e.target.value);
                setFieldErrors(({ otherVideoPlatform: _, ...rest }) => rest);
              }}
            />
          </div>
        ) : null}
        {methods.length ? null : <p className="text-xs text-danger">Choose at least one method.</p>}
        {fieldErrors.methods ? (
          <p id={`methods-error-${type.id}`} className="text-sm font-medium text-danger">
            {fieldErrors.methods}
          </p>
        ) : null}
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
          options={withCurrent([0, 2, 6, 12, 24, 48, 72], Number(notice)).map((h) => ({
            value: String(h),
            label: h ? `${h} hours` : 'None',
          }))}
          value={notice}
          onChange={(e) => setNotice(e.target.value)}
        />
        <Select
          label="Booking window"
          disabled={off}
          options={windowChoices(windowChoice)}
          value={windowChoice}
          onChange={(e) => setWindowChoice(e.target.value)}
        />
      </div>
      <div data-testid="type-intake">
        <Select
          label="Required intake form"
          disabled={off}
          value={intakeForm}
          error={fieldErrors.requiredIntakeFormId}
          onChange={(e) => {
            setIntakeForm(e.target.value);
            setFieldErrors(({ requiredIntakeFormId: _, ...rest }) => rest);
          }}
          options={[
            {
              value: '',
              label: forms.isPending ? 'Loading forms…' : 'None',
            },
            ...formChoices.map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
        <p className="mt-1 text-xs text-muted">
          {c.serviceId ? "Published forms of this type's service. " : 'Published intake forms. '}
          Send it from the appointment: the appointment then shows whether the client completed it.
        </p>
      </div>
      <TypeReminders
        typeId={type.id}
        rows={reminders}
        disabled={off}
        error={fieldErrors.defaultReminders}
        onChange={(next) => {
          setReminders(next);
          setFieldErrors((now) => ({ ...now, defaultReminders: undefined }));
        }}
      />
      {save.error ? (
        <p role="alert" data-testid="type-settings-error" className="text-sm text-danger">
          {Object.keys(fieldErrors).length
            ? `Fix ${(Object.keys(SETTING_FIELDS) as SettingField[])
                .filter((k) => fieldErrors[k])
                .map((k) => SETTING_FIELDS[k])
                .join(', ')} and save again. Your other entries are kept.`
            : errorMessage(save.error, TYPE_ERRORS)}
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
