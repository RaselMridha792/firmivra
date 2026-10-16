'use client';

import {
  type StaffAccessInput as AccessInput,
  StaffAccessInput,
  type StaffAccessLevel,
  type StaffAccessLocation,
  StaffAccountInput,
  type StaffAuthMethod,
  type StaffDraftData,
} from '@firmivra/types';
import { Callout, Checkbox, Input, Radio, Select, Textarea } from '@firmivra/ui';
import { Desktop, EnvelopeSimple, Info, LockSimple, ShieldCheck } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { SectionCard } from '../../_components/section-card';
import { StepActions, WithDraft, useDraftSaver } from '../../_components/with-draft';
import { WizardHeader } from '../../_components/wizard-header';
import { ACCESS_LEVELS, levelForRole, stepHref } from '../../_components/wizard-parts';
import { AccountPreview, WizardNotes, previewFromDraft } from '../../_components/wizard-side';

const METHODS: [StaffAuthMethod, string][] = [
  ['AUTHENTICATOR_APP', 'Authenticator App (e.g., Google Authenticator)'],
  ['SMS', 'SMS (Text Message)'],
  ['EMAIL', 'Email Verification'],
  ['BACKUP_CODES', 'Backup Codes (recommended)'],
];

const NOTICES = [
  ['newDeviceLogin', 'Successful logins (new device)'],
  ['failedLogins', 'Failed login attempts'],
  ['passwordChanges', 'Password changes'],
  ['securityAlerts', 'Security alerts'],
  ['lockouts', 'Account lockouts'],
] as const;

const LOGOUT_MINUTES = [15, 30, 60, 120, 240, 480];

const list = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

interface Form {
  email: string;
  requirePasswordChange: boolean;
  sendWelcomeEmail: boolean;
  accessLevel: StaffAccessLevel;
  restrictDevices: boolean;
  autoLogout: boolean;
  autoLogoutMinutes: number;
  disable: boolean;
  disableOn: string;
  methods: StaffAuthMethod[];
  accessLocation: StaffAccessLocation;
  allowedIps: string;
  allowedCountries: string;
  maxConcurrentSessions: number;
  signOutOtherSessions: boolean;
  allowTrustedDevices: boolean;
  recoveryEmail: string;
  notices: Record<(typeof NOTICES)[number][0], boolean>;
}

function fromDraft(d: StaffDraftData): Form {
  const x = d.access ?? {};
  return {
    email: d.account?.email ?? '',
    requirePasswordChange: x.requirePasswordChange ?? true,
    sendWelcomeEmail: d.sendWelcomeEmail ?? true,
    accessLevel: d.account?.accessLevel ?? levelForRole(d.account?.role ?? ''),
    restrictDevices: x.restrictDevices ?? false,
    autoLogout: x.autoLogoutMinutes != null,
    autoLogoutMinutes: x.autoLogoutMinutes ?? 30,
    disable: Boolean(x.disableOn),
    disableOn: x.disableOn ?? '',
    methods: x.allowedAuthMethods ?? ['AUTHENTICATOR_APP', 'SMS', 'EMAIL', 'BACKUP_CODES'],
    accessLocation: x.accessLocation ?? 'ANYWHERE',
    allowedIps: (x.allowedIps ?? []).join(', '),
    allowedCountries: (x.allowedCountries ?? []).join(', '),
    maxConcurrentSessions: x.maxConcurrentSessions ?? 1,
    signOutOtherSessions: x.signOutOtherSessions ?? false,
    allowTrustedDevices: x.allowTrustedDevices ?? false,
    recoveryEmail: x.recoveryEmail ?? '',
    notices: {
      newDeviceLogin: x.notices?.newDeviceLogin ?? true,
      failedLogins: x.notices?.failedLogins ?? true,
      passwordChanges: x.notices?.passwordChanges ?? true,
      securityAlerts: x.notices?.securityAlerts ?? true,
      lockouts: x.notices?.lockouts ?? true,
    },
  };
}

