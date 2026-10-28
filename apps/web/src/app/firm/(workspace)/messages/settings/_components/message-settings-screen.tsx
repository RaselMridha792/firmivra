'use client';

import {
  MESSAGE_ATTACHMENT_TYPES,
  type MessageAttachmentType,
  type MessageSettings,
  type UpdateMessageSettingsRequest,
} from '@firmivra/types';
import { Button, Checkbox, Input, Select, Textarea, Toast, Toggle } from '@firmivra/ui';
import {
  Archive,
  BellRinging,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  Clock,
  Gear,
  Paperclip,
  PenNib,
  ShieldCheck,
  UserCircleGear,
  UsersThree,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { OriginLink } from '../../../../../../components/origin-link';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { useUnsavedChanges } from '../../../../../../lib/unsaved';
import { NOT_LOADED, SettingsCard } from '../../../settings/_components/settings-parts';

const KEY = ['messages', 'settings'] as const;
const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
const row = 'flex items-center justify-between gap-3 py-1 text-sm text-heading';

type Draft = Omit<
  MessageSettings,
  'smsReady' | 'defaultAssignee' | 'timezone' | 'updatedAt' | 'updatedBy'
> & { defaultAssigneeUserId: string | null };

const draftOf = (s: MessageSettings): Draft => ({
  portalEnabled: s.portalEnabled,
  emailEnabled: s.emailEnabled,
  smsEnabled: s.smsEnabled,
  senderName: s.senderName,
  signature: s.signature,
  notifyUnread: s.notifyUnread,
  notifyAssignment: s.notifyAssignment,
  notifyReply: s.notifyReply,
  notifyFailure: s.notifyFailure,
  notifyBulkComplete: s.notifyBulkComplete,
  defaultAssigneeUserId: s.defaultAssignee?.userId ?? null,
  readReceiptsEnabled: s.readReceiptsEnabled,
  retentionMonths: s.retentionMonths,
  attachmentMaxMb: s.attachmentMaxMb,
  allowedAttachmentTypes: s.allowedAttachmentTypes,
  quietHoursStart: s.quietHoursStart,
  quietHoursEnd: s.quietHoursEnd,
  bulkConfirmThreshold: s.bulkConfirmThreshold,
  bulkRequiresManager: s.bulkRequiresManager,
});

/** The fields that differ from what was loaded: the PATCH sends only those. */
function changes(saved: Draft, draft: Draft): Partial<Draft> {
  const out: Partial<Draft> = {};
  for (const key of Object.keys(draft) as (keyof Draft)[]) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(saved[key]))
      (out as Record<string, unknown>)[key] = draft[key];
  }
  // Quiet hours go together, both or neither.
  if ('quietHoursStart' in out || 'quietHoursEnd' in out) {
    out.quietHoursStart = draft.quietHoursStart;
    out.quietHoursEnd = draft.quietHoursEnd;
  }
  return out;
}

const NOTIFY = [
  ['notifyUnread', 'Unread messages', 'A client message nobody has read yet.'],
  ['notifyAssignment', 'Assignments', 'A conversation assigned to you.'],
  ['notifyReply', 'Replies', 'A client replies in a conversation you are on.'],
  ['notifyFailure', 'Failed deliveries', 'An email or text could not be delivered.'],
  ['notifyBulkComplete', 'Bulk send complete', 'A bulk message finished sending.'],
] as const;
const RETENTION = [
  { value: '', label: 'Keep conversations open' },
  ...[6, 12, 24, 36, 60, 84].map((m) => ({
    value: String(m),
    label: `Archive after ${m} months of silence`,
  })),
];

/**
 * /messages/settings (MSG-F02, her section 19): channels, sender and signature, notifications,
 * the default assignee, read receipts, retention, attachments, quiet hours, consent and bulk
 * limits. Every member reads them; Owner and Admin change them. Provider credentials stay in
 * Integrations. Nothing here sends a message.
 */
