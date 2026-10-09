'use client';

import { ESIGN_ERRORS, type EsignRecipient, type EsignRequestDetail } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { awaiting } from './request-actions';

const DONE: readonly EsignRecipient['status'][] = ['SIGNED', 'APPROVED', 'REJECTED', 'DECLINED'];

/** Remind one recipient whose turn it is; correct someone outside the firm who hasn't finished. */
export function RecipientActions({ r, x }: { r: EsignRequestDetail; x: EsignRecipient }) {
  const [correcting, setCorrecting] = useState(false);
  const [sent, setSent] = useState(false);
  const remind = useApiMutation(() => api.esign.remind(r.id, { recipientId: x.id }), {
    invalidate: ['esign'],
  });
  const canRemind = r.allowedActions.includes('REMIND') && awaiting(x);
  // A client login's name and email are fixed on the client's record instead.
  const canCorrect =
    r.allowedActions.includes('CORRECT') && x.link.type === 'EXTERNAL' && !DONE.includes(x.status);
  if (!canRemind && !canCorrect) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canRemind && (
          <Button
            variant="secondary"
            aria-label={`Remind ${x.name}`}
            disabled={remind.isPending}
            onClick={() => remind.mutate(undefined, { onSuccess: () => setSent(true) })}
          >
            Remind
          </Button>
        )}
        {canCorrect && (
          <Button
            variant="ghost"
            aria-label={`Correct ${x.name}`}
            onClick={() => setCorrecting(true)}
          >
            Correct details
          </Button>
        )}
      </div>
      {sent && !remind.error && (
        <p role="status" className="text-sm text-success">
          Reminder sent to {x.name}.
        </p>
      )}
      {remind.error && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(remind.error, ESIGN_ERRORS)}
        </p>
      )}
      {correcting && <CorrectDialog r={r} x={x} onClose={() => setCorrecting(false)} />}
    </div>
  );
}

/** A wrong name, email or phone. Their old link stops working; a new one goes out on their turn. */
function CorrectDialog({
  r,
  x,
  onClose,
}: {
  r: EsignRequestDetail;
  x: EsignRecipient;
  onClose: () => void;
}) {
  const [name, setName] = useState(x.name);
  const [email, setEmail] = useState(x.email ?? '');
  const [phone, setPhone] = useState(x.phone ?? '');
  const correct = useApiMutation(
    () =>
      api.esign.correctRecipient(r.id, x.id, {
        ...(name.trim() !== x.name && { name: name.trim() }),
        ...(email.trim() !== (x.email ?? '') && { email: email.trim() }),
        ...(phone.trim() !== (x.phone ?? '') && { phone: phone.trim() || null }),
      }),
    { invalidate: ['esign'] },
  );
  const changed =
    name.trim() !== x.name || email.trim() !== (x.email ?? '') || phone.trim() !== (x.phone ?? '');
  return (
    <Modal open title={`Correct ${x.name}`} onClose={onClose}>
      <form
        className="flex w-full max-w-xl flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) correct.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <p className="text-sm text-text">
          Their old link stops working. If it is their turn, a new one goes out at once.
        </p>
        <Input
          label="Name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Mobile phone (optional)"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {correct.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(correct.error, ESIGN_ERRORS)}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!changed || correct.isPending}>
            Save and resend
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
