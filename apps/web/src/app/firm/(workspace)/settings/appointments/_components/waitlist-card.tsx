'use client';

import type { WaitlistMode, WaitlistSettings } from '@firmivra/types';
import { Button, Radio, Toggle } from '@firmivra/ui';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { SettingsCard } from '../../_components/settings-parts';

/** The card's read, under the firm's waitlist key (the Appointments screen's requests too). */
const WAITLIST = ['appointment-waitlist'] as const;
const SETTINGS = [...WAITLIST, 'settings'] as const;

const MODES: { value: WaitlistMode; label: string; help: string }[] = [
  {
    value: 'AUTO_CONFIRM',
    label: 'Automatic confirmation',
    help: 'When a client takes an offered earlier time, the appointment moves at once, after the time is checked again.',
  },
  {
    value: 'STAFF_APPROVAL',
    label: 'Staff approval required',
    help: 'A client’s request waits in Appointments > Waitlist Requests; the appointment keeps its time until staff approve.',
  },
];

/**
 * Appointments A3 (R55): the waitlist for an earlier time. On or off, and one of two exclusive
 * modes. With it on, clients join from their portal; when an earlier time opens it is offered to
 * one client at a time by Portal and Email, and the original appointment stands until the move is
 * confirmed. Owner and Admin (the page's own rule; the API answers Staff 403).
 */
export function WaitlistCard() {
  const settings = useApiQuery(SETTINGS, () => api.appointmentWaitlist.settings());
  return (
    <SettingsCard
      title="Waitlist"
      subtitle="Clients can wait for an earlier time. When one opens, it is offered to one client at a time by Portal and Email."
      icon={ClockCounterClockwise}
      testId="waitlist-card"
    >
      <PageState query={settings}>{(saved) => <WaitlistForm saved={saved} />}</PageState>
    </SettingsCard>
  );
}

function WaitlistForm({ saved }: { saved: WaitlistSettings }) {
  const [enabled, setEnabled] = useState(saved.enabled);
  const [mode, setMode] = useState<WaitlistMode>(saved.mode);
  const [note, setNote] = useState('');
  const save = useApiMutation(
    (body: WaitlistSettings) => api.appointmentWaitlist.saveSettings(body),
    { invalidate: WAITLIST },
  );
  const changed = enabled !== saved.enabled || mode !== saved.mode;
  return (
    <form
      noValidate
      aria-label="Waitlist settings"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setNote('');
        save.mutate(
          { enabled, mode },
          {
            onSuccess: (after) =>
              setNote(
                after.enabled
                  ? 'Saved. Clients can join the waitlist from their portal.'
                  : 'Saved. The waitlist is off: no new offers, and clients cannot join.',
              ),
          },
        );
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-heading">Offer earlier openings</span>
          <span className="text-xs text-muted">
            The original appointment stays as it is until the move is confirmed.
          </span>
        </div>
        <Toggle label="Offer earlier openings" checked={enabled} onChange={setEnabled} />
      </div>
      <fieldset className="flex flex-col gap-2" disabled={!enabled}>
        <legend className="mb-1 text-sm font-semibold text-heading">
          When a client takes an earlier time
        </legend>
        {MODES.map((m) => (
          <div key={m.value} className="flex flex-col">
            <Radio
              name="waitlist-mode"
              label={m.label}
              value={m.value}
              checked={mode === m.value}
              onChange={() => setMode(m.value)}
            />
            <span className="-mt-2 pl-8 text-xs text-muted">{m.help}</span>
          </div>
        ))}
      </fieldset>
      {save.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error, {
            FORBIDDEN: 'Only owners and admins can change appointment settings.',
          })}
        </p>
      ) : note ? (
        <p role="status" className="text-sm text-success" data-testid="waitlist-saved">
          {note}
        </p>
      ) : null}
      <Button type="submit" className="self-start" disabled={!changed || save.isPending}>
        {save.isPending ? 'Saving…' : 'Save Waitlist'}
      </Button>
    </form>
  );
}
