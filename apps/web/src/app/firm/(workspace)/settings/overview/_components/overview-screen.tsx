'use client';

import type { AdminActivityTone } from '@firmivra/types';
import { Skeleton, type TileTone, tileTones } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowUp,
  CheckCircle,
  ClockCountdown,
  CreditCard,
  Database,
  GearSix,
  type Icon,
  Info,
  PaintBrush,
  ShieldCheck,
  User,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, createElement } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, Quiet, SettingsHeader } from '../../_components/settings-parts';

const QUICK: {
  title: string;
  line: string;
  link: string;
  href: string;
  icon: Icon;
  tone: TileTone;
}[] = [
  {
    title: 'Branding & White Label',
    line: 'Logo, dashboard colors, email identity, and portal branding.',
    link: 'Customize Branding',
    href: '/settings/branding',
    icon: PaintBrush,
    tone: 'amber',
  },
  {
    title: 'Users & Permissions',
    line: 'Invite staff and control role-based access.',
    link: 'Manage Access',
    href: '/settings/users',
    icon: UsersThree,
    tone: 'blue',
  },
  {
    title: 'Billing & Subscriptions',
    line: 'Plans, invoices, payment methods, and usage.',
    link: 'Manage Billing',
    href: '/settings/billing',
    icon: CreditCard,
    tone: 'amber',
  },
  {
    title: 'Security & Compliance',
    line: 'MFA, sessions, password policy, retention, and consent.',
    link: 'Review Security',
    href: '/settings/security',
    icon: ShieldCheck,
    tone: 'green',
  },
  {
    title: 'System & Data',
    line: 'Default preferences, backups, imports, exports, and audit history.',
    link: 'System Settings',
    href: '/settings/preferences',
    icon: Database,
    tone: 'navy',
  },
  {
    title: 'Company Profile',
    line: 'Company identity, contact information, and defaults.',
    link: 'Edit Profile',
    href: '/settings/profile',
    icon: User,
    tone: 'purple',
  },
];

const TONES: Record<AdminActivityTone, [Icon, string]> = {
  success: [CheckCircle, 'text-success'],
  warning: [ClockCountdown, 'text-gold'],
  info: [Info, 'text-info'],
  user: [UsersThree, 'text-info'],
  system: [GearSix, 'text-info'],
};

/** "9:42 AM" today, "Yesterday", else "Sep 20, 2026". */
function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000,
  );
  if (days === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Kpi({
  label,
  icon,
  tone,
  value,
  note,
  testId,
}: {
  label: string;
  icon: Icon;
  tone: TileTone;
  value: ReactNode;
  note: ReactNode;
  testId: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className="flex items-center gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <span
        aria-hidden
        className={`flex size-16 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
      >
        {createElement(icon, { weight: 'fill', className: 'size-8' })}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-heading">{label}</h2>
        <div className="text-3xl font-bold text-heading">{value}</div>
        <p className="text-sm text-link">{note}</p>
      </div>
    </section>
  );
}

/**
 * Settings > Overview (settings.jpg, guide §2): Staff Users and Security Alerts, Quick Settings
 * and Recent Administrative Activity (`api.settingsOverview.get`). The design's platform parts
 * (Active Companies, Pending Applications, Company Applications, Company Management) belong to
 * the Super Admin console and are left out for a firm (contract). The Settings Menu is the
 * Settings layout's menu, next to every Settings page.
 */
export function OverviewScreen() {
  const overview = useApiQuery(['settings', 'overview'], () => api.settingsOverview.get());
  const o = overview.data;
  const loading = overview.isPending;
  const number = (value: number | undefined) =>
    loading ? <Skeleton className="h-8 w-12" /> : (value ?? '—');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={GearSix}
        title="Settings"
        crumb={false}
        subtitle="Manage your company, users, security, billing, branding, and system preferences."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Kpi
          label="Staff Users"
          icon={UsersThree}
          tone="blue"
          testId="kpi-staff-users"
          value={
            <span className="flex items-baseline gap-3">
              {number(o?.staffUsers.value)}
              {o?.staffUsers.addedThisMonth ? (
                <span className="flex items-center gap-1 text-base text-success">
                  <ArrowUp aria-hidden weight="bold" className="size-4" />
                  {o.staffUsers.addedThisMonth}
                </span>
              ) : null}
            </span>
          }
          note={o ? 'Members of your firm' : overview.isError ? 'Not loaded' : ' '}
        />
        <Kpi
          label="Security Alerts"
          icon={ShieldCheck}
          tone="blue"
          testId="kpi-security-alerts"
          value={number(o?.securityAlerts)}
          note={
            o ? (
              <Link href="/settings/security" className="hover:underline">
                {o.securityAlerts ? 'Review required' : 'Nothing to review'}
              </Link>
            ) : overview.isError ? (
              'Not loaded'
            ) : (
              ' '
            )
          }
        />
      </div>

      <section
        aria-labelledby="quick-settings"
        className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
      >
        <h2 id="quick-settings" className="text-xl font-bold text-heading">
          Quick Settings
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 min-[1440px]:grid-cols-3">
          {QUICK.map((q) => (
            <div
              key={q.title}
              className={`flex gap-4 rounded-xl p-4 ${q.tone === 'amber' ? 'bg-warning-soft' : 'bg-info-soft'}`}
            >
              <span
                aria-hidden
                className={`flex size-14 shrink-0 items-center justify-center rounded-xl bg-surface ${tileTones[q.tone]}`}
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
        className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-activity" className="text-xl font-bold text-heading">
            Recent Administrative Activity
          </h2>
          <Link
            href="/audit-log"
            className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-link hover:underline"
          >
            View All
            <ArrowRight aria-hidden weight="bold" className="size-4" />
          </Link>
        </div>
        {loading ? (
          <Skeleton className="h-40" />
        ) : !o ? (
          <Quiet>{NOT_LOADED}</Quiet>
        ) : o.recentActivity.length ? (
          <ul className="flex flex-col divide-y divide-divider">
            {o.recentActivity.slice(0, 5).map((a) => {
              const [icon, color] = TONES[a.tone];
              return (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  {createElement(icon, {
                    'aria-hidden': true,
                    weight: 'fill',
                    className: `size-6 shrink-0 ${color}`,
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
          <Quiet>
            No administrative changes yet. Changes to users, roles and settings show here.
          </Quiet>
        )}
      </section>
    </div>
  );
}
