'use client';

import type { AdminActivityTone, LocationRow, LocationsQuery } from '@firmivra/types';
import { ActionMenu, Button, Input, Select, Skeleton, Toast } from '@firmivra/ui';
import {
  ArrowRight,
  BuildingOffice,
  CalendarCheck,
  ClockCounterClockwise,
  DotsThree,
  Eye,
  FileText,
  type Icon,
  Info,
  MapPin,
  PencilSimple,
  Plus,
  Star,
  UserCircle,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { initials } from '../../../../../../components/app-shell/types';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, Quiet, SettingsHeader, SettingsKpi } from '../../_components/settings-parts';
import {
  DeactivateLocationDialog,
  ManageStaffDialog,
  ScheduleDialog,
  SetPrimaryDialog,
  zonedText,
} from './location-dialogs';
import {
  LOCATIONS,
  PrimaryBadge,
  StatusBadge,
  WEEK_ORDER,
  WEEKDAYS,
  addressText,
  cityText,
  clockOf,
  dayOf,
  dayText,
  hoursSummary,
  phoneText,
  streetText,
} from './location-parts';
import { LocationPhoto, LocationProfileDialog, useLocation } from './location-profile';

const PAGE = 8;
type Open = {
  kind: 'profile' | 'staff' | 'deactivate' | 'primary' | 'schedule';
  id: string;
} | null;

const TONE: Record<AdminActivityTone, { icon: Icon; tile: string }> = {
  success: { icon: FileText, tile: 'bg-success-soft text-success' },
  warning: { icon: WarningCircle, tile: 'bg-warning-soft text-warning' },
  info: { icon: PencilSimple, tile: 'bg-info-soft text-info' },
  user: { icon: UsersThree, tile: 'bg-accent-soft text-accent' },
  system: { icon: Info, tile: 'bg-subtle text-heading' },
};

/**
 * Settings > Locations (settings-locations.jpg and locations-3-dot-menu.jpg; guide "Settings →
 * Locations" 01 to 04): the KPI cards, the filtered table with View, Edit and the three-dot menu,
 * the chosen location's details and Recent Location Activity. Owner and Admin; deactivating and
 * schedules are the Super Administrator's (`canManageSchedules`), and the API checks every call.
 */
