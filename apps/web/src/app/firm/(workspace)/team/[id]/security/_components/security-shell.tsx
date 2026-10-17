'use client';

import { Avatar, Badge, Callout, Skeleton } from '@firmivra/ui';
import { ArrowLeft, GearSix, Info, LockSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NOT_LOADED } from '../../../_components/quiet-card';
import { STATUS_LOOKS, longDate } from '../../_components/staff-parts';
import { useMember } from '../../_components/use-member';
import { AccountButtons } from './account-buttons';
import { Panel } from './panel';

/** The six tabs; each is its own page (PAGE-MAP). */
export const SECURITY_TABS = [
  { id: 'overview', path: '', label: 'Account Overview' },
  { id: 'login', path: '/login', label: 'Login & Security' },
  { id: 'sessions', path: '/sessions', label: 'Active Sessions' },
  { id: 'history', path: '/history', label: 'Login History' },
  { id: 'permissions', path: '/permissions', label: 'Permissions' },
  { id: 'activity', path: '/activity', label: 'Activity & Audit' },
] as const;
export type SecurityTab = (typeof SECURITY_TABS)[number]['id'];

export const tabHref = (id: string, tab: SecurityTab) =>
  `/team/${id}/security${SECURITY_TABS.find((t) => t.id === tab)?.path ?? ''}`;

/**
 * The top of every Staff Account Access & Security tab (staff-account-access-and-security.jpg,
 * guide §14): Back to Staff Management, the title, the member's summary, Quick Actions and the
 * tab bar. The tab's own cards follow.
 */
export function SecurityShell({
  id,
  tab,
  children,
}: {
  id: string;
  tab: SecurityTab;
  children: ReactNode;
}) {
  const { member: m, pending, failed, notFound, manages, admin } = useMember(id);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link
          href="/team"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Staff Management
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
              <LockSimple aria-hidden weight="fill" className="size-9" />
            </span>
            <div className="min-w-0">
              <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
                Staff Account Access &amp; Security
              </h1>
              <p className="text-base text-link">
                Manage login access, security settings, active sessions, and account controls.
              </p>
            </div>
          </div>
          <div
            aria-hidden
            className="hidden items-center gap-5 text-xs tracking-brand text-heading uppercase xl:flex"
          >
            <p className="flex flex-col gap-1 text-sm font-semibold">
              <span>Secure people.</span>
              <span>Stronger practices.</span>
            </p>
            <span className="h-14 w-px bg-gold" />
            <p className="flex flex-col gap-1.5">
              <span>Trusted teams.</span>
              <span>Protected data.</span>
              <span>Brighter futures.</span>
            </p>
          </div>
        </div>
      </header>

      {failed ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          {notFound ? failed : NOT_LOADED}
        </Callout>
      ) : m?.isYou ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          This is your own account. Another Owner or Admin changes your access and security.
        </Callout>
      ) : m && !admin ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          Only an Owner or an Admin can change account security. You can read this one.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-[3fr_2fr]">
        <section
          aria-label="Staff member"
          data-testid="security-member"
          className="min-w-0 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          {!m ? (
            pending ? (
              <Skeleton className="h-28" />
            ) : (
              <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{failed ?? NOT_LOADED}</p>
            )
          ) : (
            <div className="grid gap-4 md:grid-cols-3 md:divide-x md:divide-divider">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar name={m.name} src={m.avatarUrl ?? undefined} size="xl" />
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-xl font-bold break-words text-heading">{m.name}</p>
                  <span className="w-fit">
                    <Badge tone={STATUS_LOOKS[m.status].tone} dot>
                      {STATUS_LOOKS[m.status].label}
                    </Badge>
                  </span>
                  <p className="text-sm text-link">{m.jobTitle ?? '—'}</p>
                  <p className="text-sm text-link">
                    {m.departments.map((d) => d.name).join(', ') || 'No department'}
                  </p>
                </div>
              </div>
              <Facts
                rows={[
                  ['Work Email', m.email],
                  ['Phone', m.phone ?? '—'],
                  ['Employee ID', m.profile.employeeId ?? '—'],
                ]}
              />
              <Facts
                rows={[
                  ['Department(s)', m.departments.map((d) => d.name).join(', ') || '—'],
                  ['Manager', m.profile.supervisor?.name ?? '—'],
                  [
                    'Hire Date',
                    m.profile.hireDate ? longDate(`${m.profile.hireDate}T12:00:00`) : '—',
                  ],
                ]}
              />
            </div>
          )}
        </section>
        <Panel title="Quick Actions" icon={GearSix} testId="security-quick-actions">
          <AccountButtons member={m} enabled={manages} testId="quick-buttons" />
        </Panel>
      </div>

      <nav
        aria-label="Account security"
        className="flex gap-1 overflow-x-auto border-b border-divider sm:gap-2"
      >
        {SECURITY_TABS.map((t) => {
          const on = t.id === tab;
          return (
            <Link
              key={t.id}
              href={tabHref(id, t.id)}
              aria-current={on ? 'page' : undefined}
              className={`min-h-11 border-b-3 px-3 py-3 text-sm font-medium whitespace-nowrap sm:px-5 ${on ? 'border-action text-action' : 'border-transparent text-heading hover:text-action'}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="flex min-w-0 flex-col gap-2 md:pl-4">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-sm font-semibold text-heading">{label}</dt>
          <dd className="text-sm break-words text-link">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
