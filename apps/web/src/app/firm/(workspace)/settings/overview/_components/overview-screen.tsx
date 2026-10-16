'use client';

import type { AdminActivityTone } from '@firmivra/types';
import { Skeleton, type TileTone, tileTones } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowUp,
  Buildings,
  CheckCircle,
  ClockCountdown,
  CreditCard,
  Database,
  FileText,
  GearSix,
  type Icon,
  Info,
  PaintBrush,
  ShieldCheck,
  ShieldChevron,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, createElement } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, SettingsHeader } from '../../_components/settings-parts';

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
    title: 'Company Management',
    line: 'Approve, suspend, or manage company accounts.',
    link: 'Manage Companies',
    href: '#company-applications',
    icon: Buildings,
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

const card = 'flex min-w-0 flex-col rounded-xl border border-divider bg-surface shadow-sm';
const band = 'flex items-center justify-between gap-3 rounded-t-xl bg-subtle px-4 py-3';

function Kpi({
  label,
  icon,
  tone,
  value,
  change,
  note,
  testId,
}: {
  label: string;
  icon: Icon;
  tone: TileTone;
  value: ReactNode;
  change?: number;
  note: string;
  testId: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className="flex items-center gap-3 rounded-xl border border-divider bg-surface px-4 py-4 shadow-sm"
    >
      <span
        aria-hidden
        className={`flex size-14 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
      >
        {createElement(icon, { weight: 'fill', className: 'size-7' })}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-heading">{label}</h2>
        <div className="flex items-baseline gap-3 text-3xl font-bold text-heading">
          {value}
          {change ? (
            <span className="flex items-center gap-0.5 text-base font-semibold text-success">
              <ArrowUp aria-hidden weight="bold" className="size-4" />
              {change}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-link">{note}</p>
      </div>
    </section>
  );
}

/**
 * Settings > Overview (settings.jpg, guide §2-3), as drawn: the KPI row (Active Companies, Staff
 * Users, Pending Applications, Security Alerts), Company Applications, Quick Settings and Recent
 * Administrative Activity (`api.settingsOverview.get`). The company numbers
 * and applications are platform data the firm API leaves out (contract), so those widgets keep
 * their frames with a quiet line (design-match rule 2). The design's Settings Menu is the Settings
 * layout's menu, as on every Settings page.
 */
export function OverviewScreen() {
  const overview = useApiQuery(['settings', 'overview'], () => api.settingsOverview.get());
  const o = overview.data;
  const loading = overview.isPending;
  const n = (value: number | undefined) =>
    loading ? <Skeleton className="h-8 w-12" /> : (value ?? '—');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        icon={GearSix}
        title="Settings"
        crumb={false}
        subtitle="Manage your company, users, security, billing, branding, and system preferences."
      />

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[1440px]:grid-cols-4"
        data-testid="settings-kpis"
      >
        <Kpi
          label="Active Companies"
          icon={Buildings}
          tone="blue"
          testId="kpi-active-companies"
          value={n(o?.activeCompanies?.value)}
          change={o?.activeCompanies?.addedThisMonth}
          note="Approved accounts"
        />
        <Kpi
          label="Staff Users"
          icon={UsersThree}
          tone="blue"
          testId="kpi-staff-users"
          value={n(o?.staffUsers.value)}
          change={o?.staffUsers.addedThisMonth}
          note="Across all companies"
        />
        <Kpi
          label="Pending Applications"
          icon={FileText}
          tone="amber"
          testId="kpi-pending-applications"
          value={n(o?.pendingApplications)}
          note="Awaiting review"
        />
        <Kpi
          label="Security Alerts"
          icon={ShieldCheck}
          tone="blue"
          testId="kpi-security-alerts"
          value={n(o?.securityAlerts)}
          note={o && !o.securityAlerts ? 'Nothing to review' : 'Review required'}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <section
          id="company-applications"
          aria-labelledby="company-applications-title"
          data-testid="company-applications"
          className={card}
        >
          <div className={band}>
            <h2
              id="company-applications-title"
              className="flex items-center gap-3 text-lg font-bold text-heading"
            >
              Company Applications
              {o?.pendingApplications ? (
                <span className="rounded-full bg-danger-soft px-3 py-0.5 text-sm font-medium text-danger">
                  {o.pendingApplications} Pending
                </span>
              ) : null}
            </h2>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-muted">
              View All
              <ArrowRight aria-hidden weight="bold" className="size-4" />
            </span>
          </div>
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Company applications</caption>
              <thead>
                <tr className="border-b border-divider text-left text-heading">
                  {['Company', 'Applicant', 'Submitted', 'Status', 'Actions'].map((h) => (
                    <th key={h} scope="col" className="py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={5} className="py-4 text-muted">
                    {loading ? (
                      <Skeleton className="h-6" />
                    ) : (
                      'Company applications are reviewed by the Firmivra team; none are shown to a firm.'
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="flex items-center gap-2 border-t border-divider px-4 py-2.5 text-xs text-link">
            <Info aria-hidden weight="bold" className="size-4 shrink-0" />
            Review verifies business details, owner identity, subscription selection, and required
            documents before approval.
          </p>
        </section>

        <section
          id="quick-settings"
          aria-labelledby="quick-settings-title"
          className={`${card} gap-3 p-4`}
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

        <section
          aria-labelledby="recent-activity"
          data-testid="recent-admin-activity"
          className={card}
        >
          <div className={band}>
            <h2 id="recent-activity" className="text-lg font-bold text-heading">
              Recent Administrative Activity
            </h2>
            <Link
              href="/audit-log"
              className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline"
            >
              View All
              <ArrowRight aria-hidden weight="bold" className="size-4" />
            </Link>
          </div>
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
        </section>
      </div>
    </div>
  );
}
