'use client';

import { LEAD_ACTIVITY_SUMMARY_MAX } from '@firmivra/types';
import { Button, Modal, Radio, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from './lead-shared';

/**
 * Leads Review 2 (row 7): there is no calling integration yet, so Call opens the phone and this
 * dialog asks how the call went. Only Log Call writes the activity, with the outcome and an
 * optional note; Not Now logs nothing (a call that didn't happen is not in the history).
 */
export const CALL_OUTCOMES = [
  'Connected',
  'Left voicemail',
  'No answer',
  'Busy',
  'Wrong number',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** The activity's summary: "Call: No answer", then the note. */
export const callSummary = (outcome: CallOutcome, note: string) => {
  const head = `Call: ${outcome}`;
  const text = note.trim();
  return (text ? `${head}. ${text}` : head).slice(0, LEAD_ACTIVITY_SUMMARY_MAX);
};

export function CallOutcomeDialog({
  lead,
  onClose,
  onLogged,
}: {
  lead: { id: string; name: string; phone: string };
  onClose: () => void;
  onLogged?: (summary: string) => void;
}) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const log = useApiMutation(
    (summary: string) => api.leadPipeline.logActivity(lead.id, { kind: 'CALL', summary }),
    { invalidate: LEAD_PIPELINE_KEY },
  );
  const save = () => {
    setTouched(true);
    if (!outcome) return;
    const summary = callSummary(outcome, note);
    log.mutate(summary, {
      onSuccess: () => {
        onLogged?.(summary);
        onClose();
      },
    });
  };
  return (
    <Modal
      open
      title={`How did the call with ${lead.name} go?`}
      subtitle={`Called ${lead.phone}. Log the outcome, or choose Not Now if you didn't reach the call.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={log.isPending}>
            Not Now
          </Button>
          <Button onClick={save} disabled={log.isPending}>
            {log.isPending ? 'Logging…' : 'Log Call'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="call-outcome-dialog">
        <fieldset className="flex flex-col">
          <legend className="mb-1 text-sm font-semibold text-heading">Outcome *</legend>
          {CALL_OUTCOMES.map((o) => (
            <Radio
              key={o}
              name="call-outcome"
              label={o}
              checked={outcome === o}
              onChange={() => setOutcome(o)}
            />
          ))}
          {touched && !outcome ? (
            <p role="alert" className="text-sm text-danger">
              Choose how the call went.
            </p>
          ) : null}
        </fieldset>
        <Textarea
          label="Note (optional)"
          rows={3}
          maxLength={LEAD_ACTIVITY_SUMMARY_MAX - 40}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {log.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(log.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
