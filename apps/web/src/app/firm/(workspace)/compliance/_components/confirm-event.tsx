'use client';

import type { PermissionModule } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { SealCheck } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { shouldRetry, useApiMutation } from '../../../../../lib/query';
import {
  AUTOMATIONS_KEY,
  AUTOMATION_ERRORS,
} from '../../automations/_components/automations-shared';
import { confirmAccess } from './confirm-access';

// R55's Manual Event Confirmation (AU-F29 to F33, #1264) on the record's own page. A member the
// API allows (an Owner or Admin, or a member with the Automations area and the record's module
// manage right) records that the authority confirmed the filing, once per occurrence. It records
// the fact only: it never files, submits, charges or pays, and never changes the record. Shown
// while the firm has the switch on; a confirmation already made shows to everyone who may see it.

export function ConfirmEventButton({
  event,
  module,
  recordId,
  occurrence,
  what,
}: {
  event: 'payroll.filing_confirmed' | 'deadline.filing_confirmed';
  /** The record's module: who may confirm follows its manage right, as on the API. */
  module: PermissionModule;
  recordId: string;
  /** The occurrence: the pay period's end or the deadline's due date (YYYY-MM-DD). */
  occurrence: string;
  /** "this payroll's filing": what the authority confirmed. */
  what: string;
}) {
  const { role } = useFirm();
  const { sees, may } = confirmAccess(role, module);
  const settings = useQuery({
    queryKey: [...AUTOMATIONS_KEY, 'settings'],
    queryFn: () => api.automations.settings(),
    enabled: may,
    retry: shouldRetry,
  });
  const list = useQuery({
    queryKey: [...AUTOMATIONS_KEY, 'confirmations', recordId],
    queryFn: () => api.automations.confirmations({ recordId }),
    enabled: sees,
    retry: shouldRetry,
  });
  const done = (list.data?.items ?? []).find(
    (c) => c.event === event && c.occurrence === occurrence,
  );
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const confirm = useApiMutation(
    () =>
      api.automations.confirmEvent({
        event,
        recordId,
        occurrence,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    { invalidate: [...AUTOMATIONS_KEY] },
  );

  if (done) {
    return (
      <p
        className="inline-flex items-center gap-1.5 text-sm font-medium text-success"
        data-testid="filing-confirmed"
      >
        <SealCheck aria-hidden weight="fill" className="size-4" />
        Filing confirmed {new Date(done.confirmedAt).toLocaleDateString('en-US')} by{' '}
        {done.confirmedBy.name}
        {done.reference ? ` (${done.reference})` : ''}
      </p>
    );
  }
  if (!may || !settings.data?.manualConfirmationEnabled) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="confirm-filing">
        <SealCheck aria-hidden weight="bold" className="size-4" /> Confirm Filing
      </Button>
      {open ? (
        <Modal
          open
          title="Confirm Filing"
          subtitle={`For ${occurrence}`}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={confirm.isPending}
                onClick={() => confirm.mutate(undefined, { onSuccess: () => setOpen(false) })}
              >
                {confirm.isPending ? 'Confirming…' : 'Confirm'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3" data-testid="confirm-filing-dialog">
            <p className="text-sm text-text">
              This records that the authority confirmed {what}, once for {occurrence}; it can&apos;t
              be changed afterwards. It never files, submits, charges or pays anything, and it
              doesn&apos;t change this record. Automations waiting for it then run.
            </p>
            <div>
              <Input
                label="Reference"
                value={reference}
                maxLength={200}
                onChange={(e) => setReference(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted">
                An acknowledgment or confirmation number; never a password.
              </p>
            </div>
            <Input
              label="Note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
            {confirm.error ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(confirm.error, AUTOMATION_ERRORS)}
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
