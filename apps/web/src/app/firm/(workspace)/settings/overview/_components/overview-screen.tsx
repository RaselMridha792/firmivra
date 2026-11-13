'use client';

import type { AdminActivityTone, LocationRow } from '@firmivra/types';
import { Button, Skeleton, Toast } from '@firmivra/ui';
import {
  ArrowRight,
  BuildingOffice,
  CheckCircle,
  ClockCountdown,
  CreditCard,
  Database,
  FileText,
  GearSix,
  type Icon,
  Info,
  PaintBrush,
  Plus,
  ShieldCheck,
  ShieldChevron,
  UsersThree,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { createElement, type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import {
  BandCard,
  NOT_LOADED,
  Quiet,
  SettingsHeader,
  SettingsKpi,
} from '../../_components/settings-parts';
import {
  LocationOpened,
  type LocationOpen,
  LocationRowMenu,
} from '../../locations/_components/location-actions';
import { LOCATIONS, StatusBadge, streetText } from '../../locations/_components/location-parts';

const QUICK: {
  title: string;
  line: string;
  link: string;
  href: string;
  icon: Icon;
  card: 'blue' | 'amber';
  tile: string;
}[] = [
  {
    title: 'Location Management',
    line: 'Add, edit, or manage your office locations.',
    link: 'Manage Locations',
    href: '/settings/locations',
    icon: BuildingOffice,
    card: 'blue',
    tile: 'bg-success-soft text-success',
  },
  {
    title: 'Branding & White Label',
    line: 'Logo, dashboard colors, email identity, and portal branding.',
    link: 'Customize Branding',
    href: '/settings/branding',
    icon: PaintBrush,
    card: 'amber',
    tile: 'bg-warning-soft text-heading',
  },
  {
    title: 'Users & Permissions',
    line: 'Invite staff and control role-based access.',
    link: 'Manage Access',
    href: '/settings/users',
    icon: UsersThree,
    card: 'blue',
    tile: 'bg-info-soft text-action',
  },
  {
    title: 'Billing & Subscriptions',
    line: 'Plans, invoices, payment methods, and usage.',
    link: 'Manage Billing',
    href: '/settings/billing',
    icon: CreditCard,
    card: 'amber',
    tile: 'bg-warning-soft text-heading',
  },
  {
    title: 'Security & Compliance',
    line: 'MFA, sessions, password policy, retention, and consent.',
    link: 'Review Security',
    href: '/settings/security',
    icon: ShieldChevron,
    card: 'blue',
    tile: 'bg-success-soft text-success',
  },
  {
    title: 'System & Data',
    line: 'Default preferences, backups, imports, exports, and audit history.',
    link: 'System Settings',
    href: '/settings/data',
    icon: Database,
    card: 'amber',
    tile: 'bg-warning-soft text-heading',
  },
];

const TONES: Record<AdminActivityTone, [Icon, string]> = {
  success: [CheckCircle, 'text-success'],
  warning: [ClockCountdown, 'text-gold'],
  info: [Info, 'text-action'],
  user: [UsersThree, 'text-action'],
  system: [GearSix, 'text-action'],
};

/** "9:42 AM" today, "Yesterday", else "Sep 20, 2026". */
function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.round(
    (new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) /
      86_400_000,
  );
  if (days === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A KPI card's link: "Manage Locations →". */
function KpiLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 font-semibold whitespace-nowrap hover:underline"
    >
      {children} <ArrowRight aria-hidden weight="bold" className="size-4" />
    </Link>
  );
}

/** "123 Main St, Auburn, GA", or Online / Remote. */
function placeText(r: LocationRow) {
  if (r.kind === 'VIRTUAL') return streetText(r);
  return [r.addressLine1, r.city, r.state].filter(Boolean).join(', ') || '—';
}

const OVERVIEW = ['settings', 'overview'] as const;

/**
 * Settings > Overview (setting-overview.jpg; Octavia's Overview guide of Oct 18, items 3 to 5 and
 * 10 to 13): the KPI row (Active Locations, Staff Users across all locations, Subscription &
 * Locations, Security Alerts), Location Management (the first 5 locations with Locations' own
 * actions), Quick Settings and Recent Administrative Activity (`api.settingsOverview.get`, R1's
 * location fields). The design's Settings Menu is the Settings layout's menu.
 */
export function OverviewScreen() {
  const qc = useQueryClient();
  const overview = useApiQuery([...OVERVIEW], () => api.settingsOverview.get());
  const options = useApiQuery([...LOCATIONS, 'options'], () => api.locations.options());
  const superAdmin = options.data?.canManageSchedules ?? false;
  const [open, setOpen] = useState<LocationOpen>(null);
  const [notice, setNotice] = useState('');
  const o = overview.data;
  const loading = overview.isPending;
  const n = (value: number | undefined) =>
    loading ? <Skeleton className="h-8 w-12" /> : (value ?? '—');
  const allowance = o?.locationAllowance;
  const done = (text: string) => {
    setOpen(null);
    setNotice(text);
    void qc.invalidateQueries({ queryKey: [...OVERVIEW] });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        icon={GearSix}
        title="Settings"
        crumb={false}
        subtitle="Manage your company, locations, users, security, billing, branding, and system preferences."
      />
      {notice ? <Toast tone="success" message={notice} onDismiss={() => setNotice('')} /> : null}

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[1440px]:grid-cols-4"
        data-testid="settings-kpis"
      >
        <SettingsKpi
          label="Active Locations"
          icon={BuildingOffice}
          tone="blue"
          testId="kpi-active-locations"
          value={n(o?.activeLocations?.value)}
          change={o?.activeLocations?.addedThisMonth}
          note={<KpiLink href="/settings/locations">Manage Locations</KpiLink>}
        />
        <SettingsKpi
          label="Staff Users"
          icon={UsersThree}
          tone="blue"
          testId="kpi-staff-users"
          value={n(o?.staffUsers.value)}
          change={o?.staffUsers.addedThisMonth}
          note={
            <span className="flex flex-col">
              <span className="text-muted">Across all locations</span>
              <KpiLink href="/settings/users">Manage Users</KpiLink>
            </span>
          }
        />
        <SettingsKpi
          label="Subscription & Locations"
          icon={FileText}
          tone="amber"
          testId="kpi-subscription-locations"
          value={
            loading ? (
              <Skeleton className="h-8 w-14" />
            ) : allowance ? (
              `${allowance.used} / ${allowance.allowed ?? '∞'}`
            ) : (
              '—'
            )
          }
          note={
            <span className="flex flex-col">
              <span className="text-muted">Locations used</span>
              <KpiLink href="/settings/billing">Manage Plan</KpiLink>
            </span>
          }
        />
        <SettingsKpi
          label="Security Alerts"
          icon={ShieldCheck}
          tone="blue"
          testId="kpi-security-alerts"
          value={n(o?.securityAlerts)}
          note={
            <span className="flex flex-col">
              <span className="text-muted">
                {o && !o.securityAlerts ? 'Nothing to review' : 'Requires review'}
              </span>
              {/* Overview guide 6: Security & Access, its open alerts (never Notifications). */}
              <KpiLink href="/settings/security?alerts=open">View Alerts</KpiLink>
            </span>
          }
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <BandCard
          id="location-management"
          title="Location Management"
          testId="location-management"
          action={
            <span className="flex flex-wrap items-center justify-end gap-3">
              <Link
                href="/settings/locations"
                className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline"
              >
                View All Locations
                <ArrowRight aria-hidden weight="bold" className="size-4" />
              </Link>
              <Link
                href="/settings/locations/new"
                className="inline-flex min-h-10 items-center gap-2 rounded-control bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover"
              >
                <Plus aria-hidden weight="bold" className="size-4" />
                Add Location
              </Link>
            </span>
          }
        >
          <div className="px-4 py-2">
            {loading ? (
              <Skeleton className="my-2 h-32" />
            ) : !o?.locations ? (
              <Quiet>{NOT_LOADED}</Quiet>
            ) : !o.locations.length ? (
              <Quiet>No locations yet. Add your first office.</Quiet>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <caption className="sr-only">Locations</caption>
                  <thead>
                    <tr className="border-b border-divider text-heading">
                      {[
                        'Location Name',
                        'Address',
                        'Assigned Staff',
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
                    {o.locations.map((r) => (
                      <tr
                        key={r.id}
                        data-testid="overview-location-row"
                        className="border-t border-divider first:border-t-0"
                      >
                        <td className="px-2 py-2 text-heading">{r.name}</td>
                        <td className="px-2 py-2 text-text">{placeText(r)}</td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            aria-label={`${r.staffCount} staff at ${r.name}`}
                            className="font-semibold text-link hover:underline"
                            onClick={() => setOpen({ kind: 'staff', id: r.id })}
                          >
                            {r.staffCount}
                          </button>
                        </td>
                        <td className="px-2 py-2 text-text">
                          {r.manager ? (
                            r.manager.name
                          ) : (
                            <span className="text-muted">Unassigned</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-2 py-2">
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
                            <LocationRowMenu row={r} superAdmin={superAdmin} onOpen={setOpen} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </BandCard>

        <section
          id="quick-settings"
          aria-labelledby="quick-settings-title"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <h2 id="quick-settings-title" className="text-lg font-bold text-heading">
            Quick Settings
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 min-[1440px]:grid-cols-3">
            {QUICK.map((q) => (
              <div
                key={q.title}
                className={`flex gap-4 rounded-xl border p-4 ${q.card === 'amber' ? 'border-warning-soft bg-warning-soft/60' : 'border-info-soft bg-info-soft/70'}`}
              >
                <span
                  aria-hidden
                  className={`flex size-14 shrink-0 items-center justify-center rounded-xl ${q.tile}`}
                >
                  {createElement(q.icon, { weight: 'fill', className: 'size-8' })}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="font-bold text-heading">{q.title}</h3>
                  <p className="text-sm text-link">{q.line}</p>
                  <Link
                    href={q.href}
                    className="inline-flex min-h-9 w-fit items-center gap-2 font-semibold text-action hover:underline"
                  >
                    {q.link}
                    <ArrowRight aria-hidden weight="bold" className="size-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        <BandCard
          title="Recent Administrative Activity"
          testId="recent-admin-activity"
          action={
            <Link
              href="/audit-log"
              className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline"
            >
              View All
              <ArrowRight aria-hidden weight="bold" className="size-4" />
            </Link>
          }
        >
          <div className="px-4 pb-2">
            {loading ? (
              <Skeleton className="my-3 h-40" />
            ) : !o ? (
              <p className="my-3 rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
            ) : o.recentActivity.length ? (
              <ul className="flex flex-col divide-y divide-divider">
                {o.recentActivity.slice(0, 5).map((a) => {
                  const [icon, color] = TONES[a.tone];
                  return (
                    <li key={a.id} className="flex items-center gap-3 py-2.5">
                      {createElement(icon, {
                        'aria-hidden': true,
                        weight: 'fill',
                        className: `size-7 shrink-0 ${color}`,
                      })}
                      <span className="min-w-0 flex-1 text-sm text-link">{a.label}</span>
                      <time dateTime={a.at} className="shrink-0 text-sm text-muted">
                        {when(a.at)}
                      </time>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="my-3 rounded-lg bg-subtle p-4 text-sm text-muted">
                No administrative changes yet. Changes to users, roles and settings show here.
              </p>
            )}
          </div>
        </BandCard>
      </div>
      {open ? (
        <LocationOpened
          open={open}
          superAdmin={superAdmin}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      ) : null}
    </div>
  );
}
