'use client';

import {
  Broadcast,
  ChatCircle,
  DeviceMobile,
  EnvelopeSimple,
  Info,
  PaperPlaneTilt,
  Paperclip,
  UploadSimple,
  type Icon,
} from '@phosphor-icons/react';
import { Button, checkFiles, FilterChip, Input, Modal, RichTextEditor, Select } from '@firmivra/ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  adminTeam,
  ATTACHMENT_RULES,
  checkMessage,
  MESSAGE_CHANNELS,
  MESSAGE_LIMIT,
  MESSAGE_PRIORITIES,
  type MessageAudience,
  type MessageChannel,
  type MessageFieldErrors,
  type MessagePriority,
  type MessageTarget,
  type SendMessageResult,
  type SendTeamMessage,
  TEAM_ERROR_MESSAGES,
} from '../../../../../mocks/admin-team';
import { RecipientPicker } from './recipient-picker';
import { members as countText, TEAM_KEY } from './team-parts';

/**
 * `channels`: Team Communication's full composer (team-communication-message-modal.jpg), with the
 * Delivery Method step. `internal`: the quick message from a member or the selection
 * (team-messaging-modal-mockup.jpg), sent in-app and optionally by email.
 */
export type MessageVariant = 'channels' | 'internal';

export interface MessagePreset {
  audience: MessageAudience;
  targets: MessageTarget[];
}

const CHANNEL_ICONS: Record<MessageChannel, Icon> = {
  IN_APP: ChatCircle,
  EMAIL: EnvelopeSimple,
  SMS: DeviceMobile,
};
const ALL_CHANNELS: MessageChannel[] = ['IN_APP', 'EMAIL', 'SMS'];

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action"
      >
        {n}
      </span>
      <div className="min-w-0 pt-0.5">
        <h3 className="text-lg font-bold text-heading">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** A checkbox with a bold line and a smaller description under it. */
function Option({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0"
      />
      <span className="flex flex-col">
        <span className="text-sm font-medium text-heading">{label}</span>
        <span className="text-xs text-muted">{description}</span>
      </span>
    </label>
  );
}

