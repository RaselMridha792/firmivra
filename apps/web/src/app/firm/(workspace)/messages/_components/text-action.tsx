'use client';

import type { OutboundExclusion } from '@firmivra/types';
import { DeviceMobile } from '@phosphor-icons/react';
import { api } from '../../../../../lib/api';
import { errorCode } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';

// MSG-F23 (Octavia's Oct 27 Messages review, MSG-053): the panel's Text quick action, only where
// texts can go. New Message's own check decides (the firm's texts on, a mobile number, the
// person's consent, a role that may send); otherwise it stays, switched off, with the reason.

const WHY: Partial<Record<OutboundExclusion, string>> = {
  NO_CONTACT: 'There is no mobile number to text.',
  NO_CONSENT: 'They have not agreed to get texts.',
  SUPPRESSED: 'Texts to them are stopped (an opt-out or a failed number).',
  PROVIDER_UNAVAILABLE: 'Texts are turned off or not set up for your firm.',
  NOT_PERMITTED: 'You do not work with this person.',
};

const tile = 'flex flex-col items-center gap-1 rounded-lg border border-divider p-2';

export function TextAction({
  person,
  onText,
}: {
  /** Whom the text would go to. */
  person: { kind: 'CLIENT' | 'LEAD'; id: string };
  /** Turns the reply to a text (a lead's conversation). */
  onText?: () => void;
}) {
  // A client is never texted, so only a lead is checked.
  const check = useApiQuery(['messages', 'text-action', person.kind, person.id], async () =>
    person.kind === 'LEAD'
      ? api.messages.outbound.check({ channel: 'SMS', clientIds: [], leadIds: [person.id] })
      : null,
  );
  const off = (() => {
    // Texts go to leads only: a client hears from the firm through the portal or email.
    if (person.kind === 'CLIENT')
      return 'Texts go to leads only. Reach this client through the portal or by email.';
    if (check.isPending) return 'Checking whether a text can go…';
    if (check.isError)
      return errorCode(check.error) === 'FORBIDDEN'
        ? 'Your role cannot send messages.'
        : 'Whether a text can go is not known right now.';
    const channel = check.data?.channels.find((c) => c.channel === 'SMS');
    if (channel?.unavailable) return WHY.PROVIDER_UNAVAILABLE!;
    const r = check.data?.recipients[0];
    if (!r?.canReceive) return (r?.reason && WHY[r.reason]) ?? 'A text cannot go to them.';
    return onText ? null : 'Write a text from their conversation.';
  })();
  return off ? (
    <span className={`${tile} opacity-50`} title={off} data-testid="contact-text">
      <DeviceMobile aria-hidden weight="fill" className="size-5 text-action" /> Text
      <span className="sr-only">{off}</span>
    </span>
  ) : (
    <button
      type="button"
      onClick={onText}
      className={`${tile} hover:bg-canvas`}
      data-testid="contact-text"
    >
      <DeviceMobile aria-hidden weight="fill" className="size-5 text-action" /> Text
    </button>
  );
}
