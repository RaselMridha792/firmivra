'use client';

import type { FirmRecord } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';

const ERRORS: Record<string, string> = {
  FIRM_CANNOT_ANSWER: 'Only an active firm with an active owner can be asked for information.',
  SUPPORT_UNAVAILABLE: 'Support has no active category or priority to file this under.',
  FORBIDDEN: 'You are not on the Support team, so you cannot open a ticket.',
};

const fieldClass =
  'w-full rounded-control border border-border bg-surface p-3 text-sm text-text aria-[invalid=true]:border-danger';

/** Today in US Eastern time (YYYY-MM-DD): the earliest answer-by day the API takes. */
const easternToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

/**
 * SA-FRM-F06, Y09: Actions > Request Information. Subject, message and an optional answer-by day,
 * sent to the firm's owner as a Support ticket (Waiting on Customer) and an email; the owner
 * answers in their Settings > Requests from Firmivra. One request id per opening, so a double
 * click or a retry files one ticket.
 */
export function RequestInfoDialog({
  firm,
  open,
  onClose,
  onSent,
}: {
  firm: FirmRecord;
  open: boolean;
  onClose: () => void;
  onSent: (record: FirmRecord) => void;
}) {
  const id = useId();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [replyBy, setReplyBy] = useState('');
  const [missing, setMissing] = useState<{ subject?: boolean; message?: boolean }>({});
  const requestId = useRef<string | null>(null);
  const send = useApiMutation(
    (body: { subject: string; message: string; replyBy?: string }) =>
      api.firmApplications.requestFirmInformation(firm.id, {
        requestId: (requestId.current ??= crypto.randomUUID()),
        ...body,
      }),
    { invalidate: ['admin-firms'] },
  );

  function close() {
    setSubject('');
    setMessage('');
    setReplyBy('');
    setMissing({});
    requestId.current = null;
    send.reset();
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (send.isPending) return;
    const s = subject.trim();
    const m = message.trim();
    if (!s || !m) {
      setMissing({ subject: !s, message: !m });
      return;
    }
    send.mutate(
      { subject: s, message: m, ...(replyBy ? { replyBy } : {}) },
      {
        onSuccess: (record) => {
          onSent(record);
          close();
        },
      },
    );
  }

  const owner = firm.owner?.name ?? 'the firm owner';
  return (
    <Modal open={open} title="Request Information" onClose={close}>
      {open ? (
        <form onSubmit={submit} noValidate className="flex max-w-lg flex-col gap-4">
          <p className="text-sm text-text">
            {owner} gets an email and answers in their firm&apos;s Settings &gt; Requests from
            Firmivra, with files if needed. Their answer and files come back to the Support ticket
            this opens.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-subject`} className="text-sm font-medium text-heading">
              Subject (required)
            </label>
            <input
              id={`${id}-subject`}
              value={subject}
              maxLength={120}
              onChange={(event) => {
                setSubject(event.target.value);
                setMissing((m) => ({ ...m, subject: false }));
              }}
              aria-invalid={missing.subject || undefined}
              aria-describedby={missing.subject ? `${id}-subject-error` : undefined}
              className={fieldClass}
            />
            {missing.subject ? (
              <p id={`${id}-subject-error`} className="text-xs text-danger">
                Enter a subject.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-message`} className="text-sm font-medium text-heading">
              Message (required)
            </label>
            <textarea
              id={`${id}-message`}
              value={message}
              rows={5}
              maxLength={4000}
              onChange={(event) => {
                setMessage(event.target.value);
                setMissing((m) => ({ ...m, message: false }));
              }}
              aria-invalid={missing.message || undefined}
              aria-describedby={missing.message ? `${id}-message-error` : undefined}
              className={`${fieldClass} resize-y`}
            />
            {missing.message ? (
              <p id={`${id}-message-error`} className="text-xs text-danger">
                Write what you need from the firm.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-reply-by`} className="text-sm font-medium text-heading">
              Answer by (optional)
            </label>
            <input
              id={`${id}-reply-by`}
              type="date"
              min={easternToday()}
              value={replyBy}
              onChange={(event) => setReplyBy(event.target.value)}
              className={`${fieldClass} sm:w-56`}
            />
          </div>
          {send.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(send.error, ERRORS)}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Send Request'}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
