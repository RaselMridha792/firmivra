import type { MyMessage, MyMessageThread } from '@firmivra/types';

export const when = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** The From column and a message's sender: the firm's name, "You", or the other login's name. */
export const fromLabel = (
  m: Pick<MyMessage | MyMessageThread, 'from' | 'senderName'>,
  firmName: string,
) => (m.from === 'FIRM' ? firmName : m.from === 'ME' ? 'You' : (m.senderName ?? 'Household'));

export const textareaClass =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-focus';
