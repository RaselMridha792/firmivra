'use client';

import { LeadMessageRequest as LeadMessageSchema, type LeadMessageRequest } from '@firmivra/types';
import { Button, Input, Modal, Textarea } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { EmailMessageField } from './lead-email-field';
import { LEAD_PIPELINE_KEY } from './lead-shared';
import { htmlToText, MESSAGE_ERRORS, type MessageRecipient, sendSummary } from './lead-message';

export { type MessageRecipient, recipientOf } from './lead-message';

interface LeadMessageDialogProps {
  open: boolean;
  recipients: MessageRecipient[];
  channel: 'EMAIL' | 'SMS';
  onClose: () => void;
}

/**
 * Shared single-lead and bulk email/SMS composer (Octavia's Leads review, item 9): it shows who
 * the message goes to, at the saved number or address, before anything is sent, and leaves out a
 * lead with no saved phone for a text. After sending it says how many went and why the others did
 * not, and the refusal when texts are not set up for the firm, in plain words. An email is
 * formatted (item 8): fonts, sizes, images and the member's signature (lead-email-field.tsx), sent
 * as HTML with its plain form as `body`.
 */
export function LeadMessageDialog({ open, recipients, channel, onClose }: LeadMessageDialogProps) {
  const ids = recipients.map((r) => r.id);
  const { register, handleSubmit, formState, setValue } = useForm<LeadMessageRequest>({
    resolver: zodResolver(LeadMessageSchema),
    defaultValues: { ids, channel, subject: '', body: '' },
  });
  // The formatted email and its plain form, as the editor changes (never for a text).
  const setEmail = useCallback(
    (html: string) => {
      setValue('html', html);
      setValue('body', htmlToText(html));
    },
    [setValue],
  );
  const send = useApiMutation((body: LeadMessageRequest) => api.leadPipeline.message(body), {
    invalidate: LEAD_PIPELINE_KEY,
  });
  const sms = channel === 'SMS';
  const reachable = sms ? recipients.filter((r) => r.phone) : recipients;
  const title = sms ? 'Send SMS' : 'Send Email';
  const sent = send.data;
  return (
    <Modal
      open={open}
      title={title}
      subtitle={
        recipients.length === 1
          ? 'Send a message to this lead.'
          : `Send a message to ${recipients.length} selected leads.`
      }
      onClose={onClose}
      footer={
        sent ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="lead-message-form"
              disabled={send.isPending || reachable.length === 0}
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </Button>
          </>
        )
      }
    >
      <form
        id="lead-message-form"
        className="flex flex-col gap-4"
        data-testid={`lead-message-${channel.toLowerCase()}`}
        noValidate
        onSubmit={handleSubmit((body) => send.mutate({ ...body, ids }))}
      >
        <section aria-label="Recipients" className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold text-heading">
            {sms ? 'Texted at the saved number' : 'Sent to the saved address'}
          </h3>
          <ul
            className="max-h-36 overflow-y-auto rounded-lg bg-canvas px-3 py-2"
            data-testid="message-recipients"
          >
            {recipients.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-x-3">
                <span className="text-heading">{r.name}</span>
                {sms ? (
                  r.phone ? (
                    <span className="text-text">{r.phone}</span>
                  ) : (
                    <span className="text-danger">No phone number: left out</span>
                  )
                ) : (
                  <span className="break-all text-text">{r.email}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
        {sent ? (
          <p role="status" data-testid="message-result" className="text-sm text-success">
            {sendSummary(sent, recipients, channel)}
          </p>
        ) : (
          <>
            {sms ? null : <Input label="Subject" maxLength={200} {...register('subject')} />}
            {sms ? (
              <Textarea
                label="Message"
                required
                rows={5}
                maxLength={5000}
                error={formState.errors.body?.message}
                {...register('body')}
              />
            ) : (
              <EmailMessageField
                onChange={setEmail}
                error={
                  formState.errors.body?.type === 'too_small'
                    ? 'Write a message'
                    : (formState.errors.body?.message ?? formState.errors.html?.message)
                }
              />
            )}
            {reachable.length === 0 ? (
              <p className="text-sm text-muted">
                None of these leads has a saved phone number. Add one on the lead, or send an email.
              </p>
            ) : null}
          </>
        )}
        {send.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, MESSAGE_ERRORS)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
