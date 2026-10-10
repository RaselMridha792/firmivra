'use client';

import { RequestNameChangeRequest } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';

export const PROFILE_ERRORS = {
  NAME_CHANGE_PENDING: 'Your name change request is already with our team.',
  FORBIDDEN: 'Only the main account holder can change the profile.',
};

/** "Request Name Change": the firm's staff get a task; the name changes once they update it. */
export function NameChangeDialog({
  slug,
  open,
  onClose,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
}) {
  const form = useForm<RequestNameChangeRequest>({
    resolver: zodResolver(RequestNameChangeRequest),
    defaultValues: { newName: '', reason: '' },
  });
  const send = useApiMutation((body: RequestNameChangeRequest) =>
    api.myProfile(slug).requestNameChange(body),
  );
  const close = () => {
    form.reset();
    send.reset();
    onClose();
  };
  return (
    <Modal open={open} title="Request Name Change" onClose={close}>
      {send.isSuccess ? (
        <div className="grid max-w-modal gap-4">
          <p role="status" className="text-text">
            Thank you. Our team will review your request and update your name.
          </p>
          <Button className="justify-self-start" onClick={close}>
            Close
          </Button>
        </div>
      ) : (
        <form
          noValidate
          className="grid max-w-modal gap-4"
          onSubmit={form.handleSubmit((body) => send.mutate(body))}
        >
          <Input
            label="New full name"
            error={form.formState.errors.newName?.message}
            {...form.register('newName')}
          />
          <Input label="Reason (optional)" {...form.register('reason')} />
          {send.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(send.error, PROFILE_ERRORS)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={send.isPending}>
              Send Request
            </Button>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
