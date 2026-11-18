'use client';

import type { IntegrationEnvironment } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';

// I-UA06 (Integrations Review Two): before a connection is made or its sync settings change, one
// review of what will happen: environment, destination, objects, direction, schedule and what the
// first run really does. Back keeps every choice; Confirm sends once.

export interface SetupFacts {
  environment: IntegrationEnvironment;
  /** The provider, and its account once there is one. */
  destination: string;
  objects: string[];
  direction: string;
  schedule: string;
  /** What happens next, in true terms (a test now; the first sync on schedule or Sync Now). */
  firstRun: string;
}

const LABELS: Record<keyof SetupFacts, string> = {
  environment: 'Environment',
  destination: 'Destination',
  objects: 'Objects',
  direction: 'Direction',
  schedule: 'Schedule',
  firstRun: 'What happens next',
};

/** What a Test connection keeps apart from live work. */
const TEST_NOTE =
  'Test mode works with the provider’s test environment, kept apart from your Live connection. Firmivra Mail on a test site sends only to your firm’s own team addresses.';

export function SetupReview({
  open,
  title,
  facts,
  changed = [],
  confirmLabel,
  busy,
  onBack,
  onConfirm,
}: {
  open: boolean;
  title: string;
  facts: SetupFacts;
  /** The facts that differ from what is saved now (marked "changed"). */
  changed?: (keyof SetupFacts)[];
  confirmLabel: string;
  busy: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const value = (key: keyof SetupFacts) => {
    const v = facts[key];
    if (Array.isArray(v)) return v.length ? v.join(', ') : 'None';
    if (key === 'environment') return v === 'TEST' ? 'Test' : 'Live';
    return v;
  };
  return (
    <Modal
      open={open}
      title={title}
      subtitle="Check what will happen before it does."
      onClose={onBack}
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      <dl data-testid="setup-review" className="grid gap-3 text-sm">
        {(Object.keys(LABELS) as (keyof SetupFacts)[]).map((key) => (
          <div key={key} className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
            <dt className="font-semibold text-heading">
              {LABELS[key]}
              {changed.includes(key) ? (
                <span className="ml-1 text-xs font-medium text-action">(changed)</span>
              ) : null}
            </dt>
            <dd className="text-text">{value(key)}</dd>
          </div>
        ))}
      </dl>
      {facts.environment === 'TEST' ? (
        <p data-testid="setup-review-test" className="mt-4 rounded-control bg-subtle p-3 text-sm">
          {TEST_NOTE}
        </p>
      ) : null}
    </Modal>
  );
}
