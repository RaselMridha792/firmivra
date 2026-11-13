'use client';

import type { LocationProfile } from '@firmivra/types';
import { Button, Modal, Skeleton } from '@firmivra/ui';
import {
  BuildingOffice,
  Check,
  Clock,
  EnvelopeSimple,
  Gear,
  MapPin,
  PencilSimple,
  Phone,
  User,
  Users,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { initials } from '../../../../../../components/app-shell/types';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import {
  LOCATION_ERRORS,
  LOCATIONS,
  PrimaryBadge,
  StatusBadge,
  WEEK_ORDER,
  WEEKDAYS,
  cityText,
  dayText,
  phoneText,
  streetText,
} from './location-parts';

export function useLocation(id: string | undefined) {
  return useApiQuery([...LOCATIONS, 'one', id ?? ''], () =>
    id ? api.locations.get(id) : Promise.reject(new Error('No location')),
  );
}

/** The location's photo, or the building tile when it has none. */
export function LocationPhoto({
  location,
  className,
}: {
  location: LocationProfile;
  className: string;
}) {
  return location.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link
    <img src={location.photoUrl} alt={location.name} className={`object-cover ${className}`} />
  ) : (
    <span
      aria-label="No photo yet"
      className={`flex items-center justify-center bg-info-soft text-action ${className}`}
    >
      <BuildingOffice aria-hidden weight="fill" className="size-16" />
    </span>
  );
}

function Box({
  title,
  icon: Glyph,
  action,
  children,
}: {
  title: string;
  icon: typeof User;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col rounded-xl border border-divider">
      <h3 className="flex items-center justify-between gap-2 rounded-t-xl bg-subtle px-4 py-3 font-bold text-heading">
        <span className="flex items-center gap-2">
          <Glyph aria-hidden weight="fill" className="size-5" />
          {title}
        </span>
        {action}
      </h3>
      <div className="flex min-w-0 flex-col gap-2 p-4 text-sm">{children}</div>
    </section>
  );
}

/**
 * Location Profile (lvp-auburn-office-location-profile.jpg; guide "Location profile" 01 to 04):
 * the saved details, manager, every day's hours (several blocks too), services and staff. The
 * email opens the mail composer and the phone a call (mailto:, tel:). Edit Location opens this
 * location's form; Manage Staff its staff dialog.
 */
export function LocationProfileDialog({
  locationId,
  onClose,
  onManageStaff,
}: {
  locationId: string;
  onClose: () => void;
  onManageStaff: () => void;
}) {
  const q = useLocation(locationId);
  const l = q.data;
  return (
    <Modal
      open
      title="Location Profile"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Link
            href={`/settings/locations/${locationId}/edit`}
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
          >
            <PencilSimple aria-hidden weight="fill" className="size-4" />
            Edit Location
          </Link>
          <Button onClick={onManageStaff}>
            <UsersThree aria-hidden weight="fill" className="size-4" />
            Manage Staff
          </Button>
        </div>
      }
    >
      <div data-testid="location-profile">
        {q.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !l ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(q.error, LOCATION_ERRORS)}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row">
              <LocationPhoto location={l} className="h-44 w-full shrink-0 rounded-xl sm:w-64" />
              <div className="flex min-w-0 flex-col gap-2">
                <p className="flex flex-wrap items-center gap-2 text-2xl font-bold text-heading">
                  {l.name}
                  <StatusBadge status={l.status} />
                  {l.isMain ? <PrimaryBadge /> : null}
                </p>
                <p className="flex items-start gap-2 text-text">
                  <MapPin aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0" />
                  <span>
                    <span className="block">{streetText(l)}</span>
                    {l.kind === 'OFFICE' ? <span className="block">{cityText(l)}</span> : null}
                  </span>
                </p>
                {l.phone ? (
                  <a
                    href={`tel:${l.phone}`}
                    className="flex items-center gap-2 text-text hover:underline"
                  >
                    <Phone aria-hidden weight="fill" className="size-5" />
                    {phoneText(l.phone)}
                  </a>
                ) : null}
                {l.email ? (
                  <a
                    href={`mailto:${l.email}`}
                    className="flex items-center gap-2 text-link hover:underline"
                  >
                    <EnvelopeSimple aria-hidden weight="fill" className="size-5" />
                    {l.email}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Box title="Location Manager" icon={User}>
                {l.manager ? (
                  <>
                    <p className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="flex size-11 items-center justify-center rounded-full bg-info-soft font-semibold text-info"
                      >
                        {initials(l.manager.name)}
                      </span>
                      <span>
                        <span className="block font-semibold text-heading">{l.manager.name}</span>
                        <span className="block text-muted">
                          {l.managerIsActing
                            ? 'Acting manager (main location)'
                            : (l.manager.jobTitle ?? '')}
                        </span>
                      </span>
                    </p>
                    {l.manager.phone ? (
                      <a
                        href={`tel:${l.manager.phone}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <Phone aria-hidden weight="fill" className="size-4" />
                        {phoneText(l.manager.phone)}
                      </a>
                    ) : null}
                    {l.manager.email ? (
                      <a
                        href={`mailto:${l.manager.email}`}
                        className="flex items-center gap-2 text-link hover:underline"
                      >
                        <EnvelopeSimple aria-hidden weight="fill" className="size-4" />
                        {l.manager.email}
                      </a>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted">No manager assigned.</p>
                )}
              </Box>
              <Box title="Business Hours" icon={Clock}>
                <dl className="grid grid-cols-[6rem_1fr] gap-y-1" data-testid="profile-hours">
                  {WEEK_ORDER.map((d) => (
                    <div key={d} className="contents">
                      <dt className="text-text">{WEEKDAYS[d]}</dt>
                      <dd className="text-text">{dayText(l.hours, d)}</dd>
                    </div>
                  ))}
                </dl>
              </Box>
              <Box title="Services Offered" icon={Gear}>
                {l.services.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {l.services.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <Check aria-hidden weight="bold" className="size-4 text-heading" />
                        {s.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">No services chosen yet.</p>
                )}
              </Box>
              <Box
                title="Assigned Staff"
                icon={Users}
                action={
                  <button
                    type="button"
                    onClick={onManageStaff}
                    className="text-sm font-semibold text-link hover:underline"
                  >
                    View All ({l.staff.length})
                  </button>
                }
              >
                {l.staff.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {l.staff.slice(0, 5).map((p) => (
                      <li
                        key={p.userId}
                        className="grid grid-cols-[2rem_1fr_1fr] items-center gap-2"
                      >
                        <span
                          aria-hidden
                          className="flex size-7 items-center justify-center rounded-full bg-info-soft text-xs font-semibold text-info"
                        >
                          {initials(p.name)}
                        </span>
                        <span className="truncate text-text">{p.name}</span>
                        <span className="truncate text-muted">{p.jobTitle ?? ''}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">No staff assigned yet.</p>
                )}
              </Box>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
