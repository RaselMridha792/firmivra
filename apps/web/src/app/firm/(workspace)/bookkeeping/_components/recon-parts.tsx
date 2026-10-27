'use client';

import type { BookkeepingPeriod } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { BK_ERRORS } from './bookkeeping-shared';

// Shared by the period's close and the reconciliation (BK-R01): dollars in and out of fields, a
// reason before reopening, and starting a reconciliation.

export const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, '')) * 100);
export const dollars = (c: number) => (c / 100).toFixed(2);

export function ReasonDialog({
  title,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  confirm: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              await onConfirm(reason.trim());
              onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

/**
 * Start a reconciliation (BK-R01): the account and its statement. The lines are cleared on the
 * reconciliation's own page, which opens next.
 */
export function ReconDialog({
  p,
  accountId,
  onClose,
}: {
  p: Pick<BookkeepingPeriod, 'id' | 'label' | 'periodStart' | 'periodEnd'> & {
    accountsWithoutReconciliation: { id: string; name: string }[];
  };
  accountId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const accounts = p.accountsWithoutReconciliation;
  const [account, setAccount] = useState(accountId ?? accounts[0]?.id ?? '');
  const [start, setStart] = useState(p.periodStart);
  const [end, setEnd] = useState(p.periodEnd);
  const [begin, setBegin] = useState('');
  const [ending, setEnding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Modal
      open
      title="Reconcile an Account"
      subtitle={p.label}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!account || !begin || !ending || busy}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                const r = await api.bookkeeping.createReconciliation(p.id, {
                  accountId: account,
                  statementStart: start,
                  statementEnd: end,
                  beginningBalanceCents: cents(begin),
                  endingBalanceCents: cents(ending),
                });
                router.push(`/bookkeeping/reconciliations/${r.id}`);
              } catch (e) {
                setError(errorMessage(e, BK_ERRORS));
                setBusy(false);
              }
            }}
          >
            Start Reconciling
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="recon-dialog">
        <Select
          label="Account"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          options={
            accounts.length
              ? accounts.map((a) => ({ value: a.id, label: a.name }))
              : [{ value: '', label: 'Every account is reconciled' }]
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Statement starts"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Input
            label="Statement ends"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <Input
            label="Beginning balance ($)"
            value={begin}
            onChange={(e) => setBegin(e.target.value)}
          />
          <Input
            label="Ending balance ($)"
            value={ending}
            onChange={(e) => setEnding(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted">
          Next you mark the lines that cleared on the statement; the difference must be zero to
          approve.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
