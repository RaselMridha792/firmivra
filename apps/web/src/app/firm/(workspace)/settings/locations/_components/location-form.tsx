'use client';

import {
  CreateLocationRequest,
  LOCATION_PHOTO_LIMITS,
  type LocationHoursInterval,
  type LocationOptions,
  type LocationProfile,
  UpdateLocationRequest,
  US_STATES,
} from '@firmivra/types';
import { Button, Input, Modal, Select, Skeleton, Textarea } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowsLeftRight,
  BuildingOffice,
  CaretRight,
  Clock,
  Gear,
  IdentificationCard,
  ImageSquare,
  Info,
  MapPin,
  NotePencil,
  Phone,
  Plus,
  Trash,
  User,
  UserMinus,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { uploadFile } from '../../../../../../lib/upload';
import {
  DeactivateLocationDialog,
  DeactivateManagerDialog,
  ReassignManagerDialog,
} from './location-dialogs';
import {
  LOCATION_ERRORS,
  LOCATIONS,
  WEEK_ORDER,
  WEEKDAYS,
  phoneText,
  time12,
} from './location-parts';
import { LocationPhoto, useLocation } from './location-profile';

// Add New Location and Edit Location (add-new-location-dashboard-form.jpg and
// edit-location-dashboard-for-auburn-office.jpg; guide "Add New Location" 01 to 05 and "Edit
// Location" 01 to 10). Checked with the contract's schemas before anything is sent; the API keeps
// the duplicate, plan-limit and conflict rules. Leaving with unsaved changes asks first.

interface Values {
  name: string;
  kind: 'OFFICE' | 'VIRTUAL';
  status: 'ACTIVE' | 'INACTIVE';
  isMain: boolean;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  alternatePhone: string;
  email: string;
  managerUserId: string;
  notes: string;
  serviceIds: string[];
  hours: LocationHoursInterval[];
}

const STATE_OPTIONS = [
  { value: '', label: 'Select state' },
  ...Object.entries(US_STATES).map(([value]) => ({ value, label: value })),
];
/** Every half hour of the day, for the hours' selects. */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const v = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  return { value: v, label: time12(v) };
});
const DEFAULT_BLOCK = { opensAt: '09:00', closesAt: '17:00' };

/** What is typed as a phone, as the API keeps it: 10 US digits get +1. */
export function toE164(typed: string): string {
  const digits = typed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return typed.trim();
}

function initialValues(l: LocationProfile | undefined): Values {
  return {
    name: l?.name ?? '',
    kind: l?.kind ?? 'OFFICE',
    status: l?.status ?? 'ACTIVE',
    isMain: l?.isMain ?? false,
    addressLine1: l?.addressLine1 ?? '',
    addressLine2: l?.addressLine2 ?? '',
    city: l?.city ?? '',
    state: l?.state ?? '',
    postalCode: l?.postalCode ?? '',
    phone: phoneText(l?.phone) || '',
    alternatePhone: phoneText(l?.alternatePhone) || '',
    email: l?.email ?? '',
    managerUserId: l?.manager && !l.managerIsActing ? l.manager.userId : '',
    notes: l?.notes ?? '',
    serviceIds: l?.services.map((s) => s.id) ?? [],
    hours: l ? l.hours : [1, 2, 3, 4, 5].map((weekday) => ({ weekday, ...DEFAULT_BLOCK })),
  };
}

