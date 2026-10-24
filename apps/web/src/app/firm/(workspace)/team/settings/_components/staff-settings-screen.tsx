'use client';

import type { StaffSecurityDefaults } from '@firmivra/types';
import { Badge, Skeleton } from '@firmivra/ui';
import {
  ArrowLeft,
  Briefcase,
  CheckCircle,
  GearSix,
  type Icon,
  LockKey,
  ShieldCheck,
  TreeStructure,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, createElement } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED } from '../../_components/quiet-card';
import { NeedHelpCard } from '../../_components/need-help-card';

const quiet = 'rounded-lg bg-subtle p-4 text-sm text-muted';

function Card({
  title,
  subtitle,
  icon,
  href,
  action,
  testId,
  children,
}: {
  title: string;
  subtitle: string;
  icon: Icon;
  href: string;
  action: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info"
        >
          {createElement(icon, { weight: 'fill', className: 'size-6' })}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-heading">{title}</h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      <div className="flex-1">{children}</div>
      <Link
        href={href}
        className="inline-flex min-h-10 w-fit items-center rounded-lg border border-action px-4 text-sm font-semibold text-action hover:bg-folder-surface"
      >
        {action}
      </Link>
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col divide-y divide-divider">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2">
          <dt className="text-sm text-heading">{label}</dt>
          <dd className="text-right text-sm font-semibold text-link">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A card's body while its call runs, when it failed, or its facts. */
function Body<T>({
  query,
  children,
}: {
  query: { isPending: boolean; data: T | undefined };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Skeleton className="h-24" />;
  if (query.data === undefined) return <p className={quiet}>{NOT_LOADED}</p>;
  return <>{children(query.data)}</>;
}

const minutes = (m: number) => (m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`);

/** New Account Security: the fixed rules, then the firm's defaults for new accounts. */
const securityRows = (d: StaffSecurityDefaults): [string, ReactNode][] => [
  [
    'Two-factor sign-in',
    <Badge key="2fa" tone="success" icon={CheckCircle}>
      Always required
    </Badge>,
  ],
  ['Sign-in methods', `${d.allowedAuthMethods.length} allowed`],
  [
    'Access from',
    d.accessLocation === 'ANYWHERE'
      ? 'Anywhere'
      : d.accessLocation === 'ALLOWED_IPS'
        ? 'Specific IP addresses'
        : 'Specific countries',
  ],
  ['Automatic logout', d.autoLogoutMinutes ? `After ${minutes(d.autoLogoutMinutes)}` : 'Off'],
  ['Concurrent sessions', d.maxConcurrentSessions],
];

/**
 * Staff Management > Staff Settings (`/team/settings`, guide §1, §3): the firm's staff defaults in
 * one place. Each card shows what the firm has today and opens the page that changes it.
 */
export function StaffSettingsScreen() {
  const summary = useApiQuery(['staff', 'summary'], () => api.staff.summary());
  const roles = useApiQuery(['roles', 'list'], () => api.roles.list());
  const groups = useApiQuery(['departments', 'summary'], () => api.departments.summary());
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const defaults = useApiQuery(['staff', 'security-defaults'], () => api.staff.securityDefaults());

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/team"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Staff Management
        </Link>
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <GearSix aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              Staff Settings
            </h1>
            <p className="text-base text-link">
              Your firm&apos;s staff defaults: security for new accounts, roles, departments and
              where people work.
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-3">
        <Card
          title="New Account Security"
          subtitle="What every new staff account starts with. Existing accounts keep their own."
          icon={LockKey}
          href="/team/settings/security"
          action="Manage New Account Security"
          testId="settings-security"
        >
          <Body query={defaults}>{(d) => <Facts rows={securityRows(d)} />}</Body>
        </Card>

        <Card
          title="Roles & Permissions"
          subtitle="The roles you give staff and what each one can do."
          icon={ShieldCheck}
          href="/team/roles"
          action="Manage Roles & Permissions"
          testId="settings-roles"
        >
          <Body query={roles}>
            {(r) => (
              <Facts
                rows={r.items.map((x) => [
                  x.label,
                  `${x.memberCount} member${x.memberCount === 1 ? '' : 's'}${x.customized ? ' · changed' : ''}`,
                ])}
              />
            )}
          </Body>
        </Card>

        <Card
          title="Staff Directory"
          subtitle="Who has an account, and who still has to accept their invitation."
          icon={UsersThree}
          href="/team/directory"
          action="Open Staff Directory"
          testId="settings-directory"
        >
          <Body query={summary}>
            {(s) => (
              <Facts
                rows={[
                  ['Total staff', s.total],
                  ['Active', s.active],
                  ['Pending invitations', s.invited],
                  ['Locked', s.locked],
                  ['Deactivated', s.inactive],
                ]}
              />
            )}
          </Body>
        </Card>

        <Card
          title="Departments & Teams"
          subtitle="How staff are grouped, and who leads each group."
          icon={TreeStructure}
          href="/team/departments"
          action="Manage Departments & Teams"
          testId="settings-groups"
        >
          <Body query={groups}>
            {(g) => (
              <Facts
                rows={[
                  ['Departments', g.departments],
                  ['Teams', g.teams],
                  ['Staff in departments', g.staff],
                ]}
              />
            )}
          </Body>
        </Card>

        <Card
          title="Offices & Job Titles"
          subtitle="The offices and titles your staff records use, offered when you create or edit staff."
          icon={Briefcase}
          href="/team/new"
          action="Add a Staff Member"
          testId="settings-offices"
        >
          <Body query={options}>
            {(o) => (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-semibold text-heading">Offices</p>
                  <p className="text-sm text-text">
                    {o.offices.length ? o.offices.join(', ') : 'No offices on staff records yet.'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-heading">Job titles</p>
                  <p className="text-sm text-text">
                    {o.jobTitles.length ? o.jobTitles.join(', ') : 'No job titles yet.'}
                  </p>
                </div>
              </div>
            )}
          </Body>
        </Card>

        <NeedHelpCard />
      </div>
    </div>
  );
}
