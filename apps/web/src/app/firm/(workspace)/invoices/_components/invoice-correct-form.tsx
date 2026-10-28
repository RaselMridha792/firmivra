'use client';
import { INVOICE_ERRORS, type InvoiceListItem } from '@firmivra/types';
import { Button, Input, Modal, Textarea } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { dayText } from './inv-shared';

/** The API's refusals of a correction, in the firm's words. */
const CORRECT_ERRORS: Record<string, string> = {
  ...INVOICE_ERRORS,
  NOT_CORRECTABLE:
    'Only a scheduled invoice, or an open one with something to pay, can be corrected.',
  SCHEDULE_PASSED: 'Choose a send day after today.',
  DUE_DATE_PASSED: 'Choose today or a later due date.',
  DUE_BEFORE_SEND: 'The due date cannot come before the send day.',
};

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Correct Dates (IP-F08, Octavia Oct 27): the same invoice, new dates. A scheduled invoice: its
 * send day and due date. An open one with something to pay: its due date. Once it was sent
 * (IP-F07) a reason is needed, and it is kept in the invoice's history. Amounts stay as they are.
 */
export function InvoiceCorrectForm({
  invoice,
  today,
  onClose,
  onDone,
}: {
  invoice: InvoiceListItem;
  /** The firm's calendar date. */
  today: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const scheduled = invoice.status === 'SCHEDULED';
  const sent = invoice.sentAt !== null;
  const [dueOn, setDueOn] = useState(invoice.dueOn ?? '');
  const [sendOn, setSendOn] = useState(invoice.scheduledFor ?? '');
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const correct = useApiMutation(
    (body: { dueOn?: string; scheduledFor?: string; reason?: string }) =>
      api.invoices.correct(invoice.id, body),
    { invalidate: ['invoices'] },
  );
  const changed = {
    ...(dueOn && dueOn !== invoice.dueOn ? { dueOn } : {}),
    ...(scheduled && sendOn && sendOn !== invoice.scheduledFor ? { scheduledFor: sendOn } : {}),
  };
  const submit = () => {
    const next: Record<string, string> = {};
    if (Object.keys(changed).length === 0) next['dueOn'] = 'Change a date first.';
    if (scheduled && sendOn && sendOn <= today) next['sendOn'] = 'Choose a send day after today.';
    if (dueOn && dueOn < today) next['dueOn'] = 'Choose today or a later due date.';
    if (scheduled && dueOn && sendOn && dueOn < sendOn)
      next['dueOn'] = 'The due date cannot come before the send day.';
    if (sent && !reason.trim()) next['reason'] = 'Say why the sent invoice changes.';
    setProblems(next);
    if (Object.keys(next).length > 0) return;
    correct.mutate(
      { ...changed, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          onDone(`${invoice.number} corrected.`);
          onClose();
        },
      },
    );
  };
  return (
    <Modal
      open
      title={`Correct ${invoice.number}`}
      subtitle={
        sent
          ? `Sent to the client: the change and its reason go in the invoice's history.`
          : 'The same invoice and number, with new dates. Amounts stay as they are.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={correct.isPending} onClick={submit}>
            Save Dates
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        data-testid="correct-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-sm text-muted" data-testid="correct-now">
          Now: {scheduled ? `sends ${dayText(invoice.scheduledFor)}, ` : ''}due{' '}
          {dayText(invoice.dueOn)}.
        </p>
        {scheduled ? (
          <Input
            label="Send on"
            type="date"
            min={addDays(today, 1)}
            value={sendOn}
            error={problems['sendOn']}
            onChange={(e) => setSendOn(e.target.value)}
          />
        ) : null}
        <Input
          label="Due date"
          type="date"
          min={today}
          value={dueOn}
          error={problems['dueOn']}
          onChange={(e) => setDueOn(e.target.value)}
        />
        <Textarea
          label={sent ? 'Reason' : 'Reason (optional)'}
          rows={2}
          maxLength={500}
          value={reason}
          error={problems['reason']}
          onChange={(e) => setReason(e.target.value)}
        />
        {correct.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(correct.error, CORRECT_ERRORS)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
