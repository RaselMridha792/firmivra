'use client';

import { ESIGN_ERRORS, type EsignRecipient, type EsignRequestDetail } from '@firmivra/types';
import { Button, Input, Modal, Toast } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';

type Dialog = 'void' | 'replace' | null;

/** Every Firm Sign query: a change shows in the counters, lists and this page. */
const ESIGN = ['esign'];

/** Whose turn it is, and reachable: an in-person signer signs on the firm's device instead. */
export const awaiting = (x: EsignRecipient) =>
  x.kind !== 'CC' &&
  x.delivery !== 'IN_PERSON' &&
  ['SENT', 'DELIVERED', 'VIEWED'].includes(x.status);

/** The request's own buttons, each shown only when `allowedActions` has it. */
export function RequestActions({ r }: { r: EsignRequestDetail }) {
  const can = (a: EsignRequestDetail['allowedActions'][number]) => r.allowedActions.includes(a);
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [done, setDone] = useState<string | null>(null);
  const remind = useApiMutation(() => api.esign.remind(r.id), { invalidate: ESIGN });
  const resend = useApiMutation(() => api.esign.resendCopy(r.id), { invalidate: ESIGN });
  const failed = remind.error ?? resend.error;
  const close = () => setDialog(null);
  /** One outcome on screen at a time: a new click clears the last one. */
  const start = () => {
    setDone(null);
    remind.reset();
    resend.reset();
  };
  const shown = {
    remind: can('REMIND') && r.recipients.some(awaiting),
    resend: can('RESEND_COPY'),
    replace: can('REPLACE'),
    void: can('VOID'),
  };
  if (!Object.values(shown).some(Boolean)) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {shown.remind && (
          <Button
            variant="secondary"
            disabled={remind.isPending}
            onClick={() => {
              start();
              remind.mutate(undefined, { onSuccess: () => setDone('Reminder sent.') });
            }}
          >
            Remind now
          </Button>
        )}
        {shown.resend && (
          <Button
            variant="secondary"
            disabled={resend.isPending}
            onClick={() => {
              start();
              resend.mutate(undefined, {
                onSuccess: () => setDone('A link to the signed copy went to each signer.'),
              });
            }}
          >
            Resend signed copy
          </Button>
        )}
        {shown.replace && (
          <Button variant="secondary" onClick={() => setDialog('replace')}>
            Correct and resend
          </Button>
        )}
        {shown.void && (
          <Button variant="ghost" onClick={() => setDialog('void')}>
            Void
          </Button>
        )}
      </div>
      {done && <Toast message={done} onDismiss={() => setDone(null)} />}
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(failed, ESIGN_ERRORS)}
        </p>
      )}
      {/* Each dialog mounts when it opens, so it starts empty every time. */}
      {dialog === 'void' && (
        <ReasonDialog
          title="Void this request"
          text="Nobody can sign it any more, and every signer is told. The history stays."
          confirm="Void request"
          onClose={close}
          run={(reason) => api.esign.void(r.id, { reason })}
          onDone={close}
        />
      )}
      {dialog === 'replace' && (
        <ReasonDialog
          title="Correct and resend"
          text="This voids the request and makes a new draft copied from it, linked to this one. Fix the draft, then send it."
          confirm="Void and make a new draft"
          onClose={close}
          run={(reason) => api.esign.replace(r.id, { reason })}
          onDone={(next) => router.push(`/firm-sign/requests/${next.id}`)}
        />
      )}
    </div>
  );
}

/** Void and replace: a reason is required and kept on the timeline. */
function ReasonDialog({
  title,
  text,
  confirm,
  onClose,
  run,
  onDone,
}: {
  title: string;
  text: string;
  confirm: string;
  onClose: () => void;
  run: (reason: string) => Promise<EsignRequestDetail>;
  onDone: (r: EsignRequestDetail) => void;
}) {
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const queryClient = useQueryClient();
  // The answer is the request as it now is: shown at once, while the lists refresh behind it.
  const action = useApiMutation(run);
  const finish = (next: EsignRequestDetail) => {
    queryClient.setQueryData(['esign', 'requests', next.id], next);
    void queryClient.invalidateQueries({ queryKey: ESIGN });
    onDone(next);
  };
  // Closing mid-request would drop what happens next (opening the new draft).
  // Not while it runs; stopping Escape's cancel event keeps the dialog open.
  const leave = (event?: { preventDefault?: () => void }) => {
    if (action.isPending) event?.preventDefault?.();
    else onClose();
  };
  return (
    <Modal open title={title} onClose={leave}>
      <form
        className="flex w-full max-w-xl flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const value = reason.trim();
          setMissing(!value);
          if (value) action.mutate(value, { onSuccess: finish });
        }}
      >
        <p className="text-sm text-text">{text}</p>
        <Input
          label="Reason"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={missing ? 'Give a reason.' : undefined}
        />
        {action.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(action.error, ESIGN_ERRORS)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={action.isPending}>
            {confirm}
          </Button>
          <Button variant="ghost" disabled={action.isPending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
