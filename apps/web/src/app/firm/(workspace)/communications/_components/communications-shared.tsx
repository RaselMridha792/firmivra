import type { CommunicationRow } from '@firmivra/types';
import { Badge, tileTones, type TileTone } from '@firmivra/ui';
import { ChatCircleDots, EnvelopeSimple, Megaphone, type Icon } from '@phosphor-icons/react';

/** Every query of the Communications module starts here: a change in one view refreshes the others. */
export const COMM_KEY = ['communications'] as const;

type Channel = CommunicationRow['channel'];
type Status = CommunicationRow['status'];

export const CHANNELS: {
  channel: Channel;
  label: string;
  noun: string;
  icon: Icon;
  tone: TileTone;
}[] = [
  { channel: 'EMAIL', label: 'Email', noun: 'Email', icon: EnvelopeSimple, tone: 'blue' },
  { channel: 'SMS', label: 'Text Message', noun: 'Text', icon: ChatCircleDots, tone: 'purple' },
  {
    channel: 'ANNOUNCEMENT',
    label: 'Announcement',
    noun: 'Announcement',
    icon: Megaphone,
    tone: 'amber',
  },
];
export const channelOf = (c: Channel) => CHANNELS.find((x) => x.channel === c)!;

export function ChannelTile({
  channel,
  size = 'md',
}: {
  channel: Channel;
  size?: 'sm' | 'md' | 'lg';
}) {
  const meta = channelOf(channel);
  const Glyph = meta.icon;
  const box = { sm: 'size-8', md: 'size-12', lg: 'size-16' }[size];
  const glyph = { sm: 'size-4', md: 'size-6', lg: 'size-8' }[size];
  return (
    <span
      aria-hidden
      className={`flex ${box} shrink-0 items-center justify-center rounded-xl ${tileTones[meta.tone]}`}
    >
      <Glyph weight="fill" className={glyph} />
    </span>
  );
}

const STATUS: Record<
  Status,
  { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  SENDING: { label: 'Sending', tone: 'warning' },
  PAUSED: { label: 'Paused', tone: 'warning' },
  SENT: { label: 'Sent', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};
export const statusLabel = (s: Status) => STATUS[s].label;
export function StatusPill({ status }: { status: Status }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

export const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const timeText = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const dateTimeText = (iso: string) => `${dayText(iso)}, ${timeText(iso)}`;
export const percent = (n: number | null) => (n === null ? '—' : `${n}%`);
export const plain = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '');

/** The route a communication opens: the composer, the schedule or the results. */
export const hrefOf = (r: Pick<CommunicationRow, 'id' | 'opens'>) =>
  r.opens === 'COMPOSER' ? `/communications/${r.id}/edit` : `/communications/${r.id}`;

/** The API's communication codes, in the firm's words. */
export const COMM_ERRORS: Record<string, string> = {
  CHANNEL_UNAVAILABLE: 'That channel is not connected. Fix it in Integrations.',
  SAVE_CONFLICT: 'Someone saved this after you opened it. Reload and try again.',
  NOT_EDITABLE: 'This has already been sent and cannot be changed.',
  LOCKED: 'It is about to send and can no longer be changed.',
  NOT_READY: 'The message is not ready to send. Fix the items in the checklist.',
  AUDIENCE_CHANGED: 'The audience changed since you reviewed it. Review it again.',
  CONTENT_WOULD_BE_LOST: 'Switching the type removes your formatting.',
  TEMPLATE_NOT_ALLOWED: 'That template cannot be used here.',
  TEST_SEND_REFUSED: 'The test could not be sent.',
  INVALID_CRITERIA: 'One of the filters is not valid.',
  DUPLICATE_NAME: 'This name is already used. Choose another.',
  SEGMENT_IN_USE: 'A scheduled communication uses this segment.',
  SCHEDULE_IN_PAST: 'Choose a time in the future.',
  NO_ELIGIBLE_RECIPIENTS: 'No one can receive this message.',
  STILL_SENDING: 'It is sending now. Pause it instead.',
  EXPORT_NOT_ALLOWED: 'Your role cannot export results.',
  FORBIDDEN: 'Your role cannot do this.',
};

export const gold =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-gold px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
export const outlined =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft disabled:opacity-50';
export const subtle =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
export const linkBtn =
  'inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-link';
export const fieldCls =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';
