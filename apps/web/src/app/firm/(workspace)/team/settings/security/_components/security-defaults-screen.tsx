'use client';

import {
  ApiRequestError,
  SaveStaffSecurityDefaultsRequest,
  type StaffAccessLocation,
  type StaffAuthMethod,
  type StaffSecurityDefaults,
} from '@firmivra/types';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Input,
  Modal,
  Radio,
  Select,
  Skeleton,
  Textarea,
} from '@firmivra/ui';
import {
  ArrowLeft,
  CheckCircle,
  Desktop,
  EnvelopeSimple,
  Info,
  LockKey,
  LockSimple,
  ShieldCheck,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { NOT_LOADED } from '../../../_components/quiet-card';
import { SectionCard } from '../../../new/_components/section-card';
import {
  LOGOUT_MINUTES,
  MESSAGES,
  METHODS,
  NOTICES,
  list,
} from '../../../new/security/_components/security-step';

const KEY = ['staff', 'security-defaults'];
const quiet = 'rounded-lg bg-subtle p-4 text-sm text-muted';
const hint = 'text-xs text-muted';

const SAVE_ERRORS: Record<string, string> = {
  SAVE_CONFLICT: 'Someone saved these defaults after you opened them. Reload to see them.',
};

interface Form {
  methods: StaffAuthMethod[];
  restrictDevices: boolean;
  autoLogout: boolean;
  autoLogoutMinutes: number;
  accessLocation: StaffAccessLocation;
  allowedIps: string;
  allowedCountries: string;
  maxConcurrentSessions: number;
  signOutOtherSessions: boolean;
  allowTrustedDevices: boolean;
  notices: Record<(typeof NOTICES)[number][0], boolean>;
}

const formOf = (d: StaffSecurityDefaults): Form => ({
  methods: d.allowedAuthMethods,
  restrictDevices: d.restrictDevices,
  autoLogout: d.autoLogoutMinutes !== null,
  autoLogoutMinutes: d.autoLogoutMinutes ?? 30,
  accessLocation: d.accessLocation,
  allowedIps: d.allowedIps.join(', '),
  allowedCountries: d.allowedCountries.join(', '),
  maxConcurrentSessions: d.maxConcurrentSessions,
  signOutOtherSessions: d.signOutOtherSessions,
  allowTrustedDevices: d.allowTrustedDevices,
  notices: d.notices,
});

const bodyOf = (f: Form, version: string): SaveStaffSecurityDefaultsRequest => ({
  version,
  allowedAuthMethods: f.methods,
  restrictDevices: f.restrictDevices,
  autoLogoutMinutes: f.autoLogout ? f.autoLogoutMinutes : null,
  accessLocation: f.accessLocation,
  allowedIps: f.accessLocation === 'ALLOWED_IPS' ? list(f.allowedIps) : [],
  allowedCountries:
    f.accessLocation === 'ALLOWED_COUNTRIES'
      ? list(f.allowedCountries).map((c) => c.toUpperCase())
      : [],
  maxConcurrentSessions: f.maxConcurrentSessions,
  signOutOtherSessions: f.signOutOtherSessions,
  allowTrustedDevices: f.allowTrustedDevices,
  notices: f.notices,
});

function check(f: Form): Record<string, string> {
  const errors: Record<string, string> = {};
  const result = SaveStaffSecurityDefaultsRequest.safeParse(bodyOf(f, 'check'));
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field && !errors[field]) errors[field] = MESSAGES[field] ?? issue.message;
    }
  }
  return errors;
}

const accounts = (n: number) => `${n} existing staff account${n === 1 ? '' : 's'}`;

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );

