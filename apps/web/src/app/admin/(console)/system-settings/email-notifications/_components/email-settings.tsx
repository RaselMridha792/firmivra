'use client';

import type { AdminEmailSettings } from '@firmivra/types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  RichTextEditor,
  Select,
  Toggle,
} from '@firmivra/ui';
import {
  ArrowsClockwise,
  Bell,
  CheckSquare,
  EnvelopeSimple,
  Gear,
  PaperPlaneTilt,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  Body,
  failedStatus,
  ImportantNote,
  SaveBar,
  savedStatus,
  SectionCard,
  SettingsHeader,
  SETTINGS_ERRORS,
  SS,
} from '../../_components/settings-kit';

const NAV = [
  { href: '#general', label: 'General' },
  { href: '/communications/templates', label: 'Email Templates' },
  { href: '#notifications', label: 'Notification Preferences' },
  { href: '/communications/templates', label: 'Transactional Emails' },
  { href: '/notifications', label: 'Reminders & Alerts' },
  { href: '#advanced', label: 'Advanced Settings' },
];
const CHANNELS: { key: keyof AdminEmailSettings['channels']; label: string; hint: string }[] = [
  { key: 'email', label: 'Enable Email Notifications', hint: 'Send notifications via email' },
  {
    key: 'inApp',
    label: 'Enable In-App Notifications',
    hint: 'Show notifications in the platform',
  },
  {
    key: 'sms',
    label: 'Enable SMS Notifications',
    hint: 'Send notifications via SMS (requires integration)',
  },
  { key: 'push', label: 'Enable Push Notifications', hint: 'Send browser/app push notifications' },
];
const RECIPIENTS: { key: keyof AdminEmailSettings['recipients']; label: string }[] = [
  { key: 'systemAlerts', label: 'System Alerts' },
  { key: 'firmApplications', label: 'New Firm Applications' },
  { key: 'billing', label: 'Billing Notifications' },
  { key: 'securityAlerts', label: 'Security Alerts' },
];
const GROUPS = [
  { value: 'SUPER_ADMINS', label: 'Super Admin Only' },
  { value: 'ALL_ADMINS', label: 'All Admins' },
  { value: 'NOBODY', label: 'Nobody' },
];
const DEFAULTS: Omit<
  AdminEmailSettings,
  'fromName' | 'fromEmail' | 'replyTo' | 'cc' | 'signature'
> = {
  includeSignature: true,
  channels: { email: true, inApp: true, sms: false, push: false },
  digest: false,
  recipients: {
    systemAlerts: 'SUPER_ADMINS',
    firmApplications: 'SUPER_ADMINS',
    billing: 'SUPER_ADMINS',
    securityAlerts: 'SUPER_ADMINS',
  },
  maxRetries: 3,
  retryBackoffMinutes: 15,
  dailyCapPerRecipient: 50,
};
const QUICK = [
  {
    label: 'Email Templates',
    text: 'Manage system email templates',
    href: '/communications/templates',
    icon: EnvelopeSimple,
  },
  {
    label: 'Notification Preferences',
    text: 'Set default notification rules',
    href: '#notifications',
    icon: Gear,
  },
  {
    label: 'Transactional Emails',
    text: 'Configure automated emails',
    href: '/communications/templates',
    icon: EnvelopeSimple,
  },
  {
    label: 'Reminders & Alerts',
    text: 'Manage system reminders',
    href: '/notifications',
    icon: Bell,
  },
  {
    label: 'View Email Logs',
    text: 'See recent email activity',
    href: '/audit-security?view=audit&search=email',
    icon: CheckSquare,
  },
];

type Status = Parameters<typeof SaveBar>[0]['status'];