function Section({
  title,
  icon: Glyph,
  aside,
  children,
}: {
  title: string;
  icon: typeof User;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
          <Glyph aria-hidden weight="fill" className="size-6 text-action" />
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The week's hours: a day is open with one or more blocks, or closed. */
function HoursEditor({
  hours,
  error,
  onChange,
}: {
  hours: LocationHoursInterval[];
  error?: string;
  onChange: (hours: LocationHoursInterval[]) => void;
}) {
  const ofDay = (d: number) => hours.filter((h) => h.weekday === d);
  const setDay = (d: number, blocks: Omit<LocationHoursInterval, 'weekday'>[]) =>
    onChange([
      ...hours.filter((h) => h.weekday !== d),
      ...blocks.map((b) => ({ weekday: d, ...b })),
    ]);
  return (
    <div className="flex flex-col gap-2" data-testid="hours-editor">
      {WEEK_ORDER.map((d) => {
        const blocks = ofDay(d);
        const open = blocks.length > 0;
        return (
          <div key={d} className="flex flex-wrap items-start gap-2">
            <label className="flex w-28 items-center gap-2 pt-2 text-sm font-medium text-heading">
              <input
                type="checkbox"
                className="size-4"
                checked={open}
                onChange={(e) => setDay(d, e.target.checked ? [DEFAULT_BLOCK] : [])}
              />
              {WEEKDAYS[d]}
            </label>
            <div className="flex flex-col gap-2">
              {(open ? blocks : [{ opensAt: '', closesAt: '' }]).map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    label={`${WEEKDAYS[d]} opens${i ? ` (${i + 1})` : ''}`}
                    hideLabel
                    disabled={!open}
                    value={b.opensAt}
                    onChange={(e) =>
                      setDay(
                        d,
                        blocks.map((x, j) => (j === i ? { ...x, opensAt: e.target.value } : x)),
                      )
                    }
                    options={open ? TIMES : [{ value: '', label: 'Closed' }]}
                  />
                  <span className="text-sm text-muted">to</span>
                  <Select
                    label={`${WEEKDAYS[d]} closes${i ? ` (${i + 1})` : ''}`}
                    hideLabel
                    disabled={!open}
                    value={b.closesAt}
                    onChange={(e) =>
                      setDay(
                        d,
                        blocks.map((x, j) => (j === i ? { ...x, closesAt: e.target.value } : x)),
                      )
                    }
                    options={open ? TIMES : [{ value: '', label: 'Closed' }]}
                  />
                  {open && i > 0 ? (
                    <button
                      type="button"
                      aria-label={`Remove ${WEEKDAYS[d]} block ${i + 1}`}
                      className="text-muted hover:text-danger"
                      onClick={() =>
                        setDay(
                          d,
                          blocks.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <X aria-hidden weight="bold" className="size-4" />
                    </button>
                  ) : null}
                  {open && i === blocks.length - 1 ? (
                    <button
                      type="button"
                      aria-label={`Add another ${WEEKDAYS[d]} block`}
                      className="text-action hover:text-action-hover"
                      onClick={() =>
                        setDay(d, [...blocks, { opensAt: '13:00', closesAt: '17:00' }])
                      }
                    >
                      <Plus aria-hidden weight="bold" className="size-5" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function LocationForm({ id }: { id?: string }) {
  const editing = !!id;
  const location = useLocation(id);
  const options = useApiQuery([...LOCATIONS, 'options'], () => api.locations.options());
  if ((editing && location.isPending) || options.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if ((editing && !location.data) || !options.data) {
    return (
      <p role="alert" className="text-sm text-danger">
        {errorMessage(location.error ?? options.error, LOCATION_ERRORS)}
      </p>
    );
  }
  return <Form location={location.data} options={options.data} />;
}

function Form({ location, options }: { location?: LocationProfile; options: LocationOptions }) {
  const router = useRouter();
  const qc = useQueryClient();
  const editing = !!location;
  const [start] = useState(() => initialValues(location));
  const [v, setV] = useState<Values>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<File>();
  const [leaving, setLeaving] = useState<string>();
  const [dialog, setDialog] = useState<'reassign' | 'deactivate-manager' | 'deactivate'>();
  const dirty = JSON.stringify(v) !== JSON.stringify(start) || !!photo;
  const set = (patch: Partial<Values>) => setV((was) => ({ ...was, ...patch }));
  const field = (name: keyof Values) => ({
    value: String(v[name] ?? ''),
    error: errors[name],
    onChange: (e: { target: { value: string } }) =>
      set({ [name]: e.target.value } as Partial<Values>),
  });
  const virtual = v.kind === 'VIRTUAL';

  // A full reload or a closed tab with unsaved changes asks the browser's question.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const go = (href: string) => (dirty ? setLeaving(href) : router.push(href));

  const save = async () => {
    const common = {
      name: v.name,
      kind: v.kind,
      addressLine1: virtual ? null : v.addressLine1 || null,
      addressLine2: virtual ? null : v.addressLine2 || null,
      city: v.city || null,
      state: v.state || null,
      postalCode: v.postalCode || null,
      phone: toE164(v.phone),
      alternatePhone: v.alternatePhone ? toE164(v.alternatePhone) : null,
      email: v.email,
      notes: v.notes.trim() || null,
      serviceIds: v.serviceIds,
      hours: v.hours,
      staffUserIds: location?.staff.map((p) => p.userId) ?? [],
    };
    const check = editing
      ? UpdateLocationRequest.safeParse({ ...common, expectedUpdatedAt: location.updatedAt })
      : CreateLocationRequest.safeParse({
          ...common,
          status: v.status,
          isMain: v.isMain,
          managerUserId: v.managerUserId,
        });
    if (!check.success) {
      const found: Record<string, string> = {};
      for (const issue of check.error.issues) {
        const key = issue.path[0] === 'hours' ? 'hours' : String(issue.path[0] ?? 'name');
        found[key] ??= issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    setFailure(undefined);
    setSaving(true);
    try {
      const saved = editing
        ? await api.locations.update(location.id, check.data as never)
        : await api.locations.create(check.data as never);
      let note = editing ? 'Location saved.' : 'Location added.';
      if (photo) {
        try {
          await uploadFile(photo, {
            maxBytes: LOCATION_PHOTO_LIMITS.maxBytes,
            start: (facts) => api.locations.createPhotoUpload(saved.id, facts as never),
            finish: (uploadToken) => api.locations.confirmPhotoUpload(saved.id, { uploadToken }),
          });
        } catch (e) {
          note = `${note} The photo was not uploaded: ${errorMessage(e)}`;
        }
      }
      setV(initialValues(saved));
      await qc.invalidateQueries({ queryKey: [...LOCATIONS] });
      router.push(`/settings/locations?saved=${encodeURIComponent(note)}`);
    } catch (e) {
      setFailure(e);
    } finally {
      setSaving(false);
    }
  };

  const manager = location?.manager;
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="location-form">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className="text-link hover:underline"
          onClick={() => go('/settings/overview')}
        >
          Settings
        </button>
        <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
        <button
          type="button"
          className="text-link hover:underline"
          onClick={() => go('/settings/locations')}
        >
          Locations
        </button>
        <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
        <span aria-current="page" className="font-semibold text-heading">
          {editing ? 'Edit Location' : 'Add New Location'}
        </span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-16 items-center justify-center rounded-xl bg-action text-on-action">
            <MapPin aria-hidden weight="fill" className="size-9" />
          </span>
          <div>
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              {editing ? 'Edit Location' : 'Add New Location'}
            </h1>
            <p className="text-link">
              {editing
                ? 'Update the location details, services, business hours, and assigned manager.'
                : 'Create a new office location, assign a manager, set operating hours, and add relevant information.'}
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => go('/settings/locations')}>
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Locations
        </Button>
      </header>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            title="Basic Information"
            icon={BuildingOffice}
            aside={
              editing ? (
                <span className="text-sm text-heading">
                  Status: {location.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                </span>
              ) : null
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Location Name *"
                placeholder="Enter location name (e.g., Auburn Office)"
                maxLength={100}
                {...field('name')}
              />
              <Select
                label="Location Type *"
                {...field('kind')}
                options={[
                  { value: 'OFFICE', label: 'Office' },
                  { value: 'VIRTUAL', label: 'Virtual (online / remote)' },
                ]}
              />
              {!editing ? (
                <>
                  <Select
                    label="Status *"
                    {...field('status')}
                    options={[
                      { value: 'ACTIVE', label: 'Active' },
                      { value: 'INACTIVE', label: 'Inactive' },
                    ]}
                  />
                  <label className="flex items-start gap-2 pt-6 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={v.isMain}
                      onChange={(e) => set({ isMain: e.target.checked })}
                    />
                    <span>
                      <span className="block font-medium text-heading">
                        Set as Primary Location
                      </span>
                      <span className="text-muted">
                        Primary location will be used as the default office.
                      </span>
                    </span>
                  </label>
                </>
              ) : null}
            </div>
          </Section>

          <Section title="Address Information" icon={MapPin}>
            {virtual ? (
              <p className="text-sm text-muted">A virtual location has no street address.</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {!virtual ? (
                <>
                  <Input
                    label="Address Line 1 *"
                    placeholder="Enter street address"
                    maxLength={200}
                    {...field('addressLine1')}
                  />
                  <Input
                    label="Address Line 2"
                    placeholder="Suite, Unit, etc. (optional)"
                    maxLength={200}
                    {...field('addressLine2')}
                  />
                </>
              ) : null}
              <Input
                label={virtual ? 'City' : 'City *'}
                placeholder="Enter city"
                maxLength={100}
                {...field('city')}
              />
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label={virtual ? 'State' : 'State *'}
                  {...field('state')}
                  options={STATE_OPTIONS}
                />
                <Input
                  label={virtual ? 'ZIP Code' : 'ZIP Code *'}
                  placeholder="Enter ZIP code"
                  inputMode="numeric"
                  {...field('postalCode')}
                />
              </div>
            </div>
          </Section>

          <Section title="Contact Information" icon={Phone}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Office Phone *"
                type="tel"
                placeholder="(555) 555-5555"
                {...field('phone')}
              />
              <Input
                label="Office Email *"
                type="email"
                placeholder="location@example.com"
                {...field('email')}
              />
              <Input
                label="Alternate Phone"
                type="tel"
                placeholder="(555) 555-5555"
                {...field('alternatePhone')}
              />
            </div>
          </Section>

          {editing ? (
            <Section
              title="Company Information (Legal Entity)"
              icon={IdentificationCard}
              aside={
                <Link
                  href="/settings/profile"
                  className="inline-flex min-h-9 items-center rounded-control border border-action px-3 text-sm font-semibold text-action hover:bg-folder-surface"
                >
                  Go to Company Profile
                </Link>
              }
            >
              <p className="text-sm text-muted">
                This location belongs to the legal entity below. Change it in Company Profile.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label="Business Name" readOnly value={options.company.legalName ?? '—'} />
                <Input
                  label="EIN"
                  readOnly
                  value={options.company.einLast4 ? `••-•••${options.company.einLast4}` : '—'}
                />
                <Input
                  label="Business Structure"
                  readOnly
                  value={options.company.businessStructure ?? '—'}
                />
              </div>
            </Section>
          ) : null}

          <Section title="Location Manager" icon={UsersThree}>
            {editing ? (
              <div className="flex flex-col gap-3" data-testid="manager-card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>
                    <span className="block text-lg font-semibold text-heading">
                      {manager?.name ?? 'No manager assigned'}
                    </span>
                    <span className="text-sm text-muted">
                      {location.managerIsActing
                        ? 'Acting manager (main location)'
                        : (manager?.jobTitle ?? '')}
                    </span>
                  </p>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className="!min-h-9"
                      onClick={() => setDialog('reassign')}
                    >
                      <ArrowsLeftRight aria-hidden weight="bold" className="size-4" /> Reassign
                      Manager
                    </Button>
                    {options.canManageSchedules && manager && !location.managerIsActing ? (
                      <Button
                        variant="secondary"
                        className="!min-h-9 !text-danger"
                        onClick={() => setDialog('deactivate-manager')}
                      >
                        <UserMinus aria-hidden weight="fill" className="size-4" /> Deactivate
                        Manager
                      </Button>
                    ) : null}
                    <Button variant="secondary" className="!min-h-9" onClick={() => go('/team')}>
                      <UsersThree aria-hidden weight="fill" className="size-4" /> Go to Staff
                      Management
                    </Button>
                  </span>
                </div>
                {manager ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="Phone Number" readOnly value={phoneText(manager.phone) || '—'} />
                    <Input label="Email Address" readOnly value={manager.email ?? '—'} />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Assign Location Manager *"
                  {...field('managerUserId')}
                  options={[
                    { value: '', label: 'Select a manager' },
                    ...options.members.map((m) => ({ value: m.userId, label: m.name })),
                  ]}
                />
                <p className="flex items-start gap-2 rounded-lg bg-info-soft p-3 text-sm text-link">
                  <Info aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0" />
                  The location manager will have access to manage this location, view assigned
                  staff, and handle day-to-day operations.
                </p>
              </div>
            )}
          </Section>

          <Section title="Operating Hours" icon={Clock}>
            <HoursEditor
              hours={v.hours}
              error={errors['hours']}
              onChange={(hours) => set({ hours })}
            />
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section title={editing ? 'Location Photo' : 'Location Image'} icon={ImageSquare}>
            {location ? (
              <LocationPhoto location={location} className="h-40 w-full rounded-lg" />
            ) : null}
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-divider bg-subtle p-4 text-center text-sm">
              <ImageSquare aria-hidden weight="fill" className="size-8 text-action" />
              <span className="font-medium text-heading">
                {photo
                  ? photo.name
                  : editing
                    ? 'Change Photo'
                    : 'Upload a photo of the office (optional)'}
              </span>
              <span className="text-muted">JPG, PNG or WebP (Max 5MB)</span>
              <input
                type="file"
                accept={LOCATION_PHOTO_LIMITS.types.join(',')}
                className="sr-only"
                onChange={(e) => setPhoto(e.target.files?.[0])}
              />
            </label>
            {location?.photoUrl ? (
              <Button
                variant="secondary"
                className="!min-h-9 w-fit !text-danger"
                onClick={() =>
                  void api.locations.removePhoto(location.id).then(() => router.refresh())
                }
              >
                <Trash aria-hidden weight="fill" className="size-4" /> Remove Photo
              </Button>
            ) : null}
          </Section>

          <Section title="Services Offered" icon={Gear}>
            <p className="text-sm text-muted">
              Select the services offered at this location. Services are managed in{' '}
              <Link href="/services-pricing" className="text-link hover:underline">
                Services &amp; Pricing
              </Link>
              .
            </p>
            {options.services.length ? (
              <ul className="flex flex-col gap-2" data-testid="services-offered">
                {options.services.map((s) => (
                  <li key={s.id}>
                    <label className="flex items-center gap-2 text-sm text-heading">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={v.serviceIds.includes(s.id)}
                        onChange={(e) =>
                          set({
                            serviceIds: e.target.checked
                              ? [...v.serviceIds, s.id]
                              : v.serviceIds.filter((x) => x !== s.id),
                          })
                        }
                      />
                      {s.name}
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg bg-subtle p-3 text-sm text-muted">
                No active services yet. Add them in Services &amp; Pricing.
              </p>
            )}
          </Section>

          <Section title="Additional Information" icon={NotePencil}>
            <Textarea
              label="Notes (optional)"
              placeholder="Add any additional information about this location (e.g., parking, directions, special instructions, etc.)"
              maxLength={500}
              rows={5}
              {...field('notes')}
            />
            <p className="text-right text-xs text-muted">{v.notes.length}/500</p>
          </Section>
        </div>
      </div>

      {failure ? (
        <p role="alert" className="text-sm text-danger" data-testid="location-save-error">
          {errorMessage(failure, LOCATION_ERRORS)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => go('/settings/locations')}>
          Cancel
        </Button>
        <span className="flex flex-wrap gap-3">
          {editing &&
          options.canManageSchedules &&
          location.status === 'ACTIVE' &&
          !location.isMain ? (
            <Button
              variant="secondary"
              className="!text-danger"
              onClick={() => setDialog('deactivate')}
            >
              <Trash aria-hidden weight="fill" className="size-4" /> Deactivate Location
            </Button>
          ) : null}
          <Button disabled={saving} onClick={() => void save()} data-testid="save-location">
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Location'}
          </Button>
        </span>
      </div>

      {leaving ? (
        <Modal
          open
          title="Leave without saving?"
          onClose={() => setLeaving(undefined)}
          footer={
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setLeaving(undefined)}>
                Keep Editing
              </Button>
              <Button className="!bg-danger hover:!bg-danger" onClick={() => router.push(leaving)}>
                Discard Changes
              </Button>
            </div>
          }
        >
          <p className="text-sm text-text" data-testid="unsaved-location">
            You have unsaved changes to this location. They will be lost if you leave now.
          </p>
        </Modal>
      ) : null}
      {editing && dialog === 'reassign' ? (
        <ReassignManagerDialog
          location={location}
          members={options.members}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            router.refresh();
          }}
        />
      ) : null}
      {editing && dialog === 'deactivate-manager' ? (
        <DeactivateManagerDialog
          location={location}
          members={options.members}
          onClose={() => setDialog(undefined)}
          onDone={() => setDialog(undefined)}
        />
      ) : null}
      {editing && dialog === 'deactivate' ? (
        <DeactivateLocationDialog
          location={location}
          onClose={() => setDialog(undefined)}
          onDone={() => router.push('/settings/locations')}
        />
      ) : null}
    </div>
  );
}