/** The four sections, as Create Staff's step 3 lays them out, without the per-account parts. */
function Sections({
  form,
  errors,
  set,
}: {
  form: Form;
  errors: Record<string, string>;
  set: <K extends keyof Form>(field: K, value: Form[K]) => void;
}) {
  return (
    <>
      <SectionCard
        id="defaults-sign-in"
        number={1}
        title="Sign-in"
        subtitle="How new staff members prove who they are."
        icon={LockSimple}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1 text-sm font-medium text-text">Always on</legend>
            <Checkbox
              label="Require two-factor authentication (2FA)"
              checked
              disabled
              readOnly
              className="text-sm"
            />
            <p className={hint}>
              Every staff account uses two-factor sign-in. Passwords are chosen by each person from
              a secure, time-limited link; nobody sets or sees them.
            </p>
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
        id="defaults-restrictions"
        number={2}
        title="Access Restrictions"
        subtitle="Where and on what new staff members may sign in."
        icon={ShieldCheck}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1 text-sm font-medium text-text">Allow Access From</legend>
            <Radio
              name="defaults-location"
              label="Anywhere (recommended)"
              checked={form.accessLocation === 'ANYWHERE'}
              onChange={() => set('accessLocation', 'ANYWHERE')}
              className="text-sm"
            />
            <Radio
              name="defaults-location"
              label="Specific IP Addresses Only"
              checked={form.accessLocation === 'ALLOWED_IPS'}
              onChange={() => set('accessLocation', 'ALLOWED_IPS')}
              className="text-sm"
            />
            <Radio
              name="defaults-location"
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
          <fieldset className="flex min-w-0 flex-col">
            <legend className="mb-1 text-sm font-medium text-text">Login Restrictions</legend>
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
          </fieldset>
        </div>
      </SectionCard>

      <SectionCard
        id="defaults-sessions"
        number={3}
        title="Sessions & Devices"
        subtitle="How many places a new staff member may be signed in at once."
        icon={Desktop}
      >
        <div className="grid gap-4 md:grid-cols-2">
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
            <p className={hint}>Trusted devices still use two-factor sign-in.</p>
          </fieldset>
        </div>
      </SectionCard>

      <SectionCard
        id="defaults-notifications"
        number={4}
        title="Security Notifications"
        subtitle="What a new staff member is told about their own account."
        icon={EnvelopeSimple}
      >
        <fieldset className="grid gap-1 md:grid-cols-2">
          <legend className="mb-1 text-sm font-medium text-text">Send Notifications For</legend>
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
      </SectionCard>
    </>
  );
}

