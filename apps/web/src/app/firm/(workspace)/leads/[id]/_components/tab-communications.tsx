'use client';

import type { LeadActivityKind } from '@firmivra/types';
import { ChatCircleText, Envelope, PhoneCall } from '@phosphor-icons/react';
import { useState } from 'react';
import { CardFrame, outlineButton } from './profile-cards';
import { ActivityTimeline, LogActivityForm } from './profile-activity';
import { useProfile } from './profile-frame';

const FILTERS: { id: string; label: string; kinds?: LeadActivityKind[] }[] = [
  { id: 'all', label: 'All' },
  { id: 'calls', label: 'Calls', kinds: ['CALL'] },
  { id: 'email', label: 'Emails', kinds: ['EMAIL_SENT'] },
  { id: 'sms', label: 'SMS', kinds: ['SMS_SENT'] },
];

/** Communications tab: every call, email and SMS of the lead, with the way to add one. */
export function CommunicationsTab() {
  const { profile, open } = useProfile();
  const [filter, setFilter] = useState('all');
  const [logging, setLogging] = useState(false);
  const current = FILTERS.find((f) => f.id === filter);
  return (
    <CardFrame
      icon={ChatCircleText}
      title="Communications"
      testId="card-communications"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setLogging(!logging)} className={outlineButton}>
            <PhoneCall aria-hidden weight="fill" className="size-4" /> Log Call or Contact
          </button>
          <button
            type="button"
            disabled={!profile}
            onClick={() => open('email')}
            className={outlineButton}
          >
            <Envelope aria-hidden weight="fill" className="size-4" /> Send Email
          </button>
          <button
            type="button"
            disabled={!profile?.phone}
            onClick={() => open('sms')}
            className={outlineButton}
          >
            <ChatCircleText aria-hidden weight="fill" className="size-4" /> Send SMS
          </button>
        </div>
      }
    >
      {logging ? <LogActivityForm onDone={() => setLogging(false)} /> : null}
      <div role="group" aria-label="Filter by channel" className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`min-h-8 rounded-pill px-4 text-sm font-medium ${filter === f.id ? 'bg-navigation text-on-action' : 'bg-table-head text-text hover:bg-folder-surface'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ActivityTimeline
        kind="communications"
        filter={current?.kinds}
        label="Communications"
        emptyText="No calls, emails or messages yet. Send the first one to start the history."
      />
    </CardFrame>
  );
}
