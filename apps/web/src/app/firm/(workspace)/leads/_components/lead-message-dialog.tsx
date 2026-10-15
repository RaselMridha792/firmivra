'use client';

import { LeadMessageRequest as LeadMessageSchema, type LeadMessageRequest } from '@firmivra/types';
import { Button, Input, Modal, Textarea } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from './lead-shared';

interface LeadMessageDialogProps {
  open: boolean;
  ids: string[];
  channel: 'EMAIL' | 'SMS';
  onClose: () => void;
}

/** Shared single-lead and bulk email/SMS composer. */
export function LeadMessageDialog({ open, ids, channel, onClose }: LeadMessageDialogProps) {
  const { register, handleSubmit, formState } = useForm<LeadMessageRequest>({
    resolver: zodResolver(LeadMessageSchema),
    defaultValues: { ids, channel, subject: '', body: '' },
  });
  const send = useApiMutation((body: LeadMessageRequest) => api.leadPipeline.message(body), {
    invalidate: LEAD_PIPELINE_KEY,
  });
  const title = channel === 'EMAIL' ? 'Send Email' : 'Send SMS';
  return (
    <Modal
      open={open}
      title={title}
      subtitle={
        ids.length === 1
          ? 'Send a message to this lead.'
          : `Send a message to ${ids.length} selected leads.`
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="lead-message-form" disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Send'}
          </Button>
        </>
      }
    >
      <form
        id="lead-message-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={handleSubmit((body) => send.mutate(body, { onSuccess: onClose }))}
      >
        {channel === 'EMAIL' ? (
          <Input label="Subject" maxLength={200} {...register('subject')} />
        ) : null}
        <Textarea
          label="Message"
          required
          rows={5}
          maxLength={5000}
          error={formState.errors.body?.message}
          {...register('body')}
        />
        {send.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
