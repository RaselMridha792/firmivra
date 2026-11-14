'use client';

import { Button, Checkbox, Input, Modal, Radio, Textarea } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useApiQuery } from '../lib/query';
import {
  billingBlocked,
  planOf,
  stateText,
  type Scope,
  type ServiceBillingState,
  type Step,
} from '../lib/service-billing';
import { useFirm } from './firm-context';
import { canStopBilling } from './stop-billing-dialog';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'service', label: 'Service only' },
  { id: 'billing', label: 'Billing only' },
  { id: 'both', label: 'Service and billing' },
];

/**
 * Service & Billing (Octavia's Review 2, cross-service; Payroll F13): pause or resume the service
 * and pause or resume billing in one place. Either or both, with each state and effective date,
 * and what will happen spelled out before confirming. A service billed once has no billing to
 * pause. Bookkeeping and Payroll pass their own pause and resume calls. Clients Review 2 (G8):
 * any service opens it from the client's Services tab; one without a pause of its own (no
 * `pauseService`) changes billing only.
 */
export function ServiceBillingDialog({
  service,
  clientName,
  engagementId,
  servicePaused,
  serviceNote,
  initialScope = 'service',
  pauseService,
  resumeService,
  onClose,
  onDone,
}: {
  /** "Bookkeeping", "Payroll". */
  service: string;
  clientName: string;
  engagementId: string;
  servicePaused: boolean;
  /** What pausing does not touch, e.g. Payroll's provider. */
  serviceNote?: string;
  initialScope?: Scope;
  /** Absent: the service has no pause of its own, so only its billing changes here. */
  pauseService?: (reason: string) => Promise<unknown>;
  resumeService?: () => Promise<unknown>;
  onClose: () => void;
  onDone: (text: string, tone: 'success' | 'error') => void;
}) {
  const qc = useQueryClient();
  const { role } = useFirm();
  const engagement = useApiQuery(['engagement', engagementId], () =>
    api.engagements.get(engagementId),
  );
  const e = engagement.data;
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const pausable = !!pauseService && !!resumeService;
  const [scope, setScope] = useState<Scope>(pausable ? initialScope : 'billing');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const state: ServiceBillingState = {
    service,
    servicePaused,
    billing: e
      ? {
          recurring: e.recurring,
          stopped: e.stopFutureBilling,
          nextBillingOn: e.nextBillingOn,
          stopsOn: e.billingStopsOn,
        }
      : null,
    canChangeBilling: canStopBilling(role),
  };
  const stopsOn = date ?? e?.nextBillingOn ?? '';
  const blocked = engagement.isPending ? null : billingBlocked(state);
  const plan = planOf(state, scope, {
    reason,
    stopsOn,
    today,
    ...(serviceNote ? { serviceNote } : {}),
  });
  const words = stateText(state);
  const pausingService = scope !== 'billing' && !servicePaused;
  const stoppingBilling = scope !== 'service' && !!e?.recurring && !e.stopFutureBilling;

  const run = async (step: Step) => {
    if (step.kind === 'pause-service') return pauseService?.(step.reason);
    if (step.kind === 'resume-service') return resumeService?.();
    const next = await api.engagements.stopBilling(
      engagementId,
      step.kind === 'stop-billing' ? { stop: true, stopsOn: step.on } : { stop: false },
    );
    qc.setQueryData(['engagement', engagementId], next);
    return next;
  };
  const apply = async () => {
    setBusy(true);
    setError(undefined);
    const done: string[] = [];
    try {
      for (const step of plan.steps) {
        await run(step);
        done.push(step.kind);
      }
      await qc.invalidateQueries();
      onDone(`${service} for ${clientName}: ${plan.effects.join(' ')}`, 'success');
    } catch (err) {
      // The service step runs first: when it went through and billing failed, say so.
      const made = done.length ? ' The service change was saved; the billing change was not.' : '';
      setError(`${errorMessage(err)}${made}`);
      await qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Service & Billing"
      subtitle={`${clientName} · ${service}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !!plan.problem || !confirmed || plan.steps.length === 0}
            onClick={() => void apply()}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm" data-testid="service-billing">
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
            {error}
          </p>
        ) : null}
        <dl
          className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-control bg-canvas px-4 py-3"
          data-testid="service-billing-state"
        >
          <dt className="font-semibold text-heading">Service</dt>
          <dd className="text-text">{words.service}</dd>
          <dt className="font-semibold text-heading">Billing</dt>
          <dd className="text-text">{engagement.isPending ? 'Loading…' : words.billing}</dd>
        </dl>
        <fieldset className="flex flex-col">
          <legend className="font-semibold text-heading">What to change</legend>
          {(pausable ? SCOPES : SCOPES.filter((s) => s.id === 'billing')).map((s) => (
            <Radio
              key={s.id}
              name="service-billing-scope"
              label={s.label}
              checked={scope === s.id}
              disabled={s.id !== 'service' && !!blocked}
              onChange={() => {
                setScope(s.id);
                setConfirmed(false);
              }}
            />
          ))}
          {blocked ? <p className="text-muted">{blocked}</p> : null}
          {pausable ? null : (
            <p className="text-muted" data-testid="service-billing-billing-only">
              {service} has no pause of its own: its billing can be paused here.
            </p>
          )}
        </fieldset>
        {pausingService ? (
          <Textarea
            label="Reason for pausing the service *"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
          />
        ) : null}
        {stoppingBilling ? (
          <Input
            label="Billing pauses from"
            type="date"
            min={today}
            value={stopsOn}
            onChange={(ev) => setDate(ev.target.value)}
          />
        ) : null}
        <section aria-label="What will happen" data-testid="service-billing-effects">
          <h3 className="font-semibold text-heading">What will happen</h3>
          {plan.problem ? (
            <p className="text-muted">{plan.problem}</p>
          ) : (
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-text">
              {plan.effects.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </section>
        <Checkbox
          label="I confirm these changes."
          checked={confirmed}
          disabled={!!plan.problem}
          onChange={(ev) => setConfirmed(ev.target.checked)}
        />
      </div>
    </Modal>
  );
}
