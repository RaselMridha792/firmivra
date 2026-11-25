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
import { LeaveGuard } from '../../../../../../components/leave-guard';
import { PublicLinkSection } from '../../../../../../components/public-link';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { publicLinkText } from '../../../../../../lib/public-link';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { hasUnsavedChanges, useUnsavedChanges } from '../../../../../../lib/unsaved';
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
  // Settings C (G-WF-4): another type's settings replace this form, so unsaved edits ask first.
  const [switching, setSwitching] = useState<AppointmentType | null>(null);
  const pick = (t: AppointmentType) => {
    if (t.id === selected?.id) return;
    if (hasUnsavedChanges()) setSwitching(t);
    else setPicked(t.id);
  };

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
                    onClick={() => pick(t)}
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
                  { label: 'Settings', onSelect: () => pick(t) },
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
      {switching ? (
        <Modal
          open
          title="Discard your changes?"
          onClose={() => setSwitching(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSwitching(null)}>
                Keep Editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setPicked(switching.id);
                  setSwitching(null);
                }}
              >
                Discard Changes
              </Button>
            </>
          }
        >
          <p className="text-sm text-text" data-testid="type-switch-discard">
            Your changes to {selected?.name ?? 'this type'} settings are not saved. Discard them and
            open {switching.name}?
          </p>
        </Modal>
      ) : null}
      {/* G-WF-4: a link out of the page (Back, the sidebar) or a reload asks first. */}
      <LeaveGuard />
    </div>
  );
}

/**
 * Review 2 (row 3, D3): the type's booking link and its website code, from the API
 * (`api.appointmentTypes.publicLink`), in the shared Copy link / embed block. The code is the
 * inline booking frame; with `withButton`, the button that opens the page in a new tab follows
 * as a second choice. The block says when the link takes no bookings (archived, or clients can't
 * book the type online).
 */
function BookingLinkBlock({
  type,
  withButton = false,
}: {
  type: AppointmentType;
  withButton?: boolean;
}) {
  const link = useApiQuery([...TYPES_KEY, 'public-link', type.id], () =>
    api.appointmentTypes.publicLink(type.id),
  );
  return (
    <>
      <PublicLinkSection
        kind="APPOINTMENT_TYPE"
        link={link.data}
        embedHelp="Paste it into a page of your website where the booking should show. It grows to fit the booking page."
        emptyText={
          link.isError
            ? 'The booking link is not available right now. Try again in a moment.'
            : link.isPending
              ? 'Loading the booking link…'
              : undefined
        }
      />
      {withButton && link.data?.buttonCode ? <ButtonCode code={link.data.buttonCode} /> : null}
    </>
  );
}

/** The second choice: a button that opens the booking page in a new tab, with its own Copy. */
function ButtonCode({ code }: { code: string }) {
  const [status, setStatus] = useState('');
  return (
    <section
      data-testid="embed-button-code"
      className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-divider bg-surface p-4"
    >
      <label htmlFor="embed-button-code-text" className="text-sm font-semibold text-heading">
        Or a button that opens the booking page in a new tab
      </label>
      <div className="flex min-w-0 gap-2 max-sm:flex-col sm:items-start">
        <textarea
          id="embed-button-code-text"
          readOnly
          rows={4}
          value={code}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 resize-none rounded-control border border-border bg-subtle px-3 py-2 font-mono text-xs text-text focus:outline-none focus:ring-2 focus:ring-action/25"
        />
        <Button
          variant="secondary"
          className="shrink-0 sm:min-w-48"
          onClick={() => {
            navigator.clipboard.writeText(code).then(
              () => setStatus('Button code copied.'),
              () => setStatus('Copying was blocked. Select the text and press Ctrl+C.'),
            );
          }}
        >
          Copy Button Code
        </Button>
      </div>
      <p role="status" className={status ? 'text-sm text-text' : 'sr-only'}>
        {status}
      </p>
    </section>
  );
}

/**
 * Copy Embed Code: the code is the inline booking frame, with the button as a second choice. The
 * dialog says the firm's website address must be listed by Firmivra for the frame to show.
 */