/** Step 3 as the contract's StaffAccessInput; the lists only go with their access location. */
function toAccess(f: Form): AccessInput {
  return {
    requirePasswordChange: f.requirePasswordChange,
    allowedAuthMethods: f.methods,
    restrictDevices: f.restrictDevices,
    autoLogoutMinutes: f.autoLogout ? f.autoLogoutMinutes : null,
    disableOn: f.disable && f.disableOn ? f.disableOn : null,
    accessLocation: f.accessLocation,
    allowedIps: f.accessLocation === 'ALLOWED_IPS' ? list(f.allowedIps) : [],
    allowedCountries: f.accessLocation === 'ALLOWED_COUNTRIES' ? list(f.allowedCountries) : [],
    maxConcurrentSessions: f.maxConcurrentSessions,
    signOutOtherSessions: f.signOutOtherSessions,
    allowTrustedDevices: f.allowTrustedDevices,
    recoveryEmail: f.recoveryEmail.trim() || null,
    notices: f.notices,
  };
}

const MESSAGES: Record<string, string> = {
  allowedAuthMethods: 'Choose at least one sign-in method.',
  allowedIps: 'Use IP addresses or networks like 203.0.113.0/24, separated by commas.',
  allowedCountries: 'Use two-letter country codes like US, CA, separated by commas.',
  recoveryEmail: 'Enter a valid recovery email, or leave it empty.',
  disableOn: 'Choose a date.',
};

function check(f: Form): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!StaffAccountInput.shape.email.safeParse(f.email.trim()).success) {
    errors.email = 'Enter a valid work email.';
  }
  if (f.disable && !f.disableOn) errors.disableOn = MESSAGES.disableOn ?? '';
  if (f.accessLocation === 'ALLOWED_IPS' && !list(f.allowedIps).length) {
    errors.allowedIps = MESSAGES.allowedIps ?? '';
  }
  if (f.accessLocation === 'ALLOWED_COUNTRIES' && !list(f.allowedCountries).length) {
    errors.allowedCountries = MESSAGES.allowedCountries ?? '';
  }
  const result = StaffAccessInput.safeParse(toAccess(f));
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field && !errors[field]) errors[field] = MESSAGES[field] ?? issue.message;
    }
  }
  return errors;
}

/**
 * Create Staff, step 3 (create-staff-tab-3.jpg, guide §7): sign-in, restrictions, sessions,
 * recovery and security notices, as the contract's StaffAccessInput. Passwords are never set
 * here (a secure, time-limited link) and two-factor sign-in is always on for staff.
 */
export function SecurityStep({ draftId }: { draftId?: string }) {
  return (
    <WithDraft draftId={draftId} step="security">
      {(state) => <SecurityForm {...state} />}
    </WithDraft>
  );
}