export function LocationsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [manager, setManager] = useState('');
  const [city, setCity] = useState('');
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<string>();
  const [open, setOpen] = useState<Open>(null);
  // Add and Edit come back with what they did.
  const params = useSearchParams();
  const [notice, setNotice] = useState(() => (params.get('saved') ?? '').slice(0, 300));
  const query = useMemo<LocationsQuery>(
    () => ({
      ...(search.trim() ? { search: search.trim().slice(0, 100) } : {}),
      ...(status ? { status } : {}),
      ...(manager ? { managerUserId: manager } : {}),
      ...(city ? { city } : {}),
      page,
      limit: PAGE,
    }),
    [search, status, manager, city, page],
  );
  const list = useApiQuery([...LOCATIONS, 'list', query], () => api.locations.list(query));
  const options = useApiQuery([...LOCATIONS, 'options'], () => api.locations.options());
  const activity = useApiQuery([...LOCATIONS, 'activity'], () =>
    api.locations.activity({ limit: 5 }),
  );
  const rows = list.data?.items ?? [];
  const k = list.data?.kpis;
  const n = (v: number | undefined) =>
    list.isPending ? <Skeleton className="h-8 w-10" /> : (v ?? '—');
  const selected = chosen ?? rows[0]?.id;
  const superAdmin = options.data?.canManageSchedules ?? false;
  const refilter = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const done = (text: string) => {
    setOpen(null);
    setNotice(text);
  };

  const menu = (r: LocationRow) => (
    <ActionMenu
      label={`More actions for ${r.name}`}
      trigger={<DotsThree aria-hidden weight="bold" className="size-5" />}
      sections={[
        {
          items: [
            {
              label: 'View Location Profile',
              icon: Eye,
              onSelect: () => setOpen({ kind: 'profile', id: r.id }),
            },
            {
              label: 'Edit Location',
              icon: PencilSimple,
              onSelect: () => router.push(`/settings/locations/${r.id}/edit`),
            },
            {
              label: 'Manage Staff',
              icon: UsersThree,
              onSelect: () => setOpen({ kind: 'staff', id: r.id }),
            },
            ...(!r.isMain && r.status === 'ACTIVE'
              ? [
                  {
                    label: 'Set as Primary',
                    icon: Star,
                    onSelect: () => setOpen({ kind: 'primary', id: r.id }),
                  },
                ]
              : []),
            ...(r.pendingAction && superAdmin
              ? [
                  {
                    label: 'Edit Schedule',
                    icon: CalendarCheck,
                    onSelect: () => setOpen({ kind: 'schedule', id: r.id }),
                  },
                ]
              : []),
            ...(r.status === 'ACTIVE' && !r.isMain && superAdmin
              ? [
                  {
                    label: 'Deactivate',
                    icon: WarningCircle,
                    danger: true,
                    onSelect: () => setOpen({ kind: 'deactivate', id: r.id }),
                  },
                ]
              : []),
          ],
        },
      ]}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="locations-screen">
      <SettingsHeader
        icon={MapPin}
        title="Locations"
        subtitle="Manage your office locations, assign staff, set a primary location, and keep your information up to date."
      />
      {notice ? <Toast tone="success" message={notice} onDismiss={() => setNotice('')} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="location-kpis">
        <SettingsKpi
          label="Total Locations"
          icon={BuildingOffice}
          tone="blue"
          value={n(k?.total)}
          note={
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:underline"
              onClick={() => refilter(() => setStatus(''))}
            >
              View all locations <ArrowRight aria-hidden weight="bold" className="size-4" />
            </button>
          }
        />
        <SettingsKpi
          label="Active Locations"
          icon={UsersThree}
          tone="blue"
          value={n(k?.active)}
          note={
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:underline"
              onClick={() => refilter(() => setStatus('ACTIVE'))}
            >
              View active locations <ArrowRight aria-hidden weight="bold" className="size-4" />
            </button>
          }
        />
        <SettingsKpi
          label="Subscription Usage"
          icon={FileText}
          tone="amber"
          value={
            list.isPending ? (
              <Skeleton className="h-8 w-14" />
            ) : k ? (
              `${k.subscription.used} / ${k.subscription.allowed ?? '∞'}`
            ) : (
              '—'
            )
          }
          note={
            <span className="flex flex-col">
              <span className="text-muted">Locations used</span>
              <Link
                href="/settings/billing"
                className="inline-flex items-center gap-1 font-semibold hover:underline"
              >
                Manage Plan <ArrowRight aria-hidden weight="bold" className="size-4" />
              </Link>
            </span>
          }
        />
      </div>

      <section
        aria-label="Location list"
        className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-end gap-3 [&>div:not(:first-child)]:w-full sm:[&>div:not(:first-child)]:w-36">
          <div className="min-w-56 flex-1">
            <Input
              label="Search locations"
              hideLabel
              type="search"
              placeholder="Search locations by name, city, or manager..."
              value={search}
              maxLength={100}
              onChange={(e) => refilter(() => setSearch(e.target.value))}
            />
          </div>
          <Select
            label="Status"
            hideLabel
            value={status}
            onChange={(e) => refilter(() => setStatus(e.target.value as typeof status))}
            options={[
              { value: '', label: 'All Statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
          <Select
            label="Manager"
            hideLabel
            value={manager}
            onChange={(e) => refilter(() => setManager(e.target.value))}
            options={[
              { value: '', label: 'All Managers' },
              ...(options.data?.members ?? []).map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
          <Select
            label="City"
            hideLabel
            value={city}
            onChange={(e) => refilter(() => setCity(e.target.value))}
            options={[
              { value: '', label: 'All Cities' },
              ...(options.data?.cities ?? []).map((c) => ({ value: c, label: c })),
            ]}
          />
          <Link
            href="/settings/locations/new"
            data-testid="add-location"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
          >
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Location
          </Link>
        </div>

        {list.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : list.isError ? (
          <Quiet>{NOT_LOADED}</Quiet>
        ) : !rows.length ? (
          <Quiet>
            {search || status || manager || city
              ? 'No locations match these filters.'
              : 'No locations yet. Add your first office.'}
          </Quiet>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm" data-testid="locations-table">
              <caption className="sr-only">Locations</caption>
              <thead>
                <tr className="text-heading">
                  {[
                    'Location Name',
                    'Address',
                    'City',
                    'Staff',
                    'Location Manager',
                    'Status',
                    'Actions',
                  ].map((h) => (
                    <th key={h} scope="col" className="px-2 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    data-testid="location-row"
                    aria-selected={r.id === selected}
                    onClick={() => setChosen(r.id)}
                    className={`cursor-pointer border-t border-divider ${r.id === selected ? 'bg-subtle' : ''}`}
                  >
                    <td className="px-2 py-2.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="text-left font-semibold text-heading hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpen({ kind: 'profile', id: r.id });
                          }}
                        >
                          {r.name}
                        </button>
                        {r.isMain ? <PrimaryBadge /> : null}
                        {r.pendingAction ? (
                          <span
                            className="text-xs text-warning"
                            title={zonedText(
                              r.pendingAction.effectiveAt,
                              options.data?.firmTimeZone ?? 'UTC',
                            )}
                          >
                            Change scheduled
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-text">{streetText(r) || '—'}</td>
                    <td className="px-2 py-2.5 text-text">{cityText(r)}</td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        aria-label={`${r.staffCount} staff at ${r.name}`}
                        className="font-semibold text-link underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen({ kind: 'staff', id: r.id });
                        }}
                      >
                        {r.staffCount}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      {r.manager ? (
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="flex size-8 items-center justify-center rounded-full bg-info-soft text-xs font-semibold text-info"
                          >
                            {initials(r.manager.name)}
                          </span>
                          <span className="text-text">
                            {r.manager.name}
                            {r.managerIsActing ? (
                              <span className="block text-xs text-muted">Acting</span>
                            ) : null}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">Unassigned</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <span className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          className="!min-h-9"
                          onClick={() => setOpen({ kind: 'profile', id: r.id })}
                        >
                          View
                        </Button>
                        <Link
                          href={`/settings/locations/${r.id}/edit`}
                          className="inline-flex min-h-9 items-center rounded-control border border-divider px-4 text-sm font-medium text-heading hover:bg-canvas"
                        >
                          Edit
                        </Link>
                        {menu(r)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <span>
              Showing {list.data.total ? (page - 1) * PAGE + 1 : 0} -{' '}
              {Math.min(page * PAGE, list.data.total)} of {list.data.total} locations
            </span>
            <span className="flex gap-2">
              <Button
                variant="secondary"
                className="!min-h-9"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                className="!min-h-9"
                disabled={page * PAGE >= list.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </span>
          </div>
        ) : null}
      </section>

      <div className="grid min-w-0 gap-4 min-[1400px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <DetailsCard id={selected} onProfile={(id) => setOpen({ kind: 'profile', id })} />
        <section
          aria-label="Recent Location Activity"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
          data-testid="location-activity"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-bold whitespace-nowrap text-heading">
              <ClockCounterClockwise aria-hidden weight="fill" className="size-6 text-action" />
              Recent Location Activity
            </h2>
            <Link
              href="/audit-log"
              className="inline-flex items-center gap-1 text-sm font-semibold whitespace-nowrap text-link hover:underline"
            >
              View All Activity <ArrowRight aria-hidden weight="bold" className="size-4" />
            </Link>
          </div>
          {activity.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : !activity.data ? (
            <Quiet>{NOT_LOADED}</Quiet>
          ) : !activity.data.items.length ? (
            <Quiet>No location activity yet.</Quiet>
          ) : (
            <ol className="flex flex-col divide-y divide-divider">
              {activity.data.items.map((a) => {
                const t = TONE[a.tone];
                const Glyph = t.icon;
                return (
                  <li key={a.id} className="flex items-start gap-3 py-2.5">
                    <span
                      aria-hidden
                      className={`flex size-9 shrink-0 items-center justify-center rounded-full ${t.tile}`}
                    >
                      <Glyph weight="fill" className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-heading">
                      {a.label}
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted">
                      {dayOf(a.at)}
                      <span className="block">{clockOf(a.at)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {open ? (
        <Opened open={open} superAdmin={superAdmin} onClose={() => setOpen(null)} onDone={done} />
      ) : null}
    </div>
  );
}

/** The dialog the row, the menu or the details card opened, on that location's profile. */
function Opened({
  open,
  superAdmin,
  onClose,
  onDone,
}: {
  open: NonNullable<Open>;
  superAdmin: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [kind, setKind] = useState(open.kind);
  const q = useLocation(open.id);
  const options = useApiQuery([...LOCATIONS, 'options'], () => api.locations.options());
  const members = options.data?.members ?? [];
  if (kind === 'profile') {
    return (
      <LocationProfileDialog
        locationId={open.id}
        onClose={onClose}
        onManageStaff={() => setKind('staff')}
      />
    );
  }
  const l = q.data;
  if (!l) return null;
  if (kind === 'staff')
    return <ManageStaffDialog location={l} members={members} onClose={onClose} onDone={onDone} />;
  if (kind === 'primary')
    return <SetPrimaryDialog location={l} onClose={onClose} onDone={onDone} />;
  if (kind === 'deactivate' && superAdmin) {
    return <DeactivateLocationDialog location={l} onClose={onClose} onDone={onDone} />;
  }
  if (kind === 'schedule' && l.pendingAction) {
    return (
      <ScheduleDialog
        action={l.pendingAction}
        zone={l.effectiveTimeZone}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }
  return null;
}

const TABS = ['Overview', 'Staff', 'Contact Info', 'Hours', 'Services', 'Notes'] as const;

/** The chosen location's details (the list design's lower card), with its tabs. */
function DetailsCard({
  id,
  onProfile,
}: {
  id: string | undefined;
  onProfile: (id: string) => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const q = useLocation(id);
  const l = q.data;
  return (
    <section
      aria-label="Location details"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
      data-testid="location-details"
    >
      <h2 className="flex items-center gap-2 text-lg font-bold text-heading">
        <BuildingOffice aria-hidden weight="fill" className="size-6 text-action" />
        {l ? `${l.name} Details` : 'Location Details'}
      </h2>
      {!id ? (
        <Quiet>Add a location to see its details here.</Quiet>
      ) : q.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : !l ? (
        <Quiet>{NOT_LOADED}</Quiet>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Location details"
            className="flex flex-wrap gap-4 border-b border-divider text-sm"
          >
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 pb-2 ${tab === t ? 'border-action font-semibold text-action' : 'border-transparent text-heading'}`}
              >
                {t === 'Staff' ? `Staff (${l.staff.length})` : t}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            {tab === 'Overview' ? (
              <LocationPhoto location={l} className="h-36 w-full shrink-0 rounded-lg sm:w-44" />
            ) : null}
            <dl className="grid min-w-0 flex-1 grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {(tab === 'Overview'
                ? [
                    [
                      'Location Name',
                      <span key="n" className="flex flex-wrap items-center gap-2">
                        {l.name}
                        {l.isMain ? <PrimaryBadge /> : null}
                      </span>,
                    ],
                    ['Address', addressText(l)],
                    [
                      'Phone',
                      l.phone ? (
                        <a key="p" href={`tel:${l.phone}`} className="text-link hover:underline">
                          {phoneText(l.phone)}
                        </a>
                      ) : (
                        '—'
                      ),
                    ],
                    [
                      'Email',
                      l.email ? (
                        <a key="e" href={`mailto:${l.email}`} className="text-link hover:underline">
                          {l.email}
                        </a>
                      ) : (
                        '—'
                      ),
                    ],
                    [
                      'Location Manager',
                      l.manager ? (
                        <span key="m" className="flex items-center gap-2">
                          <UserCircle aria-hidden weight="fill" className="size-5 text-info" />
                          {l.manager.name}
                        </span>
                      ) : (
                        'Unassigned'
                      ),
                    ],
                    ['Status', <StatusBadge key="s" status={l.status} />],
                    ['Operating Hours', hoursSummary(l.hours)],
                  ]
                : tab === 'Staff'
                  ? l.staff.length
                    ? l.staff.map((p) => [p.name, p.jobTitle ?? ''])
                    : [['Staff', 'No staff assigned yet']]
                  : tab === 'Contact Info'
                    ? [
                        ['Phone', phoneText(l.phone) || '—'],
                        ['Alternate Phone', phoneText(l.alternatePhone) || '—'],
                        ['Email', l.email ?? '—'],
                        ['Time Zone', l.effectiveTimeZone],
                      ]
                    : tab === 'Hours'
                      ? WEEK_ORDER.map((d) => [WEEKDAYS[d], dayText(l.hours, d)])
                      : tab === 'Services'
                        ? l.services.length
                          ? l.services.map((s) => [s.name, ''])
                          : [['Services', 'No services chosen yet']]
                        : [['Notes', l.notes ?? 'No notes']]
              ).map(([label, value]) => (
                <div key={String(label)} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="min-w-0 wrap-anywhere text-heading">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Button variant="secondary" className="w-fit" onClick={() => onProfile(l.id)}>
            View Full Profile
          </Button>
        </>
      )}
    </section>
  );
}
