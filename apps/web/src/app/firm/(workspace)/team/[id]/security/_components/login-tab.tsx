'use client';

import {
  StaffAccessInput,
  type StaffAccessLocation,
  type StaffAuthMethod,
  type StaffSecurity,
} from '@firmivra/types';
import { Badge, Button, Checkbox, Input, Radio, Select, Skeleton, Textarea } from '@firmivra/ui';
import { Desktop, EnvelopeSimple, Key, LockSimple, ShieldCheck } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { NOT_LOADED } from '../../../_components/quiet-card';
import {
  LOGOUT_MINUTES,
  MESSAGES,
  METHODS,
  NOTICES,
  list,
} from '../../../new/security/_components/security-step';
import { ActionModal } from '../../_components/staff-actions';
import { MEMBER_ERRORS, longDate } from '../../_components/staff-parts';
import { useMember } from '../../_components/use-member';
import { Panel } from './panel';
import { useSecurity } from './security-cards';
import { SecurityShell } from './security-shell';

interface Form {
  methods: StaffAuthMethod[];
  requirePasswordChange: boolean;
  accessLocation: StaffAccessLocation;
  allowedIps: string;
  allowedCountries: string;
  restrictDevices: boolean;
  disable: boolean;
  disableOn: string;
  autoLogout: boolean;
  autoLogoutMinutes: number;
  maxConcurrentSessions: number;
  signOutOtherSessions: boolean;
  allowTrustedDevices: boolean;
  recoveryEmail: string;
  notices: StaffSecurity['notices'];
}

const fromSecurity = (s: StaffSecurity): Form => ({
  methods: s.allowedAuthMethods,
  requirePasswordChange: s.requirePasswordChange,
  accessLocation: s.accessLocation,
  allowedIps: s.allowedIps.join(', '),
  allowedCountries: s.allowedCountries.join(', '),
  restrictDevices: s.restrictDevices,
  disable: Boolean(s.disableOn),
  disableOn: s.disableOn ?? '',
  autoLogout: s.autoLogoutMinutes !== null,
  autoLogoutMinutes: s.autoLogoutMinutes ?? 30,
  maxConcurrentSessions: s.maxConcurrentSessions,
  signOutOtherSessions: s.signOutOtherSessions,
  allowTrustedDevices: s.allowTrustedDevices,
  recoveryEmail: s.recoveryEmail ?? '',
  notices: s.notices,
});

const toAccess = (f: Form): StaffAccessInput => ({
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
});