export function MessageSettingsScreen() {
  const qc = useQueryClient();
  const { role } = useFirm();
  const manages = role === 'OWNER' || role === 'ADMIN';
  const settings = useApiQuery([...KEY], () => api.messages.settings());
  const team = useApiQuery([...KEY, 'team'], () => api.team.list());
  const loaded = settings.data;
  const [edit, setEdit] = useState<{ base: string; draft: Draft }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' }>();
  // The draft starts from what was loaded, and again whenever a save brings a newer version.
  const base = loaded?.updatedAt ?? 'defaults';
  const draft = loaded ? (edit?.base === base ? edit.draft : draftOf(loaded)) : undefined;
  const pending = loaded && draft ? changes(draftOf(loaded), draft) : {};
  const dirty = Object.keys(pending).length > 0;
  useUnsavedChanges(dirty);
  const set = (patch: Partial<Draft>) => draft && setEdit({ base, draft: { ...draft, ...patch } });
  const quietOn = draft ? draft.quietHoursStart !== null : false;

  const save = async () => {
    if (!loaded || !dirty) return;
    setBusy(true);
    try {
      const body = { version: loaded.updatedAt, ...pending } as UpdateMessageSettingsRequest;
      const next = await api.messages.updateSettings(body);
      qc.setQueryData([...KEY], next);
      setEdit(undefined);
      setNotice({ text: 'Messages Settings saved.', tone: 'success' });
    } catch (e) {
      setNotice({ text: errorMessage(e), tone: 'error' });
    }
    setBusy(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="message-settings">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <ChatCircleDots weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
              <Link href="/messages" className="text-link hover:underline">
                Messages
              </Link>
              <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
              <span aria-current="page" className="font-semibold text-heading">
                Settings
              </span>
            </nav>
            <h1
              data-testid="page-title"
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
            >
              Messages Settings
            </h1>
            <p className="text-base text-muted">
              How your firm sends, receives and keeps client messages.
            </p>
          </div>
        </div>
        {manages ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!dirty || busy}
              onClick={() => setEdit(undefined)}
            >
              Discard Changes
            </Button>
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        ) : null}
      </header>
      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(undefined)} />
      ) : null}
      {!manages ? (
        <p className={quiet} data-testid="settings-read-only">
          Only the Owner and Admins change Messages Settings. You can see them here.
        </p>
      ) : null}
      {settings.isError ? (
        <p role="alert" className={quiet}>
          {NOT_LOADED}
        </p>
      ) : null}
      {settings.isPending ? <p className={quiet}>Loading…</p> : null}

      {loaded && draft ? (
        <fieldset disabled={!manages || busy} className="grid min-w-0 gap-4 lg:grid-cols-2">
          <legend className="sr-only">Messages Settings</legend>
          <SettingsCard
            title="Channels"
            subtitle="Where your messages go. Each provider is connected in Integrations."
            icon={ChatCircleDots}
            testId="settings-channels"
          >
            <Switch
              label="Client portal"
              hint="A secure message in the client's portal."
              checked={draft.portalEnabled}
              onChange={(v) => set({ portalEnabled: v })}
            />
            <Switch
              label="Email"
              hint="Sent from your firm's verified sender."
              checked={draft.emailEnabled}
              onChange={(v) => set({ emailEnabled: v })}
            />
            <Switch
              label="Text message (SMS)"
              hint="Only to clients with a mobile number who agreed to texts."
              checked={draft.smsEnabled}
              onChange={(v) => set({ smsEnabled: v })}
            />
            {draft.smsEnabled && !loaded.smsReady ? (
              <p className="rounded-lg bg-warning-soft p-3 text-sm text-heading" role="note">
                Texts cannot be sent yet: your firm&apos;s text number is not registered. Nothing is
                sent by text until it is.
              </p>
            ) : null}
            <OriginLink href="/integrations" className="text-sm font-medium text-link">
              Providers and credentials are in Integrations
            </OriginLink>
          </SettingsCard>

          <SettingsCard
            title="Sender and Signature"
            subtitle="The name your messages come from, and the firm's signature."
            icon={PenNib}
            tone="purple"
          >
            <Input
              label="Sender name"
              placeholder="Your firm's name"
              maxLength={100}
              value={draft.senderName ?? ''}
              onChange={(e) => set({ senderName: e.target.value || null })}
            />
            <Textarea
              label="Firm signature"
              rows={4}
              maxLength={1000}
              value={draft.signature ?? ''}
              onChange={(e) => set({ signature: e.target.value || null })}
            />
            <p className="text-xs text-muted">
              A member&apos;s own email signature, saved in the email composer, is used on their
              messages instead of this one.
            </p>
          </SettingsCard>

          <SettingsCard
            title="Notifications"
            subtitle="The alerts your team gets in Firmivra."
            icon={BellRinging}
            tone="amber"
          >
            {NOTIFY.map(([key, label, hint]) => (
              <Switch
                key={key}
                label={label}
                hint={hint}
                checked={draft[key]}
                onChange={(v) => set({ [key]: v })}
              />
            ))}
          </SettingsCard>

          <SettingsCard
            title="Assignment and Read Receipts"
            subtitle="Who owns a new conversation, and what a client's reading shows."
            icon={UserCircleGear}
            tone="green"
          >
            <Select
              label="Default assignee"
              value={draft.defaultAssigneeUserId ?? ''}
              onChange={(e) => set({ defaultAssigneeUserId: e.target.value || null })}
              options={[
                { value: '', label: 'Nobody: the conversation stays unassigned' },
                ...(loaded.defaultAssignee &&
                !(team.data ?? []).some((m) => m.user.id === loaded.defaultAssignee?.userId)
                  ? [{ value: loaded.defaultAssignee.userId, label: loaded.defaultAssignee.name }]
                  : []),
                ...(team.data ?? [])
                  .filter((m) => m.status === 'ACTIVE')
                  .map((m) => ({ value: m.user.id, label: m.user.name })),
              ]}
            />
            <Switch
              label="Read receipts"
              hint="Show when a client read a message. Portal and email only: texts never report it."
              checked={draft.readReceiptsEnabled}
              onChange={(v) => set({ readReceiptsEnabled: v })}
            />
          </SettingsCard>

          <SettingsCard
            title="Retention and Archive"
            subtitle="Archived conversations keep their whole history."
            icon={Archive}
          >
            <Select
              label="Quiet conversations"
              value={draft.retentionMonths === null ? '' : String(draft.retentionMonths)}
              onChange={(e) =>
                set({ retentionMonths: e.target.value ? Number(e.target.value) : null })
              }
              options={
                draft.retentionMonths !== null &&
                !RETENTION.some((r) => r.value === String(draft.retentionMonths))
                  ? [
                      ...RETENTION,
                      {
                        value: String(draft.retentionMonths),
                        label: `Archive after ${draft.retentionMonths} months of silence`,
                      },
                    ]
                  : RETENTION
              }
            />
          </SettingsCard>

          <SettingsCard
            title="Attachments"
            subtitle="What clients and staff may attach, and how large."
            icon={Paperclip}
            tone="purple"
          >
            <Input
              label="Largest file (MB, 1 to 25)"
              type="number"
              min={1}
              max={25}
              value={String(draft.attachmentMaxMb)}
              onChange={(e) =>
                set({ attachmentMaxMb: Math.min(25, Math.max(1, Number(e.target.value) || 1)) })
              }
            />
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium text-heading">Allowed file types</legend>
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
                {MESSAGE_ATTACHMENT_TYPES.map((type) => (
                  <Checkbox
                    key={type}
                    label={type.toUpperCase()}
                    checked={draft.allowedAttachmentTypes.includes(type)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      const next = MESSAGE_ATTACHMENT_TYPES.filter((t) =>
                        t === type ? on : draft.allowedAttachmentTypes.includes(t),
                      ) as MessageAttachmentType[];
                      if (next.length > 0) set({ allowedAttachmentTypes: next });
                    }}
                  />
                ))}
              </div>
            </fieldset>
          </SettingsCard>

          <SettingsCard
            title="Quiet Hours"
            subtitle={`No texts or client alerts during these hours (${loaded.timezone}).`}
            icon={Clock}
            tone="amber"
          >
            <Switch
              label="Quiet hours"
              hint="Messages wait until the quiet hours end."
              checked={quietOn}
              onChange={(v) =>
                set(
                  v
                    ? { quietHoursStart: '21:00', quietHoursEnd: '08:00' }
                    : { quietHoursStart: null, quietHoursEnd: null },
                )
              }
            />
            {quietOn ? (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="From"
                  type="time"
                  value={draft.quietHoursStart ?? ''}
                  onChange={(e) => e.target.value && set({ quietHoursStart: e.target.value })}
                />
                <Input
                  label="Until"
                  type="time"
                  value={draft.quietHoursEnd ?? ''}
                  onChange={(e) => e.target.value && set({ quietHoursEnd: e.target.value })}
                />
              </div>
            ) : null}
          </SettingsCard>

          <SettingsCard
            title="Bulk Messages"
            subtitle="Safeguards for sending to many clients at once."
            icon={UsersThree}
            tone="green"
          >
            <Input
              label="Ask to confirm above this many recipients"
              type="number"
              min={1}
              max={100000}
              value={String(draft.bulkConfirmThreshold)}
              onChange={(e) =>
                set({
                  bulkConfirmThreshold: Math.min(100_000, Math.max(1, Number(e.target.value) || 1)),
                })
              }
            />
            <Switch
              label="Only the Owner and Admins send bulk messages"
              hint="Staff can prepare one; a manager sends it."
              checked={draft.bulkRequiresManager}
              onChange={(v) => set({ bulkRequiresManager: v })}
            />
          </SettingsCard>

          <SettingsCard
            title="Consent and Unsubscribes"
            subtitle="Enforced on every email and text."
            icon={ShieldCheck}
            className="lg:col-span-2"
          >
            <p className="flex items-start gap-2 text-sm text-text">
              <CheckCircle
                aria-hidden
                weight="fill"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
              Every email and text checks the client&apos;s consent for that channel and your
              firm&apos;s unsubscribe list first, and skips anyone who has not agreed or has
              unsubscribed. A client&apos;s consent is kept on their record.
            </p>
          </SettingsCard>
        </fieldset>
      ) : null}
      {loaded?.updatedBy ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Gear aria-hidden className="size-4" /> Last changed by {loaded.updatedBy.name} on{' '}
          {new Date(loaded.updatedAt ?? '').toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          .
        </p>
      ) : null}
    </div>
  );
}

/** A labelled switch row with its line of help. */
function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={row}>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
