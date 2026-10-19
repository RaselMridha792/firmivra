'use client';

import {
  Badge,
  Button,
  Callout,
  Checkbox,
  FormField,
  Modal,
  PageHeader,
  Select,
  Textarea,
  Toggle,
} from '@firmivra/ui';
import {
  ArrowsClockwise,
  Bell,
  Clock,
  Database,
  DeviceMobile,
  Info,
  Lock,
  MapPin,
  ShieldCheck,
  Warning,
  Wrench,
} from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  CONCURRENT_SESSIONS,
  daysLabel,
  DEFAULT_SECURITY_SETTINGS,
  describeSettingsChanges,
  EXPORT_ROLE_LABELS,
  EXPORT_ROLES,
  exportLevel,
  exportRolesFor,
  IDLE_TIMEOUT_MINUTES,
  isIpEntry,
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  minutesLabel,
  PASSWORD_EXPIRATION_DAYS,
  REMEMBER_ME_DAYS,
  RETENTION_DAYS,
  retentionLabel,
  sessionsLabel,
  SEVERITY_FLOOR_LABELS,
  validateSecuritySettings,
  type IpMode,
  type MfaScope,
  type SecuritySettings,
  type SettingsErrors,
} from '../../../../../../mocks/admin-audit-security';
import { adminAuditSecurity } from '../../_components/audit-api';
import {
  Breadcrumbs,
  formatShortStamp,
  loadError,
  QuietLine,
  SkeletonLines,
} from '../../_components/audit-parts';
import { NumberSelect, RadioOption, SettingsCard, ToggleRow, YesNoSelect } from './settings-parts';

/**
 * Security Settings & Policies (S02, firmivra-security-settings-dashboard.jpg; docx §4). The
 * links under the title jump to the cards. Save validates, shows the changes (high-impact ones
 * flagged), saves against the version it loaded (409 when someone else saved first) and the
 * change is audited as `policy.changed`.
 */
