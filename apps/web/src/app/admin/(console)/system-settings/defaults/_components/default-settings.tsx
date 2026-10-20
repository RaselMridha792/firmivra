'use client';

import type { AdminFirmDefaults, AdminUserDefaults } from '@firmivra/types';
import { Card, Input, Select, Toggle } from '@firmivra/ui';
import {
  Buildings,
  Cube,
  EnvelopeSimple,
  FileText,
  PencilSimple,
  ShieldCheck,
  User,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  Body,
  QuietLine,
  SaveBar,
  SectionCard,
  SettingsHeader,
  SETTINGS_ERRORS,
  SS,
  stamp,
} from '../../_components/settings-kit';

const ROLES: [AdminUserDefaults['role'], string][] = [
  ['MANAGER', 'Manager'],
  ['STAFF', 'Staff'],
  ['BOOKKEEPER', 'Bookkeeper'],
  ['TAX_PREPARER', 'Tax Preparer'],
  ['CLIENT_SUPPORT', 'Client Support'],
  ['READ_ONLY', 'Read Only'],
];
const ROLE_TABLE: [string, string][] = [
  ['Firm Owner', 'Manage firm and users'],
  ['Administrator', 'Manage users and settings'],
  ['Manager', 'Manage team and operations'],
  ['Staff', 'Standard staff access'],
  ['Read Only', 'View without changing'],
  ['Client (Portal)', 'Client portal access'],
];
const ZONES = [
  ['', 'Platform default (General Settings)'],
  ['America/New_York', '(UTC-05:00) Eastern Time (US & Canada)'],
  ['America/Chicago', '(UTC-06:00) Central Time (US & Canada)'],
  ['America/Denver', '(UTC-07:00) Mountain Time (US & Canada)'],
  ['America/Los_Angeles', '(UTC-08:00) Pacific Time (US & Canada)'],
  ['UTC', '(UTC+00:00) Coordinated Universal Time'],
] as const;
const NOTIFY = [
  ['inapp', 'Platform only'],
  ['inapp+email', 'Platform + Email'],
  ['inapp+email+sms', 'Platform + Email + SMS'],
] as const;
const notifyOf = (n: { email: boolean; sms: boolean; inApp: boolean }) =>
  n.sms ? 'inapp+email+sms' : n.email ? 'inapp+email' : 'inapp';
const notifyFrom = (v: string) => ({
  inApp: true,
  email: v !== 'inapp',
  sms: v === 'inapp+email+sms',
});
const FIRM_START: AdminFirmDefaults = {
  planCode: null,
  trialDays: 14,
  timeZone: null,
  currency: null,
  dateFormat: null,
  features: [],
  notifications: { email: true, sms: false, inApp: true },
  onboarding: { sendWelcomeEmail: true, assignOnboardingTasks: true },
};
const USER_START: AdminUserDefaults = {
  role: 'STAFF',
  requireEmailVerification: true,
  timeZone: null,
  locale: null,
  appearance: null,
  notifications: { email: true, sms: false, inApp: true },
  sendWelcomeEmail: true,
};
const ERRORS = {
  ...SETTINGS_ERRORS,
  STATE: 'A feature or plan in these defaults is no longer available. Reload and try again.',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[13rem_1fr]">
      <span className="text-sm text-heading">{label}</span>
      {children}
    </div>
  );
}
function YesNo({
  label,
  on,
  set,
  disabled,
}: {
  label: string;
  on: boolean;
  set?: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex items-center gap-3 text-sm text-text">
      <Toggle label={label} checked={on} disabled={disabled || !set} onChange={(v) => set?.(v)} />
      <span aria-hidden>{on ? 'Yes' : 'No'}</span>
    </span>
  );
}

/**
 * Default User & Firm Settings (firmivra-default-settings-dashboard.jpg): what a new firm and a
 * new user start with. Each set is versioned: Save adds a version, and firms and users made
 * before keep theirs. Two-factor sign-in is Security Settings' policy, roles and their
 * permissions are each firm's (Staff Management), and a new firm's status and onboarding flow
 * follow its approval: those rows show where they are set.
 */
