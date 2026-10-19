'use client';

import { Button, Card, Modal } from '@firmivra/ui';
import {
  ArrowSquareOut,
  CalendarBlank,
  ChatCircleDots,
  EnvelopeSimple,
  File,
  Lightbulb,
  Tag,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { channelLabels, type BroadcastDraft } from './broadcast-draft';

const steps = [
  { label: 'Basic Information', description: 'Set up your broadcast' },
  { label: 'Audience', description: 'Choose recipients' },
  { label: 'Message', description: 'Create your content' },
  { label: 'Review & Send', description: 'Confirm and send' },
];

/** The kit Stepper has no side-by-side labels/subtitles; this keeps the approved layout. */
export function BroadcastProgress() {
  return (
    <ol
      aria-label="Broadcast progress"
      className="grid grid-cols-2 gap-x-4 gap-y-5 lg:flex lg:gap-3 lg:px-8"
    >
      {steps.map((step, index) => (
        <li
          key={step.label}
          aria-current={index === 0 ? 'step' : undefined}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          <span
            aria-hidden="true"
            className={`flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold lg:size-11 ${index === 0 ? 'bg-action text-on-action' : 'bg-disabled text-heading'}`}
          >
            {index + 1}
          </span>
          <div className={`min-w-0 text-sm ${index === 0 ? 'text-action' : 'text-heading'}`}>
            <span className="block font-semibold">{step.label}</span>
            <span
              className={`mt-0.5 block text-xs lg:text-sm ${index === 0 ? 'text-action' : 'text-muted'}`}
            >
              {step.description}
            </span>
          </div>
          {index < steps.length - 1 ? (
            <span
              aria-hidden="true"
              className={`hidden h-px min-w-2 flex-1 lg:block ${index === 0 ? 'bg-action/40' : 'bg-border'}`}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const tips = [
  {
    title: 'Broadcast Best Practices',
    text: 'Use a clear internal name, choose the channels your recipients use, and review your audience and message before sending.',
  },
  {
    title: 'Using Templates',
    text: 'Start with a saved template for consistent messaging. Preview it first, then customize your content in the Message step.',
  },
  {
    title: 'Audience Segments',
    text: 'In the Audience step, select the group that should receive your broadcast and check the recipient count.',
  },
  {
    title: 'Tips for Higher Engagement',
    text: 'Keep your message relevant and concise, use a clear call to action, and choose a suitable time to reach your audience.',
  },
];

export function BroadcastPanels({
  draft,
  categoryLabel,
}: {
  draft: BroadcastDraft;
  categoryLabel: string;
}) {
  const [help, setHelp] = useState<(typeof tips)[number] | null>(null);
  const rows: { label: string; value: string; icon: Icon }[] = [
    { label: 'Broadcast Name', value: draft.name.trim() || '—', icon: File },
    {
      label: 'Channel(s)',
      value: draft.channels.map((channel) => channelLabels[channel]).join(', ') || '—',
      icon: EnvelopeSimple,
    },
    { label: 'Category', value: categoryLabel || '—', icon: Tag },
    { label: 'Audience', value: '0 recipients', icon: Users },
    { label: 'Message', value: '—', icon: ChatCircleDots },
    { label: 'Schedule', value: 'Send immediately', icon: CalendarBlank },
  ];

  return (
    <aside aria-label="Broadcast summary and help" className="flex min-w-0 flex-col gap-4">
      <Card className="p-5! shadow-none!" data-testid="broadcast-summary">
        <h2 className="font-display text-2xl font-bold text-heading">Broadcast Summary</h2>
        <p className="mt-1 text-sm text-muted">
          This summary will update as you complete each step.
        </p>
        <dl className="mt-2 divide-y divide-divider">
          {rows.map(({ label, value, icon: Glyph }) => (
            <div key={label} className="flex min-h-15 items-center gap-4 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info-soft text-action">
                <Glyph aria-hidden weight="fill" className="size-5" />
              </span>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-heading">{label}</dt>
                <dd className="mt-0.5 wrap-anywhere text-sm text-muted">{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="p-5! shadow-none!">
        <div className="flex items-start gap-2">
          <Lightbulb aria-hidden weight="fill" className="size-6 shrink-0 text-action" />
          <div>
            <h2 className="font-display text-lg font-bold text-heading">Need Help?</h2>
            <p className="text-sm text-muted">
              Check out these resources before sending your broadcast.
            </p>
          </div>
        </div>
        <ul className="mt-2 space-y-2">
          {tips.map((tip) => (
            <li key={tip.title}>
              <Button
                variant="ghost"
                className="min-h-6! justify-start! p-0! text-left"
                onClick={() => setHelp(tip)}
              >
                <ArrowSquareOut aria-hidden weight="fill" className="size-4 shrink-0" />
                {tip.title}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Modal
        open={help !== null}
        title={help?.title ?? 'Broadcast tips'}
        onClose={() => setHelp(null)}
      >
        <p className="text-sm text-muted">{help?.text}</p>
      </Modal>
    </aside>
  );
}