function SecurityForm({
  draftId: startDraft,
  base,
  notice,
}: {
  draftId: string | null;
  base: StaffDraftData;
  notice?: string;
}) {
  const router = useRouter();
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const [form, setForm] = useState<Form>(() => fromDraft(base));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const draft = useDraftSaver(startDraft, 3);
  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    draft.touched();
  };
  const data = (): StaffDraftData => ({
    ...base,
    account: {
      ...base.account,
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      accessLevel: form.accessLevel,
    },
    access: toAccess(form),
    sendWelcomeEmail: form.sendWelcomeEmail,
  });
  const go = (step: 'permissions' | 'details', validate: boolean) => {
    if (validate) {
      const found = check(form);
      setErrors(found);
      if (Object.keys(found).length) return;
    }
    draft.save(data(), (id) => router.push(stepHref(step, id)));
  };
  const hint = 'text-xs text-muted';
  const box = 'flex flex-col';
  const preview = previewFromDraft(
    { ...base, account: { ...base.account, email: form.email } },
    options.data,
    form.sendWelcomeEmail ? 'Pending Invite' : 'Not Invited',
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <WizardHeader step="security" />
      {notice ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          {notice}
        </Callout>
      ) : null}
      {/* The design's two-to-one split from 1440 px; narrower, the side cards go under. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
          <SectionCard
            id="login-authentication"
            number={1}
            title="Login & Authentication"
            subtitle="Configure how this staff member will access the system."
            icon={LockSimple}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <Input
                  label="Work Email *"
                  type="email"
                  placeholder="name@yourfirm.com"
                  value={form.email}
                  error={errors.email}
                  onChange={(e) => set('email', e.target.value)}
                />
                <div className={box}>
                  <Checkbox
                    label="Require password change at first login"
                    checked={form.requirePasswordChange}
                    onChange={(e) => set('requirePasswordChange', e.target.checked)}
                    className="text-sm"
                  />
                  <Checkbox
                    label="Send welcome email with login instructions"
                    checked={form.sendWelcomeEmail}
                    onChange={(e) => set('sendWelcomeEmail', e.target.checked)}
                    className="text-sm"
                  />
                </div>
              </div>
              <fieldset className="flex min-w-0 flex-col gap-1">
                <legend className="mb-1 text-sm font-medium text-text">Temporary Password</legend>
                <Radio
                  name="password"
                  label="Generate automatically (recommended)"
                  checked
                  readOnly
                  className="text-sm"
                />
                {/* The contract never sets a password: a secure setup link is sent instead. */}
                <Radio name="password" label="Set custom password" disabled className="text-sm" />
                <p className={hint}>
                  A secure, time-limited setup link is sent; nobody sets or sees a password.
                </p>
                <Checkbox
                  label="Require two-factor authentication (2FA)"
                  checked
                  disabled
                  readOnly
                  className="text-sm"
                />
              </fieldset>
            </div>
          </SectionCard>

          <SectionCard
            id="access-level"
            number={2}
            title="Access Level & Restrictions"
            subtitle="Set the overall access level and any global restrictions."
            icon={ShieldCheck}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1">
                <Select
                  label="User Access Level *"
                  options={Object.entries(ACCESS_LEVELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  value={form.accessLevel}
                  onChange={(e) => set('accessLevel', e.target.value as StaffAccessLevel)}
                />
                <p className={hint}>Access based on assigned role permissions.</p>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Select
                  label="Account Status *"
                  disabled
                  options={[
                    {
                      value: 'status',
                      label: form.sendWelcomeEmail ? 'Pending Invite' : 'Not Invited',
                    },
                  ]}
                  value="status"
                  onChange={() => undefined}
                />
                <p className={hint}>Active once they accept the invitation and sign in.</p>
              </div>
              <fieldset className="flex min-w-0 flex-col">
                <legend className="mb-1 text-sm font-medium text-text">Login Restrictions</legend>
                <Checkbox
                  label="Restrict login to specific IP addresses"
                  checked={form.accessLocation === 'ALLOWED_IPS'}
                  onChange={(e) =>
                    set('accessLocation', e.target.checked ? 'ALLOWED_IPS' : 'ANYWHERE')
                  }
                  className="text-sm"
                />
                <Checkbox
                  label="Restrict login to specific devices"
                  checked={form.restrictDevices}
                  onChange={(e) => set('restrictDevices', e.target.checked)}
                  className="text-sm"
                />
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Checkbox
                    label="Set automatic logout after inactivity"
                    checked={form.autoLogout}
                    onChange={(e) => set('autoLogout', e.target.checked)}
                    className="text-sm"
                  />
                  <Select
                    label="Inactivity time"
                    hideLabel
                    disabled={!form.autoLogout}
                    options={LOGOUT_MINUTES.map((m) => ({
                      value: String(m),
                      label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`,
                    }))}
                    value={String(form.autoLogoutMinutes)}
                    onChange={(e) => set('autoLogoutMinutes', Number(e.target.value))}
                  />
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <Checkbox
                    label="Disable account on"
                    checked={form.disable}
                    onChange={(e) => set('disable', e.target.checked)}
                    className="text-sm"
                  />
                  <Input
                    label="Disable date"
                    hideLabel
                    type="date"
                    disabled={!form.disable}
                    value={form.disableOn}
                    error={errors.disableOn}
                    onChange={(e) => set('disableOn', e.target.value)}
                  />
                </div>
              </fieldset>
              <fieldset className="flex min-w-0 flex-col">
                <legend className="mb-1 text-sm font-medium text-text">
                  Allowed Authentication Methods
                </legend>
                {METHODS.map(([method, label]) => (
                  <Checkbox
                    key={method}
                    label={label}
                    checked={form.methods.includes(method)}
                    onChange={(e) =>
                      set(
                        'methods',
                        e.target.checked
                          ? [...form.methods, method]
                          : form.methods.filter((m) => m !== method),
                      )
                    }
                    className="text-sm"
                  />
                ))}
                {errors.allowedAuthMethods ? (
                  <p className="text-xs text-danger">{errors.allowedAuthMethods}</p>
                ) : null}
              </fieldset>
            </div>
          </SectionCard>

          <SectionCard
            id="session-device"
            number={3}
            title="Session & Device Settings"
            subtitle="Control how and where this staff member can access the system."
            icon={Desktop}
          >
            <div className="grid gap-4 md:grid-cols-3">
              <fieldset className="flex min-w-0 flex-col gap-1">
                <legend className="mb-1 text-sm font-medium text-text">Allow Access From</legend>
                <Radio
                  name="location"
                  label="Anywhere (recommended)"
                  checked={form.accessLocation === 'ANYWHERE'}
                  onChange={() => set('accessLocation', 'ANYWHERE')}
                  className="text-sm"
                />
                <Radio
                  name="location"
                  label="Specific IP Addresses Only"
                  checked={form.accessLocation === 'ALLOWED_IPS'}
                  onChange={() => set('accessLocation', 'ALLOWED_IPS')}
                  className="text-sm"
                />
                <Radio
                  name="location"
                  label="Specific Countries/Regions Only"
                  checked={form.accessLocation === 'ALLOWED_COUNTRIES'}
                  onChange={() => set('accessLocation', 'ALLOWED_COUNTRIES')}
                  className="text-sm"
                />
                {form.accessLocation === 'ALLOWED_IPS' ? (
                  <Textarea
                    label="Allowed IP addresses or networks *"
                    rows={2}
                    placeholder="203.0.113.10, 198.51.100.0/24"
                    value={form.allowedIps}
                    error={errors.allowedIps}
                    onChange={(e) => set('allowedIps', e.target.value)}
                  />
                ) : null}
                {form.accessLocation === 'ALLOWED_COUNTRIES' ? (
                  <Input
                    label="Allowed countries *"
                    placeholder="US, CA"
                    value={form.allowedCountries}
                    error={errors.allowedCountries}
                    onChange={(e) => set('allowedCountries', e.target.value)}
                  />
                ) : null}
              </fieldset>
              <div className="flex min-w-0 flex-col gap-2">
                <Select
                  label="Concurrent Sessions"
                  options={Array.from({ length: 10 }, (_, i) => ({
                    value: String(i + 1),
                    label: i === 0 ? '1 session (recommended)' : `${i + 1} sessions`,
                  }))}
                  value={String(form.maxConcurrentSessions)}
                  onChange={(e) => set('maxConcurrentSessions', Number(e.target.value))}
                />
                <Checkbox
                  label="Log out other sessions when a new session starts"
                  checked={form.signOutOtherSessions}
                  onChange={(e) => set('signOutOtherSessions', e.target.checked)}
                  className="text-sm"
                />
              </div>
              <fieldset className="flex min-w-0 flex-col gap-1">
                <legend className="mb-1 text-sm font-medium text-text">Trusted Devices</legend>
                <Checkbox
                  label="Allow “Remember This Device”"
                  checked={form.allowTrustedDevices}
                  onChange={(e) => set('allowTrustedDevices', e.target.checked)}
                  className="text-sm"
                />
                <p className={hint}>
                  Note: Trusted devices will still require 2FA unless disabled by an administrator.
                </p>
              </fieldset>
            </div>
          </SectionCard>

          <SectionCard
            id="recovery-notifications"
            number={4}
            title="Account Recovery & Notifications"
            subtitle="Set recovery options and notification preferences."
            icon={EnvelopeSimple}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1">
                <Input
                  label="Recovery Email (Optional)"
                  type="email"
                  placeholder="recovery@yourfirm.com"
                  value={form.recoveryEmail}
                  error={errors.recoveryEmail}
                  onChange={(e) => set('recoveryEmail', e.target.value)}
                />
                <p className={hint}>
                  Used for password recovery if the primary email is unavailable.
                </p>
              </div>
              <fieldset className="flex min-w-0 flex-col">
                <legend className="mb-1 text-sm font-medium text-text">
                  Send Notifications For
                </legend>
                {NOTICES.map(([field, label]) => (
                  <Checkbox
                    key={field}
                    label={label}
                    checked={form.notices[field]}
                    onChange={(e) => set('notices', { ...form.notices, [field]: e.target.checked })}
                    className="text-sm"
                  />
                ))}
              </fieldset>
            </div>
          </SectionCard>

          <StepActions
            nextLabel="Next: Additional Details"
            pending={draft.pending}
            saved={draft.saved}
            error={draft.error}
            onBack={() => go('permissions', false)}
            onSave={() =>
              draft.save(data(), (id) =>
                router.replace(stepHref('security', id), { scroll: false }),
              )
            }
            onNext={() => go('details', true)}
          />
        </div>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <AccountPreview values={preview} editHref={stepHref('account', draft.draftId)} />
          <WizardNotes
            created="The account will be created with the selected security settings."
            later="You can update these settings at any time."
          />
        </aside>
      </div>
    </div>
  );
}
