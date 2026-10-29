'use client';

import { INVOICE_ERRORS, type ReceiptFor } from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RequireRole } from '../../../../../components/require-role';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { dayText, INV_KEY, outlined } from './inv-shared';

/**
 * IP-F12: Send Receipt, or Resend Receipt once one went, for one payment that went through (Owner
 * and Admin). Every click emails the client one receipt.
 */
export function ReceiptButton({
  invoiceId,
  payment,
  sentAt,
}: {
  invoiceId: string;
  payment: ReceiptFor;
  sentAt: string | null;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const send = async () => {
    setBusy(true);
    setProblem('');
    try {
      await api.invoices.sendReceipt(invoiceId, payment);
      await qc.invalidateQueries({ queryKey: [...INV_KEY] });
    } catch (e) {
      setProblem(errorMessage(e, INVOICE_ERRORS));
    }
    setBusy(false);
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      {sentAt ? <span className="text-xs text-muted">Receipt sent {dayText(sentAt)}</span> : null}
      <RequireRole roles={['OWNER', 'ADMIN']}>
        <button
          type="button"
          className={`${outlined} min-h-9!`}
          disabled={busy}
          onClick={() => void send()}
        >
          {busy ? 'Sending…' : sentAt ? 'Resend Receipt' : 'Send Receipt'}
        </button>
      </RequireRole>
      {problem ? (
        <span role="alert" className="text-xs text-danger">
          {problem}
        </span>
      ) : null}
    </span>
  );
}