function Editor({
  data,
  reload,
}: {
  data: StaffSecurityDefaults;
  reload: () => Promise<StaffSecurityDefaults | undefined>;
}) {
  const [form, setForm] = useState<Form>(() => formOf(data));
  const [base, setBase] = useState(data);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useApiMutation(
    (body: SaveStaffSecurityDefaultsRequest) => api.staff.saveSecurityDefaults(body),
    { invalidate: KEY },
  );
  const dirty = JSON.stringify(bodyOf(form, '')) !== JSON.stringify(bodyOf(formOf(base), ''));
  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  };
  const conflict = save.error instanceof ApiRequestError && save.error.code === 'SAVE_CONFLICT';

  return (
    <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          These settings apply to staff accounts created from now on, in Create Staff and Bulk
          Upload Staff. Your {accounts(data.existingAccounts)} keep their own settings; change one
          on its Access &amp; Security page.
        </Callout>
        <Sections form={form} errors={errors} set={set} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {save.error ? (
            <p
              role="alert"
              className="mr-auto flex flex-wrap items-center gap-2 text-sm text-danger"
            >
              {errorMessage(save.error, SAVE_ERRORS)}
              {conflict ? (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const fresh = await reload();
                    if (!fresh) return;
                    setBase(fresh);
                    setForm(formOf(fresh));
                    setErrors({});
                    save.reset();
                  }}
                >
                  Reload
                </Button>
              ) : null}
            </p>
          ) : saved ? (
            <p role="status" data-testid="defaults-saved" className="mr-auto text-sm text-success">
              Saved. New staff accounts start with these settings.
            </p>
          ) : null}
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setForm(formOf(base));
              setErrors({});
            }}
          >
            Discard Changes
          </Button>
          <Button
            disabled={!dirty || save.isPending || conflict}
            onClick={() => {
              const found = check(form);
              setErrors(found);
              if (!Object.keys(found).length) setConfirming(true);
            }}
          >
            Save Changes
          </Button>
        </div>
      </div>
      <aside className="flex min-w-0 flex-col gap-4">
        <section
          aria-label="Who this affects"
          className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <h2 className="text-lg font-bold text-heading">Who this affects</h2>
          <dl className="flex flex-col divide-y divide-divider text-sm">
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-heading">New staff accounts</dt>
              <dd className="font-semibold text-link">Start with these settings</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-heading">Existing staff accounts</dt>
              <dd data-testid="existing-accounts" className="font-semibold text-link">
                {data.existingAccounts} keep their own
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <dt className="text-heading">Last saved</dt>
              <dd className="text-right font-semibold text-link">
                {base.updatedAt
                  ? `${when(base.updatedAt)}${base.updatedBy ? ` by ${base.updatedBy}` : ''}`
                  : "Firmivra's defaults, not changed yet"}
              </dd>
            </div>
          </dl>
        </section>
      </aside>
      <Modal
        open={confirming}
        title="Save the new account defaults?"
        onClose={() => setConfirming(false)}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate(bodyOf(form, base.version), {
                  onSuccess: (next) => {
                    setBase(next);
                    setForm(formOf(next));
                    setSaved(true);
                    setConfirming(false);
                  },
                  onError: () => setConfirming(false),
                })
              }
            >
              {save.isPending ? 'Saving…' : 'Save Defaults'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text">
          Staff accounts created from now on start with these settings. Your{' '}
          {accounts(data.existingAccounts)} keep their own settings; nothing changes for them.
        </p>
      </Modal>
    </div>
  );
}

function Frames({ line, loading }: { line: string; loading: boolean }) {
  const parts: [string, string][] = [
    ['Sign-in', 'How new staff members prove who they are.'],
    ['Access Restrictions', 'Where and on what new staff members may sign in.'],
    ['Sessions & Devices', 'How many places a new staff member may be signed in at once.'],
    ['Security Notifications', 'What a new staff member is told about their own account.'],
  ];
  const icons = [LockSimple, ShieldCheck, Desktop, EnvelopeSimple];
  const body = loading ? <Skeleton className="h-16" /> : <p className={quiet}>{line}</p>;
  return (
    <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
        {parts.map(([title, subtitle], i) => (
          <SectionCard
            key={title}
            id={`defaults-frame-${i}`}
            number={i + 1}
            title={title}
            subtitle={subtitle}
            icon={icons[i] ?? LockSimple}
          >
            {body}
          </SectionCard>
        ))}
      </div>
      <section
        aria-label="Who this affects"
        className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
      >
        <h2 className="text-lg font-bold text-heading">Who this affects</h2>
        {body}
      </section>
    </div>
  );
}

/**
 * Staff Settings > New Accounts & Security (`/team/settings/security`, Octavia's SM3): the
 * company-wide security settings every new staff account starts from. Existing accounts keep
 * their own (each one's Access & Security page is the explicit exception), and a save says so and
 * asks first. Owner and Admin.
 */
export function SecurityDefaultsScreen() {
  const defaults = useApiQuery(KEY, () => api.staff.securityDefaults());
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/team/settings"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Staff Settings
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <LockKey aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              New Account Security
            </h1>
            <p className="text-base text-link">
              The security settings every new staff account starts with.
            </p>
          </div>
          <div className="w-full md:w-auto">
            <Badge tone="success" icon={CheckCircle}>
              Two-factor sign-in always required
            </Badge>
          </div>
        </div>
      </header>
      {defaults.isPending ? (
        <Frames line="" loading />
      ) : defaults.data === undefined ? (
        <Frames line={NOT_LOADED} loading={false} />
      ) : (
        <Editor data={defaults.data} reload={async () => (await defaults.refetch()).data} />
      )}
    </div>
  );
}