const SECTIONS = [
  { id: 'authentication', label: 'Authentication' },
  { id: 'password-policy', label: 'Password Policy' },
  { id: 'session-access', label: 'Session & Access' },
  { id: 'account-protection', label: 'Account Protection' },
  { id: 'ip-restrictions', label: 'IP Restrictions' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'audit-log-retention', label: 'Audit Log Retention' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** Optional is shown as the design has it, but never chosen: Super Admins always use MFA. */
const MFA_OPTIONS: { value: MfaScope | 'OPTIONAL'; label: string; hint: string }[] = [
  { value: 'ALL', label: 'Required for all users', hint: 'All users must enable MFA.' },
  {
    value: 'ADMINS',
    label: 'Required for admin users only',
    hint: 'Only Super Admins and Firm Admins must enable MFA.',
  },
  {
    value: 'OPTIONAL',
    label: 'Optional',
    hint: 'Users can choose to enable MFA. Not available: Firmivra always requires MFA for Super Admins.',
  },
];
const IP_OPTIONS: { value: IpMode; label: string; hint: string }[] = [
  {
    value: 'ANY',
    label: 'Allow access from any IP (default)',
    hint: 'Users can access from any location.',
  },
  {
    value: 'ALLOW_LIST',
    label: 'Restrict to specific IP addresses',
    hint: 'Only allow access from approved IP addresses.',
  },
  {
    value: 'BLOCK_LIST',
    label: 'Block specific IP addresses',
    hint: 'Deny access from listed IP addresses.',
  },
];
const METHODS: { key: keyof SecuritySettings['methods']; label: string }[] = [
  { key: 'authenticatorApp', label: 'Authenticator App (e.g. Google Authenticator, Authy)' },
  { key: 'sms', label: 'SMS Text Message' },
  { key: 'email', label: 'Email Verification' },
  { key: 'hardwareKey', label: 'Hardware Security Key (e.g. YubiKey)' },
];
type AlertKey = Exclude<keyof SecuritySettings['notifications'], 'minimumSeverity'>;
const ALERTS: { key: AlertKey; label: string }[] = [
  { key: 'failedLogins', label: 'Failed login attempts' },
  { key: 'newDevice', label: 'New device login' },
  { key: 'passwordChanges', label: 'Password changes' },
  { key: 'mfaDisabled', label: 'MFA disabled' },
  { key: 'accountLocked', label: 'Account locked' },
  { key: 'suspicious', label: 'Suspicious activity' },
];
const MAX_IP_ENTRIES = 100;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 'es'}`;
const fieldGrid = 'grid gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3';

type Status = { tone: 'success' | 'error' | 'info'; text: string };
const STATUS_TONES = { success: 'text-success', error: 'text-danger', info: 'text-muted' };

/** Lines of addresses: trimmed, blank lines dropped, each kept once. */
const lines = (text: string) => [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];

export function SecuritySettingsForm() {
  const settings = useApiQuery(['admin-audit-security', 'settings'], () =>
    adminAuditSecurity.settings(),
  );
  const [draft, setDraft] = useState<SecuritySettings>();
  const [active, setActive] = useState<SectionId>('authentication');
  const [showErrors, setShowErrors] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [ipLists, setIpLists] = useState<{ allow: string; block: string } | null>(null);
  const minLengthId = useId();
  const save = useApiMutation(
    (body: { version: number; settings: SecuritySettings }) =>
      adminAuditSecurity.saveSettings(body),
    { invalidate: ['admin-audit-security'] },
  );

  const saved = settings.data;
  const current = draft ?? saved?.settings;
  const errors: SettingsErrors = current ? validateSecuritySettings(current) : {};
  const shown: SettingsErrors = showErrors ? errors : {};
  const changes = saved && current ? describeSettingsChanges(saved.settings, current) : [];
  const highImpact = changes.some((change) => change.highImpact);

  function change(edit: (value: SecuritySettings) => SecuritySettings) {
    if (!current) return;
    setDraft(edit(current));
    setStatus(null);
  }
  const patch = <K extends keyof SecuritySettings>(
    group: K,
    values: Partial<SecuritySettings[K]>,
  ) => change((value) => ({ ...value, [group]: { ...value[group], ...values } }));

  /** A card's body in its three states: skeleton, the quiet error line, or the controls. */
  const body = (rows: number, render: (value: SecuritySettings) => ReactNode) =>
    current ? (
      render(current)
    ) : settings.isError ? (
      <QuietLine>{loadError(settings.error)}</QuietLine>
    ) : (
      <SkeletonLines rows={rows} />
    );

  function review() {
    if (!current) return;
    if (Object.keys(errors).length) {
      setShowErrors(true);
      setStatus({
        tone: 'error',
        text: errors.options ?? 'Some settings need fixing. Check the highlighted fields.',
      });
      return;
    }
    if (!changes.length) {
      setStatus({ tone: 'info', text: 'Nothing has changed yet.' });
      return;
    }
    save.reset();
    setReviewing(true);
  }

  function confirmSave() {
    if (!saved || !current) return;
    save.mutate(
      { version: saved.version, settings: current },
      {
        onSuccess: (record) => {
          setDraft(record.settings);
          setReviewing(false);
          setShowErrors(false);
          setStatus({
            tone: 'success',
            text: 'Security settings saved. The change was added to the audit log.',
          });
        },
      },
    );
  }

  function openIpLists() {
    if (!current) return;
    setIpLists({ allow: current.ip.allowList.join('\n'), block: current.ip.blockList.join('\n') });
  }
  const allowLines = ipLists ? lines(ipLists.allow) : [];
  const blockLines = ipLists ? lines(ipLists.block) : [];
  const listError = (entries: string[]) => {
    const bad = entries.filter((entry) => !isIpEntry(entry));
    if (bad.length) return `Not an IP address or range: ${bad.join(', ')}`;
    if (entries.length > MAX_IP_ENTRIES) return `Keep the list to ${MAX_IP_ENTRIES} entries.`;
    return undefined;
  };
  const [ipChecked, setIpChecked] = useState(false);
  const allowError = ipChecked ? listError(allowLines) : undefined;
  const blockError = ipChecked ? listError(blockLines) : undefined;
  function applyIpLists() {
    setIpChecked(true);
    if (listError(allowLines) || listError(blockLines)) return;
    patch('ip', { allowList: allowLines, blockList: blockLines });
    setIpLists(null);
    setIpChecked(false);
  }

  const lastChanged = saved
    ? `Last changed ${formatShortStamp(saved.updatedAt, true)}${saved.updatedBy ? ` by ${saved.updatedBy}` : ''} · version ${saved.version}`
    : null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Security Settings"
        subtitle="Configure security policies and platform protection settings."
        above={
          <Breadcrumbs
            items={[
              { label: 'Audit & Security', href: '/audit-security' },
              { label: 'Security Settings' },
            ]}
          />
        }
        actions={
          <Button variant="secondary" disabled={!current} onClick={() => setResetting(true)}>
            <span className="inline-flex items-center gap-2 text-action">
              <ArrowsClockwise aria-hidden weight="bold" className="size-4" />
              Reset to Default
            </span>
          </Button>
        }
      />

      <nav
        aria-label="Security settings sections"
        className="flex gap-8 overflow-x-auto border-b border-divider"
      >
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={active === section.id ? 'location' : undefined}
            onClick={() => setActive(section.id)}
            className={`-mb-px inline-flex min-h-10 shrink-0 items-center border-b-2 py-2 text-sm font-medium ${active === section.id ? 'border-action text-action' : 'border-transparent text-muted hover:text-heading'}`}
          >
            {section.label}
          </a>
        ))}
      </nav>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <SettingsCard
          id="authentication"
          title="Multi-Factor Authentication (MFA)"
          subtitle="Require multi-factor authentication to enhance account security."
          icon={ShieldCheck}
          action={
            current ? (
              <span className="flex items-center gap-3 text-sm font-semibold text-heading">
                <Toggle
                  label="Multi-factor authentication (always on for Super Admins)"
                  checked
                  disabled
                  title="Always on: Super Admins must use MFA"
                  onChange={() => undefined}
                />
                <span aria-hidden>Enabled</span>
              </span>
            ) : null
          }
        >
          {body(3, (value) => (
            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">Who must use MFA</legend>
              {MFA_OPTIONS.map((option) => (
                <RadioOption
                  key={option.value}
                  name="mfa-scope"
                  label={option.label}
                  hint={option.hint}
                  checked={value.mfa.scope === option.value}
                  disabled={option.value === 'OPTIONAL'}
                  onSelect={() => {
                    if (option.value !== 'OPTIONAL') patch('mfa', { scope: option.value });
                  }}
                />
              ))}
            </fieldset>
          ))}
        </SettingsCard>

        <SettingsCard
          id="authentication-methods"
          title="Allowed Authentication Methods"
          subtitle="Select which authentication methods are allowed."
          icon={DeviceMobile}
        >
          {body(4, (value) => (
            <fieldset className="flex flex-col">
              <legend className="sr-only">Allowed authentication methods</legend>
              {METHODS.map((method) => (
                <Checkbox
                  key={method.key}
                  label={method.label}
                  checked={value.methods[method.key]}
                  onChange={(event) => {
                    const { checked } = event.target;
                    change((next) => ({
                      ...next,
                      methods: { ...next.methods, [method.key]: checked },
                    }));
                  }}
                />
              ))}
              {shown.methods ? (
                <p role="alert" className="text-xs text-danger">
                  {shown.methods}
                </p>
              ) : null}
            </fieldset>
          ))}
        </SettingsCard>

        <SettingsCard
          id="password-policy"
          title="Password Policy"
          subtitle="Set password requirements for all users."
          icon={Wrench}
        >
          {body(4, (value) => (
            <div className={fieldGrid}>
              <FormField label="Minimum Length" htmlFor={minLengthId} error={shown.minLength}>
                <span
                  className={`flex min-w-0 items-center rounded-control border bg-surface focus-within:outline-2 focus-within:outline-accent-500 ${shown.minLength ? 'border-danger' : 'border-border'}`}
                >
                  <input
                    id={minLengthId}
                    type="number"
                    inputMode="numeric"
                    min={8}
                    max={128}
                    aria-invalid={shown.minLength ? true : undefined}
                    value={Number.isNaN(value.password.minLength) ? '' : value.password.minLength}
                    onChange={(event) =>
                      patch('password', {
                        minLength:
                          event.target.value === '' ? Number.NaN : Number(event.target.value),
                      })
                    }
                    className="w-full min-w-8 [appearance:textfield] rounded-control bg-transparent px-3 text-base text-text outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="shrink-0 border-l border-divider px-2 text-sm text-muted">
                    characters
                  </span>
                </span>
              </FormField>
              <YesNoSelect
                label="Require Uppercase"
                value={value.password.uppercase}
                onChange={(uppercase) => patch('password', { uppercase })}
              />
              <YesNoSelect
                label="Require Lowercase"
                value={value.password.lowercase}
                onChange={(lowercase) => patch('password', { lowercase })}
              />
              <YesNoSelect
                label="Require Numbers"
                value={value.password.numbers}
                onChange={(numbers) => patch('password', { numbers })}
              />
              <YesNoSelect
                label="Require Special Characters"
                value={value.password.special}
                onChange={(special) => patch('password', { special })}
              />
              <NumberSelect
                label="Password Expiration"
                value={value.password.expirationDays}
                choices={PASSWORD_EXPIRATION_DAYS}
                show={daysLabel}
                onChange={(days) =>
                  patch('password', {
                    expirationDays: days as SecuritySettings['password']['expirationDays'],
                  })
                }
              />
            </div>
          ))}
        </SettingsCard>

        <SettingsCard
          id="session-access"
          title="Session & Access Controls"
          subtitle="Manage user sessions and access behavior."
          icon={Clock}
        >
          {body(4, (value) => (
            <>
              <div className={fieldGrid}>
                <NumberSelect
                  label="Session Timeout (Inactivity)"
                  value={value.session.idleTimeoutMinutes}
                  choices={IDLE_TIMEOUT_MINUTES}
                  show={minutesLabel}
                  onChange={(idleTimeoutMinutes) => patch('session', { idleTimeoutMinutes })}
                />
                <NumberSelect
                  label="Remember Me"
                  value={value.session.rememberMeDays}
                  choices={REMEMBER_ME_DAYS}
                  show={(days) => (days === 0 ? 'Off' : daysLabel(days))}
                  onChange={(rememberMeDays) => patch('session', { rememberMeDays })}
                />
                <NumberSelect
                  label="Concurrent Sessions"
                  value={value.session.concurrentSessions}
                  choices={CONCURRENT_SESSIONS}
                  show={sessionsLabel}
                  onChange={(concurrentSessions) => patch('session', { concurrentSessions })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <ToggleRow
                  label="Allow users to view and manage their active sessions"
                  checked={value.session.selfManage}
                  onChange={(selfManage) => patch('session', { selfManage })}
                />
                <ToggleRow
                  label="Force re-authentication for sensitive actions (e.g. exporting data, changing permissions)"
                  checked={value.session.reauthSensitive}
                  onChange={(reauthSensitive) => patch('session', { reauthSensitive })}
                />
                <ToggleRow
                  label="Require re-authentication when switching devices"
                  checked={value.session.reauthDeviceSwitch}
                  onChange={(reauthDeviceSwitch) => patch('session', { reauthDeviceSwitch })}
                />
              </div>
            </>
          ))}
        </SettingsCard>

        <SettingsCard
          id="account-protection"
          title="Account Protection"
          subtitle="Configure lockout rules and account security."
          icon={Lock}
        >
          {body(4, (value) => (
            <>
              <div className={fieldGrid}>
                <NumberSelect
                  label="Max Failed Login Attempts"
                  value={value.protection.maxFailedAttempts}
                  choices={MAX_FAILED_ATTEMPTS}
                  show={(count) => `${count} attempts`}
                  onChange={(maxFailedAttempts) => patch('protection', { maxFailedAttempts })}
                />
                <NumberSelect
                  label="Lockout Duration"
                  value={value.protection.lockoutMinutes}
                  choices={LOCKOUT_MINUTES}
                  show={minutesLabel}
                  onChange={(lockoutMinutes) => patch('protection', { lockoutMinutes })}
                />
                <YesNoSelect
                  label="Notify on Suspicious Activity"
                  value={value.protection.notifySuspicious}
                  onChange={(notifySuspicious) => patch('protection', { notifySuspicious })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <ToggleRow
                  label="Automatically lock accounts after failed attempts"
                  checked={value.protection.autoLock}
                  onChange={(autoLock) => patch('protection', { autoLock })}
                />
                <ToggleRow
                  label="Send email alert to Super Admin on account lockout"
                  checked={value.protection.emailAdminOnLockout}
                  onChange={(emailAdminOnLockout) => patch('protection', { emailAdminOnLockout })}
                />
                <ToggleRow
                  label="Require email verification for new devices"
                  checked={value.protection.verifyNewDevices}
                  onChange={(verifyNewDevices) => patch('protection', { verifyNewDevices })}
                />
              </div>
            </>
          ))}
        </SettingsCard>

        <SettingsCard
          id="ip-restrictions"
          title="IP Restrictions"
          subtitle="Control access based on IP addresses."
          icon={MapPin}
          action={
            <Button variant="secondary" disabled={!current} onClick={openIpLists}>
              <span className="text-action">Manage IP List</span>
            </Button>
          }
        >
          {body(3, (value) => (
            <fieldset className="flex flex-col gap-1">
              <legend className="sr-only">IP access</legend>
              {IP_OPTIONS.map((option) => {
                const count =
                  option.value === 'ALLOW_LIST'
                    ? value.ip.allowList.length
                    : option.value === 'BLOCK_LIST'
                      ? value.ip.blockList.length
                      : null;
                return (
                  <RadioOption
                    key={option.value}
                    name="ip-mode"
                    label={option.label}
                    hint={
                      count === null
                        ? option.hint
                        : `${option.hint} ${plural(count, 'address')} listed.`
                    }
                    checked={value.ip.mode === option.value}
                    onSelect={() => patch('ip', { mode: option.value })}
                  />
                );
              })}
              {shown.ipMode || shown.allowList || shown.blockList ? (
                <p role="alert" className="text-xs text-danger">
                  {shown.ipMode ?? shown.allowList ?? shown.blockList}
                </p>
              ) : null}
            </fieldset>
          ))}
        </SettingsCard>

        <SettingsCard
          id="notifications"
          title="Security Notifications"
          subtitle="Choose when to receive security alerts."
          icon={Bell}
        >
          {body(3, (value) => (
            <>
              <fieldset className="grid sm:grid-cols-2">
                <legend className="sr-only">Send an alert for</legend>
                {ALERTS.map((alert) => (
                  <Checkbox
                    key={alert.key}
                    label={alert.label}
                    checked={value.notifications[alert.key]}
                    onChange={(event) => {
                      const { checked } = event.target;
                      change((next) => ({
                        ...next,
                        notifications: { ...next.notifications, [alert.key]: checked },
                      }));
                    }}
                  />
                ))}
              </fieldset>
              <fieldset className="flex flex-col gap-1 border-t border-divider pt-3">
                <legend className="text-sm font-medium text-text">
                  Send {SEVERITY_FLOOR_LABELS[value.notifications.minimumSeverity]} alerts by
                </legend>
                <div className="flex flex-wrap gap-x-6">
                  <Checkbox label="In-app (always on)" checked disabled readOnly />
                  <Checkbox
                    label="Email"
                    checked={value.notifications.email}
                    onChange={(event) => patch('notifications', { email: event.target.checked })}
                  />
                  <Checkbox
                    label="SMS"
                    checked={value.notifications.sms}
                    onChange={(event) => patch('notifications', { sms: event.target.checked })}
                  />
                </div>
              </fieldset>
            </>
          ))}
        </SettingsCard>

        <SettingsCard
          id="audit-log-retention"
          title="Audit Log Retention"
          subtitle="Set how long audit logs and security events are stored."
          icon={Database}
        >
          {body(3, (value) => (
            <>
              <div className="grid items-end gap-3 sm:grid-cols-2">
                <NumberSelect
                  label="Retention Period"
                  value={value.retention.retentionDays}
                  choices={RETENTION_DAYS}
                  show={retentionLabel}
                  disabled={saved?.retentionEditable === false}
                  onChange={(retentionDays) =>
                    patch('retention', {
                      retentionDays,
                      archiveAfterDays: Math.min(value.retention.archiveAfterDays, retentionDays),
                    })
                  }
                />
                <p className="rounded-lg bg-info-soft p-3 text-xs text-text">
                  {saved?.retentionEditable === false
                    ? 'Retention is fixed by Firmivra policy and cannot change here.'
                    : 'Logs older than the selected period will be automatically archived and removed from the active database.'}
                </p>
              </div>
              <div className="grid items-end gap-3 sm:grid-cols-2">
                <Select
                  label="Who Can Export Logs"
                  value={exportLevel(value.exports.roles)}
                  onChange={(event) => {
                    const level = EXPORT_ROLES.find((role) => role === event.target.value);
                    if (level) patch('exports', { roles: exportRolesFor(level) });
                  }}
                  options={EXPORT_ROLES.map((role) => ({
                    value: role,
                    label: EXPORT_ROLE_LABELS[role],
                  }))}
                />
                <ToggleRow
                  label="Require re-authentication to export logs"
                  checked={value.exports.requireReauth}
                  onChange={(requireReauth) => patch('exports', { requireReauth })}
                />
              </div>
            </>
          ))}
        </SettingsCard>
      </div>

      <footer className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          {status ? (
            <p
              role={status.tone === 'error' ? 'alert' : 'status'}
              data-testid="settings-status"
              className={STATUS_TONES[status.tone]}
            >
              {status.text}
            </p>
          ) : null}
          {lastChanged ? <p className="text-xs text-muted">{lastChanged}</p> : null}
        </div>
        <div className="flex shrink-0 justify-end gap-3">
          <Button
            variant="secondary"
            disabled={!current}
            onClick={() => {
              setDraft(undefined);
              setShowErrors(false);
              setStatus(changes.length ? { tone: 'info', text: 'Changes discarded.' } : null);
            }}
          >
            Cancel
          </Button>
          <Button disabled={!current} onClick={review}>
            Save Changes
          </Button>
        </div>
      </footer>

      <Modal
        open={reviewing}
        title="Review changes"
        subtitle={`${changes.length} ${changes.length === 1 ? 'setting changes' : 'settings change'} for everyone on Firmivra.`}
        onClose={() => setReviewing(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewing(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSave} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : highImpact ? 'Confirm and Save' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {highImpact ? (
            <Callout
              size="compact"
              surface="warning"
              tone="amber"
              icon={Warning}
              title="High-impact change"
            >
              Some changes weaken protection or change who can reach Firmivra. They apply to every
              user as soon as you save.
            </Callout>
          ) : null}
          <ul
            data-testid="settings-changes"
            className="flex flex-col divide-y divide-divider text-sm"
          >
            {changes.map((item) => (
              <li key={item.label} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-heading">
                  {item.label}
                  {item.highImpact ? <Badge tone="warning">High impact</Badge> : null}
                </span>
                <span className="text-text">
                  {item.before} → {item.after}
                </span>
              </li>
            ))}
          </ul>
          {save.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error)}
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={resetting}
        title="Reset to default?"
        subtitle="Every setting on this page goes back to Firmivra's recommended defaults."
        onClose={() => setResetting(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetting(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setDraft(structuredClone(DEFAULT_SECURITY_SETTINGS));
                setResetting(false);
                setStatus({
                  tone: 'info',
                  text: 'Defaults filled in. Nothing changes until you save.',
                });
              }}
            >
              Use Defaults
            </Button>
          </>
        }
      >
        <Callout size="compact" surface="info" icon={Info}>
          The defaults require MFA for admin users, a {DEFAULT_SECURITY_SETTINGS.password.minLength}
          -character password without forced expiry, and keep audit logs for{' '}
          {retentionLabel(DEFAULT_SECURITY_SETTINGS.retention.retentionDays)}. Review them, then
          Save Changes.
        </Callout>
      </Modal>

      <Modal
        open={ipLists !== null}
        title="Manage IP List"
        subtitle="One IPv4 or IPv6 address, or a CIDR range such as 203.0.113.0/24, per line."
        onClose={() => {
          setIpLists(null);
          setIpChecked(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setIpLists(null);
                setIpChecked(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={applyIpLists}>Done</Button>
          </>
        }
      >
        {ipLists ? (
          <div className="flex flex-col gap-4">
            <Textarea
              label={`Approved IP addresses (${allowLines.length})`}
              rows={4}
              value={ipLists.allow}
              error={allowError}
              onChange={(event) => setIpLists({ ...ipLists, allow: event.target.value })}
            />
            <Textarea
              label={`Blocked IP addresses (${blockLines.length})`}
              rows={4}
              value={ipLists.block}
              error={blockError}
              onChange={(event) => setIpLists({ ...ipLists, block: event.target.value })}
            />
            <p className="text-xs text-muted">
              The lists apply when Restrict or Block is chosen, after you save. Make sure your own
              address stays allowed.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
