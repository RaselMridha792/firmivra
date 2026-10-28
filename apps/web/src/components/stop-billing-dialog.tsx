'use client';

import { Button, Checkbox, Input, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useApiQuery } from '../lib/query';
import { useFirm } from './firm-context';

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** Owners and Admins stop billing (the API checks too). */
export const canStopBilling = (role: string | undefined) => role === 'OWNER' || role === 'ADMIN';

/**
 * Stop Future Billing (Octavia's SH10), its own control apart from Pause: the date billing stops
 * (the next billing date unless another is chosen), a confirmation, and the audit the API writes.
 * Pausing a service never stops its billing, and this never pauses the service. Invoices already
 * made are not changed, and nothing is charged or refunded here.
 */
export function StopBillingDialog({
  engagementId,
  clientName,
  service,
  onClose,
  onDone,
}: {
  engagementId: string;
  clientName: string;
  /** "Payroll", "Bookkeeping". */
  service: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const qc = useQueryClient();
  const { role } = useFirm();
  const allowed = canStopBilling(role);
  const engagement = useApiQuery(['engagement', engagementId], () =>
    api.engagements.get(engagementId),
  );
  const e = engagement.data;
  const [date, setDate] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const stopsOn = date ?? e?.nextBillingOn ?? '';
  const today = new Date().toISOString().slice(0, 10);
  const stopped = e?.stopFutureBilling ?? false;
  const run = async (stop: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await api.engagements.stopBilling(engagementId, {
        stop,
        ...(stop && stopsOn ? { stopsOn } : {}),
      });
      qc.setQueryData(['engagement', engagementId], next);
      await qc.invalidateQueries();
      onDone(
        stop
          ? `${service} billing for ${clientName} stops on ${day(next.billingStopsOn!)}.`
          : `${service} billing for ${clientName} continues.`,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Stop Future Billing"
      subtitle={`${clientName} · ${service}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {e && allowed && e.recurring ? (
            stopped ? (
              <Button disabled={busy} onClick={() => void run(false)}>
                Resume Billing
              </Button>
            ) : (
              <Button
                disabled={busy || !confirmed || !stopsOn || stopsOn < today}
                onClick={() => void run(true)}
              >
                Stop Future Billing
              </Button>
            )
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm" data-testid="stop-billing">
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger">
            {error}
          </p>
        ) : null}
        {engagement.isPending ? (
          <p className="text-muted">Loading…</p>
        ) : engagement.isError || !e ? (
          <p className="text-muted">This service could not be loaded. Try again in a moment.</p>
        ) : !e.recurring ? (
          <p className="text-text">
            This service is billed once, so there is no future billing to stop.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-control bg-canvas px-4 py-3">
              <dt className="font-semibold text-heading">Next billing date</dt>
              <dd className="text-text">{e.nextBillingOn ? day(e.nextBillingOn) : 'Not set'}</dd>
              <dt className="font-semibold text-heading">Billing</dt>
              <dd className="text-text">
                {stopped && e.billingStopsOn ? `Stops on ${day(e.billingStopsOn)}` : 'Continues'}
              </dd>
            </dl>
            {!allowed ? (
              <p className="text-muted">Only an Owner or Admin can stop or resume billing.</p>
            ) : stopped ? (
              <p className="text-text">Resume Billing clears the stop date.</p>
            ) : (
              <>
                <Input
                  label="Billing stops on"
                  type="date"
                  min={today}
                  value={stopsOn}
                  onChange={(ev) => setDate(ev.target.value)}
                />
                <Checkbox
                  label={`I confirm ${service.toLowerCase()} billing for ${clientName} stops on this date.`}
                  checked={confirmed}
                  onChange={(ev) => setConfirmed(ev.target.checked)}
                />
              </>
            )}
            <p className="text-xs text-muted">
              This does not pause the service, and pausing does not stop billing. Invoices already
              made are not changed; nothing is charged or refunded here.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
