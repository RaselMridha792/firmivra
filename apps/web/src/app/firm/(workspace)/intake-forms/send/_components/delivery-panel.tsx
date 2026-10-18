'use client';

import { EnvelopeSimple, Graph, type Icon, Phone } from '@phosphor-icons/react';
import type { FormDeliveryChannel } from '@firmivra/types';
import { tileTones, type TileTone } from '@firmivra/ui';
import { useId } from 'react';
import { FieldError, Panel } from './panel';
import { CHANNEL_LABELS, channelState, type Recipient } from './send-model';

const OPTIONS: { channel: FormDeliveryChannel; icon: Icon; tone: TileTone }[] = [
  { channel: 'EMAIL', icon: EnvelopeSimple, tone: 'blue' },
  { channel: 'SMS', icon: Phone, tone: 'navy' },
  { channel: 'PORTAL', icon: Graph, tone: 'navy' },
];

/**
 * Step 3: one route, as three option cards. A route the recipient can't receive (no email, no
 * mobile number, no portal login) stays visible, greyed, with the reason in place of the address.
 */
export function DeliveryPanel({
  recipient,
  channel,
  onChannel,
  error,
}: {
  recipient: Recipient | undefined;
  channel: FormDeliveryChannel;
  onChannel: (channel: FormDeliveryChannel) => void;
  error: string | undefined;
}) {
  const groupNameId = useId();
  const errorId = useId();
  return (
    <Panel
      step={3}
      title="Delivery Method"
      subtitle="Select how you want to send the form."
      testId="send-delivery"
    >
      <fieldset className="min-w-0" aria-describedby={error ? errorId : undefined}>
        <legend className="sr-only">Delivery method</legend>
        <div className="grid grid-cols-3 gap-2">
          {OPTIONS.map(({ channel: option, icon: Glyph, tone }) => {
            const state = channelState(recipient, option);
            const on = channel === option;
            return (
              <label
                key={option}
                className={`relative flex min-w-0 flex-col gap-2 rounded-lg border bg-surface p-3 ${on ? 'border-action ring-1 ring-action' : 'border-divider'} ${state.available ? 'cursor-pointer hover:bg-canvas' : 'cursor-not-allowed opacity-60'}`}
              >
                <input
                  type="radio"
                  name={groupNameId}
                  value={option}
                  checked={on}
                  disabled={!state.available}
                  onChange={() => onChannel(option)}
                  className="absolute top-3 right-3 size-5 accent-action"
                />
                <span
                  className={`flex size-10 items-center justify-center rounded-lg ${tileTones[tone]}`}
                >
                  <Glyph aria-hidden weight="fill" className="size-6" />
                </span>
                <span className="text-sm font-bold text-heading">{CHANNEL_LABELS[option]}</span>
                <span className="text-xs wrap-break-word text-muted">{state.detail}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <FieldError id={errorId}>{error}</FieldError>
    </Panel>
  );
}