function check(f: Form): Record<string, string> {
  const errors: Record<string, string> = {};
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

const MFA: Record<
  StaffSecurity['mfa'],
  { label: string; tone: 'success' | 'warning' | 'neutral' }
> = {
  ENABLED: { label: 'Enabled', tone: 'success' },
  PENDING: { label: 'Not set up yet', tone: 'warning' },
  DISABLED: { label: 'Off', tone: 'neutral' },
};

const PANELS = {
  auth: {
    title: 'Sign-in & Authentication',
    subtitle: 'How this person signs in.',
    icon: LockSimple,
  },
  limits: {
    title: 'Account Restrictions',
    subtitle: 'Where and until when this person can sign in.',
    icon: ShieldCheck,
  },
  sessions: {
    title: 'Sessions & Devices',
    subtitle: 'How long sessions last and how many run at once.',
    icon: Desktop,
  },
  recovery: {
    title: 'Recovery & Notifications',
    subtitle: 'Recovery email and the security notices sent.',
    icon: EnvelopeSimple,
  },
};

/**
 * Login & Security tab (guide §14, the overview's Security Settings card in full): sign-in
 * methods, restrictions, sessions, recovery and notices, saved with `api.staff.updateSecurity`.
 * Two-factor sign-in is always on for staff and no password is ever set here.
 */
export function LoginTab({ id }: { id: string }) {
  const { member, manages } = useMember(id);
  const security = useSecurity(id);
  return (
    <SecurityShell id={id} tab="login">
      {security.data ? (
        <LoginForm id={id} name={member?.name} security={security.data} enabled={manages} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {Object.values(PANELS).map((p) => (
            <Panel key={p.title} {...p}>
              {security.isPending ? (
                <Skeleton className="h-24" />
              ) : (
                <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
              )}
            </Panel>
          ))}
        </div>
      )}
    </SecurityShell>
  );
}

function LoginForm({
  id,
  name,
  security: s,
  enabled,
}: {
  id: string;
  name: string | undefined;
  security: StaffSecurity;
  enabled: boolean;
}) {
  const [form, setForm] = useState<Form>(() => fromSecurity(s));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  const [reset, setReset] = useState(false);
  const save = useApiMutation((body: StaffAccessInput) => api.staff.updateSecurity(id, body), {
    invalidate: ['staff'],
  });
  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved('');
  };
  const off = !enabled || save.isPending;
  const hint = 'text-xs text-muted';
  const row = (label: string, value: ReactNode, action?: ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider py-2">
      <span className="text-sm font-medium text-heading">{label}</span>
      <span className="flex items-center gap-3 text-sm text-text">
        {value}
        {action}
      </span>
    </div>
  );

  return (
    <>
      <form
        noValidate
        aria-label="Login and security settings"
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const found = check(form);
          setErrors(found);
          if (Object.keys(found).length) return;
          save.mutate(toAccess(form), { onSuccess: () => setSaved('Security settings saved.') });
        }}
      >
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <Panel {...PANELS.auth} testId="login-authentication">
            {row(
              'Two-Factor Authentication (2FA)',
              <Badge tone={MFA[s.mfa].tone} dot>
                {MFA[s.mfa].label}
              </Badge>,
            )}
            <p className={hint}>Two-factor sign-in is always required for staff.</p>
            {row(
              'Password Last Changed',
              s.passwordChangedAt ? longDate(s.passwordChangedAt) : 'Not yet',
              <Button
                variant="secondary"
                disabled={!enabled || !name || (s.status !== 'ACTIVE' && s.status !== 'LOCKED')}
                onClick={() => setReset(true)}
              >
                <Key aria-hidden weight="fill" className="size-4" />
                Reset Password
              </Button>,
            )}
            <Checkbox
              label="Require password change at next login"
              disabled={off}
              checked={form.requirePasswordChange}
              onChange={(e) => set('requirePasswordChange', e.target.checked)}
              className="text-sm"
            />
            <fieldset className="flex min-w-0 flex-col">
              <legend className="mb-1 text-sm font-medium text-text">
                Allowed Authentication Methods
              </legend>
              {METHODS.map(([method, label]) => (
                <Checkbox
                  key={method}
                  label={label}
                  disabled={off}
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
          </Panel>

          <Panel {...PANELS.limits} testId="account-restrictions">
            <fieldset className="flex min-w-0 flex-col gap-1">
              <legend className="mb-1 text-sm font-medium text-text">Allow Access From</legend>
              {(
                [
                  ['ANYWHERE', 'Anywhere (recommended)'],
                  ['ALLOWED_IPS', 'Specific IP Addresses Only'],
                  ['ALLOWED_COUNTRIES', 'Specific Countries/Regions Only'],
                ] as const
              ).map(([value, label]) => (
                <Radio
                  key={value}
                  name="location"
                  label={label}
                  disabled={off}
                  checked={form.accessLocation === value}
                  onChange={() => set('accessLocation', value)}
                  className="text-sm"
                />
              ))}
              {form.accessLocation === 'ALLOWED_IPS' ? (
                <Textarea
                  label="Allowed IP addresses or networks *"
                  rows={2}
                  placeholder="203.0.113.10, 198.51.100.0/24"
                  disabled={off}
                  value={form.allowedIps}
                  error={errors.allowedIps}
                  onChange={(e) => set('allowedIps', e.target.value)}
                />
              ) : null}
              {form.accessLocation === 'ALLOWED_COUNTRIES' ? (
                <Input
                  label="Allowed countries *"
                  placeholder="US, CA"
                  disabled={off}
                  value={form.allowedCountries}
                  error={errors.allowedCountries}
                  onChange={(e) => set('allowedCountries', e.target.value)}
                />
              ) : null}
            </fieldset>
            <Checkbox
              label="Restrict login to known devices"
              disabled={off}
              checked={form.restrictDevices}
              onChange={(e) => set('restrictDevices', e.target.checked)}
              className="text-sm"
            />
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <Checkbox
                label="Disable account on"
                disabled={off}
                checked={form.disable}
                onChange={(e) => set('disable', e.target.checked)}
                className="text-sm"
              />
              <Input
                label="Disable date"
                hideLabel
                type="date"
                disabled={off || !form.disable}
                value={form.disableOn}
                error={errors.disableOn}
                onChange={(e) => set('disableOn', e.target.value)}
              />
            </div>
          </Panel>

          <Panel {...PANELS.sessions} testId="sessions-devices">
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <Checkbox
                label="Automatic logout after inactivity"
                disabled={off}
                checked={form.autoLogout}
                onChange={(e) => set('autoLogout', e.target.checked)}
                className="text-sm"
              />
              <Select
                label="Inactivity time"
                hideLabel
                disabled={off || !form.autoLogout}
                options={LOGOUT_MINUTES.map((m) => ({
                  value: String(m),
                  label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`,
                }))}
                value={String(form.autoLogoutMinutes)}
                onChange={(e) => set('autoLogoutMinutes', Number(e.target.value))}
              />
            </div>
            <Select
              label="Concurrent Sessions"
              disabled={off}
              options={Array.from({ length: 10 }, (_, i) => ({
                value: String(i + 1),
                label: i === 0 ? '1 session (recommended)' : `${i + 1} sessions`,
              }))}
              value={String(form.maxConcurrentSessions)}
              onChange={(e) => set('maxConcurrentSessions', Number(e.target.value))}
            />
            <Checkbox
              label="Log out other sessions when a new session starts"
              disabled={off}
              checked={form.signOutOtherSessions}
              onChange={(e) => set('signOutOtherSessions', e.target.checked)}
              className="text-sm"
            />
            <Checkbox
              label="Allow “Remember This Device”"
              disabled={off}
              checked={form.allowTrustedDevices}
              onChange={(e) => set('allowTrustedDevices', e.target.checked)}
              className="text-sm"
            />
            <p className={hint}>Trusted devices still ask for two-factor sign-in.</p>
          </Panel>

          <Panel {...PANELS.recovery} testId="recovery-notifications">
            <div className="flex min-w-0 flex-col gap-1">
              <Input
                label="Recovery Email (Optional)"
                type="email"
                placeholder="recovery@yourfirm.com"
                disabled={off}
                value={form.recoveryEmail}
                error={errors.recoveryEmail}
                onChange={(e) => set('recoveryEmail', e.target.value)}
              />
              <p className={hint}>
                {s.recoveryEmail
                  ? s.recoveryEmailVerified
                    ? 'Verified.'
                    : 'Not verified yet: they confirm it from the email they receive.'
                  : 'Used for password recovery if the work email is unavailable.'}
              </p>
            </div>
            <fieldset className="flex min-w-0 flex-col">
              <legend className="mb-1 text-sm font-medium text-text">Send Notifications For</legend>
              {NOTICES.map(([field, label]) => (
                <Checkbox
                  key={field}
                  label={label}
                  disabled={off}
                  checked={form.notices[field]}
                  onChange={(e) => set('notices', { ...form.notices, [field]: e.target.checked })}
                  className="text-sm"
                />
              ))}
            </fieldset>
          </Panel>
        </div>

        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, MEMBER_ERRORS)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {saved ? (
            <span role="status" data-testid="login-saved" className="text-sm text-success">
              {saved}
            </span>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={off}
              onClick={() => {
                setForm(fromSecurity(s));
                setErrors({});
                setSaved('');
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={off}>
              Save Changes
            </Button>
          </div>
        </div>
      </form>
      {/* Outside the form: the dialog has its own. */}
      {reset && name ? (
        <ActionModal
          action="resetPassword"
          id={id}
          name={name}
          onClose={() => setReset(false)}
          onDone={(text) => {
            setReset(false);
            setSaved(text);
          }}
        />
      ) : null}
    </>
  );
}