function Switch({
  label,
  hint,
  on,
  set,
}: {
  label: string;
  hint?: string;
  on: boolean;
  set: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Toggle label={label} checked={on} onChange={set} />
      <div className="text-sm">
        <p className="text-heading" aria-hidden>
          {label}
        </p>
        {hint ? <p className="text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

/**
 * Email & Notifications (firmivra-email-and-notifications-settings.jpg): the sender, the
 * signature, the channels and digest, the default recipients, delivery limits, a custom SMTP
 * server (a Secrets Manager reference, never the password) and Send Test Email. Delivery rate and
 * bounces have no source yet (no delivery events are kept): they show as not available.
 */
export function EmailSettings() {
  const q = useApiQuery([...SS, 'email'], () => api.adminSettings.email());
  const [draft, setDraft] = useState<AdminEmailSettings>();
  const [status, setStatus] = useState<Status>(null);
  const [testing, setTesting] = useState(false);
  const [smtp, setSmtp] = useState(false);
  const value = draft ?? q.data?.value;
  const save = useApiMutation(
    () => api.adminSettings.saveEmail({ version: q.data!.version, value: value! }),
    { invalidate: [...SS] },
  );
  const set = (next: Partial<AdminEmailSettings>) => {
    if (!value) return;
    setDraft({ ...value, ...next });
    setStatus(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        title="Email & Notifications"
        subtitle="Configure system email settings, notification preferences, and templates."
        icon={EnvelopeSimple}
      />
      <nav aria-label="Sections" className="flex gap-8 overflow-x-auto border-b border-divider">
        {NAV.map((s, i) => (
          <a
            key={s.label}
            href={s.href}
            aria-current={i === 0 ? 'location' : undefined}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 text-sm font-medium ${i === 0 ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`}
          >
            {s.label}
          </a>
        ))}
      </nav>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_1fr_24rem]">
        <SectionCard
          id="general"
          title="Email Settings"
          subtitle="Configure the default sender information for system emails."
          icon={EnvelopeSimple}
        >
          <Body query={{ ...q, data: value }} rows={4}>
            {(v) => (
              <div className="flex flex-col gap-4">
                <Input
                  label="From Name"
                  value={v.fromName}
                  maxLength={100}
                  onChange={(e) => set({ fromName: e.target.value })}
                />
                <Input
                  label="From Email"
                  type="email"
                  value={v.fromEmail ?? ''}
                  onChange={(e) => set({ fromEmail: e.target.value || null })}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Reply-To Email"
                    type="email"
                    value={v.replyTo ?? ''}
                    onChange={(e) => set({ replyTo: e.target.value || null })}
                  />
                  <Input
                    label="CC Email (Optional)"
                    type="email"
                    placeholder="Enter CC email"
                    value={v.cc ?? ''}
                    onChange={(e) => set({ cc: e.target.value || null })}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Toggle
                      label="Use Custom SMTP"
                      checked={q.data?.smtpConfigured ?? false}
                      disabled
                      onChange={() => undefined}
                    />
                    <div className="text-sm">
                      <p className="text-heading" aria-hidden>
                        Use Custom SMTP
                      </p>
                      <p className="text-xs text-muted">Connect your own SMTP server (optional)</p>
                    </div>
                  </div>
                  <Button variant="secondary" onClick={() => setSmtp(true)}>
                    <span className="inline-flex items-center gap-2 text-action">
                      <Gear aria-hidden weight="fill" className="size-4" />
                      Configure SMTP
                    </span>
                  </Button>
                </div>
              </div>
            )}
          </Body>
        </SectionCard>

        <SectionCard
          id="signature"
          title="Email Signature"
          subtitle="Set the default signature for system emails."
          icon={UsersThree}
        >
          <Body query={{ ...q, data: value }} rows={4}>
            {(v) => (
              <div className="flex flex-col gap-3">
                <RichTextEditor
                  label="Signature"
                  value={v.signature ?? ''}
                  maxLength={4000}
                  onChange={(html) => set({ signature: html || null })}
                />
                <Checkbox
                  label="Include signature in all system emails"
                  checked={v.includeSignature}
                  onChange={(e) => set({ includeSignature: e.target.checked })}
                />
              </div>
            )}
          </Body>
        </SectionCard>

        <aside className="flex min-w-0 flex-col gap-5 xl:row-span-2">
          <ImportantNote>
            These settings apply to the entire Firmivra platform and all firms. Changes may impact
            all users.
          </ImportantNote>
          <Card className="flex flex-col gap-3 p-5!" data-testid="delivery-status">
            <h2 className="flex items-center gap-3 text-base font-bold text-heading">
              <span className="flex size-10 items-center justify-center rounded-full bg-info-soft text-action">
                <CheckSquare aria-hidden weight="fill" className="size-5" />
              </span>
              Email Delivery Status
            </h2>
            <dl className="text-sm">
              <div className="flex justify-between py-1.5">
                <dt className="text-text">SMTP Connection</dt>
                <dd>
                  {q.data ? (
                    <Badge tone={q.data.smtpConfigured ? 'success' : 'neutral'}>
                      {q.data.smtpConfigured ? 'Custom server' : 'Platform sender'}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              {['Last Test Email', 'Delivery Rate (24h)', 'Bounced Emails (24h)'].map((l) => (
                <div key={l} className="flex justify-between py-1.5">
                  <dt className="text-text">{l}</dt>
                  <dd className="text-muted">Not available</dd>
                </div>
              ))}
            </dl>
            <Button variant="secondary" disabled={!q.data} onClick={() => setTesting(true)}>
              <span className="inline-flex items-center gap-2 text-action">
                <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
                Send Test Email
              </span>
            </Button>
          </Card>
          <Card className="flex flex-col gap-2 p-5!" data-testid="quick-links">
            <h2 className="text-base font-bold text-heading">Quick Links</h2>
            <ul className="divide-y divide-divider">
              {QUICK.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="flex items-center gap-3 py-2.5 hover:text-action">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-action">
                      <l.icon aria-hidden weight="fill" className="size-4.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-heading">{l.label}</span>
                      <span className="block text-xs text-muted">{l.text}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </aside>

        <SectionCard
          id="notifications"
          title="Notification Settings"
          subtitle="Configure how system notifications are sent."
          icon={Bell}
        >
          <Body query={{ ...q, data: value }} rows={5}>
            {(v) => (
              <div className="flex flex-col gap-4">
                {CHANNELS.map((c) => (
                  <Switch
                    key={c.key}
                    label={c.label}
                    hint={c.hint}
                    on={v.channels[c.key]}
                    set={(on) => set({ channels: { ...v.channels, [c.key]: on } })}
                  />
                ))}
                <Switch
                  label="Digest Mode"
                  hint="Combine non-urgent notifications into a daily digest"
                  on={v.digest}
                  set={(on) => set({ digest: on })}
                />
              </div>
            )}
          </Body>
        </SectionCard>

        <SectionCard
          id="recipients"
          title="Default Notification Recipients"
          subtitle="Set default recipients for important system notifications."
          icon={UsersThree}
        >
          <Body query={{ ...q, data: value }} rows={4}>
            {(v) => (
              <div className="flex flex-col gap-4">
                {RECIPIENTS.map((r) => (
                  <Select
                    key={r.key}
                    label={r.label}
                    value={v.recipients[r.key]}
                    onChange={(e) =>
                      set({
                        recipients: {
                          ...v.recipients,
                          [r.key]: e.target
                            .value as AdminEmailSettings['recipients']['systemAlerts'],
                        },
                      })
                    }
                    options={GROUPS}
                  />
                ))}
              </div>
            )}
          </Body>
        </SectionCard>
      </div>

      <SectionCard
        id="advanced"
        title="Advanced Settings"
        subtitle="Retries and limits for system email delivery."
        icon={ArrowsClockwise}
      >
        <Body query={{ ...q, data: value }} rows={1}>
          {(v) => (
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label="Retries for a failed email"
                type="number"
                min={0}
                max={10}
                value={String(v.maxRetries)}
                onChange={(e) => set({ maxRetries: Number(e.target.value) })}
              />
              <Input
                label="Minutes between retries"
                type="number"
                min={1}
                max={1440}
                value={String(v.retryBackoffMinutes)}
                onChange={(e) => set({ retryBackoffMinutes: Number(e.target.value) })}
              />
              <Input
                label="Most emails per recipient a day"
                type="number"
                min={1}
                max={1000}
                value={String(v.dailyCapPerRecipient)}
                onChange={(e) => set({ dailyCapPerRecipient: Number(e.target.value) })}
              />
            </div>
          )}
        </Body>
      </SectionCard>

      <SaveBar
        status={status}
        saving={save.isPending}
        disabled={!value}
        onReset={() => {
          if (!value) return;
          setDraft({ ...value, ...DEFAULTS });
          setStatus({
            tone: 'info',
            text: "Firmivra's defaults are filled in. Nothing changes until you save.",
          });
        }}
        onSave={() =>
          save.mutate(undefined, {
            onSuccess: (s) => {
              setDraft(s.value);
              setStatus(savedStatus);
            },
            onError: (e) => setStatus(failedStatus(e)),
          })
        }
      />
      <TestEmail open={testing} onClose={() => setTesting(false)} />
      <SmtpModal
        open={smtp}
        configured={q.data?.smtpConfigured ?? false}
        onClose={() => setSmtp(false)}
        onDone={setStatus}
      />
    </div>
  );
}

function TestEmail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [to, setTo] = useState('');
  const send = useApiMutation(() => api.adminSettings.testEmail({ to }));
  return (
    <Modal
      open={open}
      title="Send Test Email"
      subtitle="Sends one email with the saved sender settings. Nothing is saved."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!to.trim() || send.isPending} onClick={() => send.mutate(undefined)}>
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input label="Send to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        {send.data ? (
          <p
            role="status"
            className={`text-sm ${send.data.accepted ? 'text-success' : 'text-danger'}`}
          >
            {send.data.accepted
              ? 'The email was accepted for delivery.'
              : `Not sent: ${send.data.detail ?? 'the sender is not set up here.'}`}
          </p>
        ) : null}
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, SETTINGS_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** A custom SMTP server: a Secrets Manager reference (the password stays in AWS), or remove it. */
function SmtpModal({
  open,
  configured,
  onClose,
  onDone,
}: {
  open: boolean;
  configured: boolean;
  onClose: () => void;
  onDone: (s: Status) => void;
}) {
  const [reference, setReference] = useState('');
  const setRef = useApiMutation(
    () => api.adminSettings.setSecret('smtp', { reference, hint: null }),
    { invalidate: [...SS] },
  );
  const remove = useApiMutation(() => api.adminSettings.removeSecret('smtp'), {
    invalidate: [...SS],
  });
  const done = (text: string) => {
    onDone({ tone: 'ok', text });
    onClose();
  };
  return (
    <Modal
      open={open}
      title="Configure SMTP"
      subtitle="Firmivra stores where the SMTP credentials are (an AWS Secrets Manager ARN), never the credentials."
      onClose={onClose}
      footer={
        <>
          {configured ? (
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () =>
                    done('The custom SMTP server was removed: the platform sender is used.'),
                })
              }
            >
              <span className="text-danger">Remove</span>
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reference.trim() || setRef.isPending}
            onClick={() =>
              setRef.mutate(undefined, { onSuccess: () => done('The SMTP reference was saved.') })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Secret reference (ARN)"
          placeholder="arn:aws:secretsmanager:…:secret:…"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        {setRef.isError || remove.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(setRef.error ?? remove.error, SETTINGS_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