function EmbedDialog({ type, onClose }: { type: AppointmentType; onClose: () => void }) {
  return (
    <Modal open title={`Embed Code for ${type.name}`} onClose={onClose}>
      <div data-testid="type-embed-dialog" className="flex flex-col gap-4">
        <p className="text-sm text-text">
          Show booking for {type.name} inside a page of your website: paste the embed code where it
          should appear. Your client signs in to your client portal in a new tab, then books.
        </p>
        <p data-testid="embed-allowed-note" className="rounded-lg bg-subtle p-3 text-sm text-text">
          <span className="font-semibold text-heading">Your website must be listed first: </span>
          the frame shows only on websites Firmivra has listed for your firm. Ask Firmivra to list
          your website&apos;s address, or use the button below, which works on any website.
        </p>
        <BookingLinkBlock type={type} withButton />
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
  // Settings C (G-WF-4): Cancel, the close button or Escape with edits asks before discarding.
  const entries = JSON.stringify([name, minutes, location, bookable, cutoff]);
  const [loaded] = useState(entries);
  const dirty = entries !== loaded && !save.isSuccess;
  useUnsavedChanges(dirty);
  const [asking, setAsking] = useState(false);
  const close = () => (dirty ? setAsking(true) : onClose());
  if (asking)
    return (
      <Modal
        open
        title="Discard your changes?"
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Keep Editing
            </Button>
            <Button variant="danger" onClick={onClose}>
              Discard Changes
            </Button>
          </>
        }
      >
        <p className="text-sm text-text" data-testid="type-modal-discard">
          {type
            ? `Your changes to ${type.name} are not saved. Discard them?`
            : 'This new appointment type is not added yet. Discard it?'}
        </p>
      </Modal>
    );
  return (
    <Modal open title={type ? `Edit ${type.name}` : 'Add Appointment Type'} onClose={close}>
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
          <Button variant="secondary" onClick={close}>
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
  // D4 (R56): "Settings saved." is kept here, not in the form. A save that changes a value
  // reloads the settings, which draws the form again (it is keyed by them) and used to drop the
  // message as soon as the reload came back, so it could flash by unseen.
  const [saved, setSaved] = useState('');
  if (config.isPending) return <Skeleton className="h-64" />;
  if (!config.data)
    return <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>;
  return (
    <SettingsForm
      key={JSON.stringify(config.data)}
      type={type}
      config={config.data}
      manages={manages}
      saved={saved}
      onSaved={setSaved}
    />
  );
}

function SettingsForm({
  type,
  config: c,
  manages,
  saved,
  onSaved,
}: {
  type: AppointmentType;
  config: AppointmentTypeConfig;
  manages: boolean;
  /** "Settings saved." after a save, kept by TypeSettings across the redraw. */
  saved: string;
  onSaved: (text: string) => void;
}) {
  const [description, setDescription] = useState(c.description ?? '');
  // Review 2 (B7): the scheduled/confirmation notice's words for this type's new appointments.
  const [confirmation, setConfirmation] = useState(c.confirmationMessage ?? '');
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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SettingField, string>>>({});
  // Settings C (G-WF-4): the entries as they were loaded or last saved; any difference is unsaved
  // work, so leaving the page or choosing another type asks first (LeaveGuard, TypesScreen).
  const entries = JSON.stringify([
    description,
    confirmation,
    [...methods].sort(),
    platform,
    before,
    after,
    notice,
    windowChoice,
    reminders,
    intakeForm,
  ]);
  const [kept, setKept] = useState(entries);
  useUnsavedChanges(manages && entries !== kept);
  const save = useApiMutation(
    async () => {
      const sent = entries;
      await api.scheduling.setTypeConfig(type.id, {
        description: description.trim() || null,
        confirmationMessage: confirmation.trim() || null,
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
      // Saved: nothing is unsaved from the moment "Settings saved." shows, before the reload.
      setKept(sent);
      onSaved('Settings saved.');
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
        // A new attempt: the last save's message goes until this one is saved.
        onSaved('');
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
      <Textarea
        label="Confirmation message (sent to the client)"
        rows={2}
        maxLength={2000}
        disabled={off}
        placeholder="Blank uses the standard wording."
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
      />
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
        {/* Settings C (G-WF-2): what the two booking limits mean, in the guide's words. */}
        <Select
          label="Minimum notice"
          hint="How far ahead a client must book. 2 hours: at 10 a.m., noon is the earliest start."
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
          hint="How far into the future clients can book. 1 day ahead: up to 24 hours away."
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