export function DefaultSettings() {
  const firm = useApiQuery([...SS, 'firm-defaults'], () => api.adminSettings.firmDefaults());
  const user = useApiQuery([...SS, 'user-defaults'], () => api.adminSettings.userDefaults());
  const features = useApiQuery([...SS, 'features'], () => api.adminSettings.features());
  const email = useApiQuery([...SS, 'email'], () => api.adminSettings.email());
  const plans = useApiQuery(['admin-reports', 'fields', 'FIRMS'], () =>
    api.adminReports.fields('FIRMS'),
  );
  const [f, setF] = useState<AdminFirmDefaults>();
  const [u, setU] = useState<AdminUserDefaults>();
  const [status, setStatus] = useState<Parameters<typeof SaveBar>[0]['status']>(null);
  const fv = f ?? firm.data?.values;
  const uv = u ?? user.data?.values;
  const save = useApiMutation(
    async () => {
      if (f && firm.data)
        await api.adminSettings.saveFirmDefaults({ basedOnVersion: firm.data.version, values: f });
      if (u && user.data)
        await api.adminSettings.saveUserDefaults({ basedOnVersion: user.data.version, values: u });
    },
    { invalidate: [...SS] },
  );
  const setFirm = (next: Partial<AdminFirmDefaults>) => {
    if (!fv) return;
    setF({ ...fv, ...next });
    setStatus(null);
  };
  const setUser = (next: Partial<AdminUserDefaults>) => {
    if (!uv) return;
    setU({ ...uv, ...next });
    setStatus(null);
  };
  const planOptions = plans.data?.filters.find((x) => x.key === 'plan')?.options ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        title="Default User & Firm Settings"
        subtitle="Configure the default setup for new firms and users, including roles, permissions, onboarding, and initial preferences."
        icon={UsersThree}
      />
      <nav aria-label="Sections" className="flex gap-8 overflow-x-auto border-b border-divider">
        {[
          ['#user', 'User Defaults'],
          ['#firm', 'Firm Defaults'],
          ['#roles', 'Roles & Permissions'],
          ['#onboarding', 'Onboarding'],
          ['#modules', 'Module Access'],
          ['#communication', 'Communication Defaults'],
        ].map(([href, text], i) => (
          <a
            key={href}
            href={href}
            aria-current={i === 0 ? 'location' : undefined}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 text-sm font-medium ${i === 0 ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`}
          >
            {text}
          </a>
        ))}
      </nav>

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <SectionCard
          id="user"
          title="Default User Settings"
          subtitle="Set default values for new users created by firms."
          icon={User}
        >
          <Body query={{ ...user, data: uv }} rows={6}>
            {(v) => (
              <div className="flex flex-col gap-3">
                <Row label="Default User Role">
                  <Select
                    label="Default user role"
                    hideLabel
                    value={v.role}
                    onChange={(e) => setUser({ role: e.target.value as AdminUserDefaults['role'] })}
                    options={ROLES.map(([value, label]) => ({ value, label }))}
                  />
                </Row>
                <Row label="Default Status">
                  <span className="text-sm text-muted">Invited, then Active once they accept</span>
                </Row>
                <Row label="Require Email Verification">
                  <YesNo
                    label="Require email verification"
                    on={v.requireEmailVerification}
                    set={(on) => setUser({ requireEmailVerification: on })}
                  />
                </Row>
                <Row label="Require Two-Factor Authentication (2FA)">
                  <Link href="/audit-security/settings" className="text-sm text-action">
                    Set in Security Settings
                  </Link>
                </Row>
                <Row label="Default Timezone">
                  <Select
                    label="Default user timezone"
                    hideLabel
                    value={v.timeZone ?? ''}
                    onChange={(e) => setUser({ timeZone: e.target.value || null })}
                    options={ZONES.map(([value, label]) => ({ value, label }))}
                  />
                </Row>
                <Row label="Default Language">
                  <Select
                    label="Default user language"
                    hideLabel
                    value={v.locale ?? ''}
                    onChange={(e) => setUser({ locale: e.target.value || null })}
                    options={[
                      { value: '', label: 'Platform default' },
                      { value: 'en-US', label: 'English (US)' },
                      { value: 'es-US', label: 'Spanish (US)' },
                    ]}
                  />
                </Row>
                <Row label="Default Notification Preferences">
                  <Select
                    label="Default user notifications"
                    hideLabel
                    value={notifyOf(v.notifications)}
                    onChange={(e) => setUser({ notifications: notifyFrom(e.target.value) })}
                    options={NOTIFY.map(([value, label]) => ({ value, label }))}
                  />
                </Row>
              </div>
            )}
          </Body>
        </SectionCard>

        <SectionCard
          id="firm"
          title="Default Firm Settings"
          subtitle="Set the initial configuration for new firms when they sign up."
          icon={FileText}
        >
          <Body query={{ ...firm, data: fv }} rows={6}>
            {(v) => (
              <div className="flex flex-col gap-3">
                <Row label="Default Plan">
                  <Select
                    label="Default plan"
                    hideLabel
                    value={v.planCode ?? ''}
                    onChange={(e) => setFirm({ planCode: e.target.value || null })}
                    options={[{ value: '', label: 'Chosen at approval' }, ...planOptions]}
                  />
                </Row>
                <Row label="Trial Period (Days)">
                  <Input
                    label="Trial period days"
                    hideLabel
                    type="number"
                    min={0}
                    max={365}
                    value={String(v.trialDays)}
                    onChange={(e) =>
                      setFirm({ trialDays: Math.max(0, Math.min(365, Number(e.target.value))) })
                    }
                  />
                </Row>
                <Row label="Default Firm Status">
                  <span className="text-sm text-muted">
                    Pending until a Super Admin approves it
                  </span>
                </Row>
                <Row label="Enable All Core Modules">
                  <YesNo
                    label="Enable all core modules"
                    on={
                      Boolean(features.data) &&
                      (features.data?.items ?? [])
                        .filter((x) => !x.emergencyDisabled)
                        .every((x) => v.features.includes(x.key))
                    }
                    set={(on) =>
                      setFirm({
                        features: on
                          ? (features.data?.items ?? [])
                              .filter((x) => !x.emergencyDisabled)
                              .map((x) => x.key)
                          : [],
                      })
                    }
                    disabled={!features.data}
                  />
                </Row>
                <Row label="Default Currency">
                  <Select
                    label="Default firm currency"
                    hideLabel
                    value={v.currency ?? ''}
                    onChange={(e) => setFirm({ currency: e.target.value || null })}
                    options={[
                      { value: '', label: 'Platform default' },
                      { value: 'USD', label: 'USD ($)' },
                      { value: 'CAD', label: 'CAD ($)' },
                      { value: 'EUR', label: 'EUR (€)' },
                      { value: 'GBP', label: 'GBP (£)' },
                    ]}
                  />
                </Row>
                <Row label="Default Timezone">
                  <Select
                    label="Default firm timezone"
                    hideLabel
                    value={v.timeZone ?? ''}
                    onChange={(e) => setFirm({ timeZone: e.target.value || null })}
                    options={ZONES.map(([value, label]) => ({ value, label }))}
                  />
                </Row>
                <Row label="Default Date Format">
                  <Select
                    label="Default firm date format"
                    hideLabel
                    value={v.dateFormat ?? ''}
                    onChange={(e) =>
                      setFirm({
                        dateFormat: (e.target.value || null) as AdminFirmDefaults['dateFormat'],
                      })
                    }
                    options={[
                      { value: '', label: 'Platform default' },
                      { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
                      { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
                      { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
                    ]}
                  />
                </Row>
              </div>
            )}
          </Body>
        </SectionCard>

        <SectionCard
          id="roles"
          title="Default Roles & Permissions"
          subtitle="The roles every firm starts with; each firm sets its own permissions in Staff Management."
          icon={ShieldCheck}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-table-head text-text">
                <tr>
                  {['Role', 'Description', 'Template', 'Actions'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {ROLE_TABLE.map(([role, text]) => (
                  <tr key={role}>
                    <td className="px-3 py-2 text-heading">{role}</td>
                    <td className="px-3 py-2 text-text">{text}</td>
                    <td className="px-3 py-2 text-text">System Default</td>
                    <td className="px-3 py-2">
                      <span
                        aria-disabled
                        title="Permissions are each firm's, in Staff Management"
                        className="inline-flex cursor-not-allowed items-center gap-1 text-muted"
                      >
                        <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Platform-wide permission templates are not a setting yet: each firm manages its roles
            and permissions.
          </p>
        </SectionCard>

        <SectionCard
          id="modules"
          title="Default Module Access"
          subtitle="Choose which features are on by default for new firms."
          icon={Cube}
        >
          <Body query={features} rows={4}>
            {(list) =>
              list.items.length && fv ? (
                <div className="grid gap-x-6 sm:grid-cols-2">
                  {list.items.map((x) => (
                    <div
                      key={x.key}
                      className="flex items-center justify-between border-b border-divider py-2 text-sm"
                    >
                      <span className={x.emergencyDisabled ? 'text-muted' : 'text-heading'}>
                        {x.name}
                      </span>
                      <Toggle
                        label={`${x.name} on for new firms`}
                        checked={fv.features.includes(x.key)}
                        disabled={x.emergencyDisabled}
                        onChange={(on) =>
                          setFirm({
                            features: on
                              ? [...fv.features, x.key]
                              : fv.features.filter((k) => k !== x.key),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <QuietLine>No features yet: add them in Feature Management.</QuietLine>
              )
            }
          </Body>
        </SectionCard>

        <SectionCard
          id="onboarding"
          title="Onboarding Defaults"
          subtitle="Set the default onboarding flow and resources for new firms and users."
          icon={FileText}
        >
          <Body query={{ ...firm, data: fv }} rows={3}>
            {(v) => (
              <div className="flex flex-col gap-3">
                <Row label="Default Onboarding Flow">
                  <span className="text-sm text-muted">Standard: setup wizard after approval</span>
                </Row>
                <Row label="Send Welcome Email">
                  <YesNo
                    label="Send welcome email to new firms"
                    on={v.onboarding.sendWelcomeEmail}
                    set={(on) => setFirm({ onboarding: { ...v.onboarding, sendWelcomeEmail: on } })}
                  />
                </Row>
                <Row label="Assign Onboarding Tasks">
                  <YesNo
                    label="Assign onboarding tasks"
                    on={v.onboarding.assignOnboardingTasks}
                    set={(on) =>
                      setFirm({ onboarding: { ...v.onboarding, assignOnboardingTasks: on } })
                    }
                  />
                </Row>
              </div>
            )}
          </Body>
        </SectionCard>

        <SectionCard
          id="communication"
          title="Communication Defaults"
          subtitle="Set default email and in-app notifications for new users and firms."
          icon={EnvelopeSimple}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Row label="Send Firm Welcome Email">
                <YesNo
                  label="Send firm welcome email"
                  on={fv?.onboarding.sendWelcomeEmail ?? false}
                  set={
                    fv
                      ? (on) => setFirm({ onboarding: { ...fv.onboarding, sendWelcomeEmail: on } })
                      : undefined
                  }
                />
              </Row>
              <Row label="Send User Welcome Email">
                <YesNo
                  label="Send user welcome email"
                  on={uv?.sendWelcomeEmail ?? false}
                  set={uv ? (on) => setUser({ sendWelcomeEmail: on }) : undefined}
                />
              </Row>
            </div>
            <dl className="flex flex-col gap-2 text-sm">
              <dt className="text-muted">Default From Email</dt>
              <dd className="text-heading">{email.data?.value.fromEmail ?? 'Platform sender'}</dd>
              <dt className="text-muted">Default From Name</dt>
              <dd className="text-heading">{email.data?.value.fromName ?? '—'}</dd>
              <dd>
                <Link href="/system-settings/email-notifications" className="text-action">
                  Change in Email &amp; Notifications
                </Link>
              </dd>
            </dl>
          </div>
        </SectionCard>
      </div>

      <Card className="flex flex-wrap gap-6 p-4! text-sm text-text" data-testid="default-versions">
        <span>
          <Buildings aria-hidden weight="fill" className="mr-1 inline size-4 text-action" />
          Firm defaults: version {firm.data?.version ?? '—'}, {stamp(firm.data?.createdAt)}
          {firm.data?.createdBy ? ` by ${firm.data.createdBy}` : ''}
        </span>
        <span>
          <User aria-hidden weight="fill" className="mr-1 inline size-4 text-action" />
          User defaults: version {user.data?.version ?? '—'}, {stamp(user.data?.createdAt)}
          {user.data?.createdBy ? ` by ${user.data.createdBy}` : ''}
        </span>
        <span className="text-muted">
          Saving adds a version; firms and users made before keep theirs.
        </span>
      </Card>

      <SaveBar
        status={status}
        saving={save.isPending}
        disabled={!f && !u}
        resetLabel="Reset to Platform Defaults"
        onReset={() => {
          setF(FIRM_START);
          setU(USER_START);
          setStatus({
            tone: 'info',
            text: "Firmivra's starting defaults are filled in. Nothing changes until you save.",
          });
        }}
        onSave={() =>
          save.mutate(undefined, {
            onSuccess: () => {
              setF(undefined);
              setU(undefined);
              setStatus({
                tone: 'ok',
                text: 'Saved as a new version. New firms and users get it from now on.',
              });
            },
            onError: (e) => setStatus({ tone: 'error', text: errorMessage(e, ERRORS) }),
          })
        }
      />
    </div>
  );
}