/** "Message sent to 9 team members. Text Message (SMS) unavailable for 2." */
export function sentSummary(result: SendMessageResult): string {
  const gaps = result.channels
    .filter((channel) => channel.unavailable > 0)
    .map(
      (channel) => `${MESSAGE_CHANNELS[channel.channel]} unavailable for ${channel.unavailable}`,
    );
  return [
    `Message sent to ${countText(result.recipients)}.`,
    ...gaps.map((gap) => `${gap}.`),
    result.announcement ? 'Saved as an announcement.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Send Message: recipients, details, channels, options and attachments (Team docx §7 to §11). */
export function MessageDialog({
  variant,
  preset,
  onClose,
  onSent,
}: {
  variant: MessageVariant;
  preset?: MessagePreset;
  onClose: () => void;
  onSent: (text: string) => void;
}) {
  const id = useId();
  const options = useApiQuery([...TEAM_KEY, 'message-options'], () => adminTeam.messageOptions());
  const [audience, setAudience] = useState<MessageAudience>(preset?.audience ?? 'COMPANY');
  const [targets, setTargets] = useState<MessageTarget[]>(preset?.targets ?? []);
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<MessagePriority>('NORMAL');
  const [body, setBody] = useState('');
  const [channels, setChannels] = useState<MessageChannel[]>(
    variant === 'internal' ? ['IN_APP', 'EMAIL'] : ['IN_APP'],
  );
  const [allowReplies, setAllowReplies] = useState(true);
  const [announcement, setAnnouncement] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<MessageFieldErrors>({});
  const picker = useRef<HTMLInputElement>(null);
  const send = useApiMutation((input: SendTeamMessage) => adminTeam.sendMessage(input), {
    invalidate: TEAM_KEY,
  });
  const canAnnounce = options.data?.canAnnounce ?? false;
  const everyChannel = ALL_CHANNELS.every((channel) => channels.includes(channel));
  const toggleChannel = (channel: MessageChannel, on: boolean) =>
    setChannels(
      on
        ? ALL_CHANNELS.filter((value) => value === channel || channels.includes(value))
        : channels.filter((value) => value !== channel),
    );

  function addFiles(list: FileList | null) {
    const picked = [...(list ?? [])];
    const { accepted, rejected } = checkFiles([...files, ...picked], ATTACHMENT_RULES);
    setFiles(accepted);
    setErrors({
      ...errors,
      attachments: rejected.length
        ? `${rejected.map((entry) => entry.file.name).join(', ')}: use PDF, Word, Excel or image files up to 10MB, 10 files at most.`
        : undefined,
    });
  }

  function submit() {
    const input: SendTeamMessage = {
      audience,
      targets: audience === 'COMPANY' ? [] : targets,
      subject,
      priority,
      body,
      channels,
      allowReplies,
      announcement,
      attachments: files.map(({ name, size, type }) => ({ name, size, type })),
    };
    const found = checkMessage(input);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    send.mutate(input, {
      onSuccess: (result) => {
        onSent(sentSummary(result));
        onClose();
      },
    });
  }

  return (
    <Modal
      open
      title="Send Message"
      subtitle={
        variant === 'channels'
          ? 'Send a direct or group message to your team by in-app chat, email, text message (SMS), or multiple channels.'
          : "Send a direct or group message to your team. This will be sent through Firmivra's internal messaging system (and optionally via email)."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={send.isPending} onClick={submit}>
            <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
            Send Message
          </Button>
        </>
      }
    >
      <div data-testid="message-dialog" className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <Step n={1} title="Choose Recipients" />
          <RecipientPicker
            options={options.data}
            audience={audience}
            onAudience={(next) => {
              setAudience(next);
              setTargets([]);
            }}
            targets={targets}
            onTargets={setTargets}
            error={errors.targets}
          />
          {options.isError ? (
            <p className="text-sm text-muted">
              Could not load the recipients right now. Check your connection and try again.
            </p>
          ) : null}
        </section>

        <section className="flex flex-col gap-3">
          <Step n={2} title="Message Details" />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Input
                label="Subject *"
                placeholder="Enter a subject..."
                maxLength={150}
                value={subject}
                error={errors.subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1 text-sm font-medium text-text">
                <span aria-hidden>Priority</span>
                <span
                  title="High and Urgent messages are flagged at the top of each recipient's inbox."
                  className="inline-flex text-action"
                >
                  <Info aria-hidden weight="fill" className="size-4" />
                  <span className="sr-only">
                    High and Urgent messages are flagged at the top of each recipient&apos;s inbox.
                  </span>
                </span>
              </span>
              <Select
                label="Priority"
                hideLabel
                value={priority}
                onChange={(event) => setPriority(event.target.value as MessagePriority)}
                options={Object.entries(MESSAGE_PRIORITIES).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </div>
          </div>
          <RichTextEditor
            label="Message"
            required
            placeholder="Type your message here..."
            maxLength={MESSAGE_LIMIT}
            value={body}
            error={errors.body}
            onChange={setBody}
          />
        </section>

        {variant === 'channels' ? (
          <section className="flex flex-col gap-3">
            <Step n={3} title="Delivery Method">
              <p className="text-sm text-muted">
                Select one or more channels to send this message. Only available channels for each
                recipient will be enabled.
              </p>
            </Step>
            <fieldset className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <legend className="sr-only">Delivery method</legend>
              {ALL_CHANNELS.map((channel) => {
                const Glyph = CHANNEL_ICONS[channel];
                return (
                  <label
                    key={channel}
                    className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-heading"
                  >
                    <input
                      type="checkbox"
                      checked={channels.includes(channel)}
                      onChange={(event) => toggleChannel(channel, event.target.checked)}
                      className="size-5"
                    />
                    <Glyph aria-hidden weight="fill" className="size-6 text-heading" />
                    {MESSAGE_CHANNELS[channel]}
                  </label>
                );
              })}
              <label className="flex min-h-11 cursor-pointer items-center gap-2 border-divider text-sm text-heading sm:border-l sm:pl-6">
                <input
                  type="checkbox"
                  checked={everyChannel}
                  onChange={(event) => setChannels(event.target.checked ? ALL_CHANNELS : [])}
                  className="size-5"
                />
                <Broadcast aria-hidden weight="fill" className="size-6 text-heading" />
                Send Through All Channels
              </label>
            </fieldset>
            {errors.channels ? <p className="text-xs text-danger">{errors.channels}</p> : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <Step n={variant === 'channels' ? 4 : 3} title="Additional Options" />
          <div className="flex flex-col gap-3 pl-1">
            {variant === 'internal' ? (
              <Option
                checked={channels.includes('EMAIL')}
                onChange={(on) => setChannels(on ? ['IN_APP', 'EMAIL'] : ['IN_APP'])}
                label="Also send via email"
                description="Everyone will receive this message in their Firmivra inbox. You can also send a copy to their email."
              />
            ) : null}
            <Option
              checked={allowReplies}
              onChange={setAllowReplies}
              label="Allow replies to this message"
              description="Recipients can reply directly to you and the conversation will be saved in the Communications area."
            />
            <Option
              checked={announcement}
              disabled={!canAnnounce}
              onChange={setAnnouncement}
              label="Save as announcement"
              description={
                canAnnounce
                  ? 'Pin this message in the Communications area for easy access.'
                  : 'Only department heads and the CEO can create announcements.'
              }
            />
          </div>
          <div className="flex flex-col gap-3 rounded-xl bg-info-soft p-4 sm:flex-row sm:items-center">
            <Paperclip aria-hidden weight="bold" className="size-7 shrink-0 text-heading" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-heading">Attach Files (Optional)</p>
              <p className="text-sm text-muted">
                Add documents, images, or other files (Max 10MB per file)
              </p>
            </div>
            <input
              ref={picker}
              id={`${id}-files`}
              type="file"
              multiple
              accept={ATTACHMENT_RULES.accept.join(',')}
              aria-label="Attach files"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = '';
              }}
            />
            <Button variant="outline" onClick={() => picker.current?.click()}>
              <UploadSimple aria-hidden weight="bold" className="size-5" />
              Choose Files
            </Button>
          </div>
          {files.length ? (
            <div aria-label="Attached files" className="flex flex-wrap gap-2">
              {files.map((file) => (
                <FilterChip
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  label={file.name}
                  onRemove={() => setFiles(files.filter((entry) => entry !== file))}
                />
              ))}
            </div>
          ) : null}
          {errors.attachments ? <p className="text-xs text-danger">{errors.attachments}</p> : null}
        </section>

        {send.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, TEAM_ERROR_MESSAGES)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
