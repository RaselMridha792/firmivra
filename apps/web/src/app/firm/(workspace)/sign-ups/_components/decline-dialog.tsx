'use client';

import { type ClientSignUp, DeclineSignUpRequest } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { errorMessage } from '../../../../../lib/errors';
import { TextArea } from '../../../setup/_components/fields';
import { api } from '../../../../../lib/api';
import { useApiMutation } from '../../../../../lib/query';
import { SIGN_UP_ERRORS, SIGN_UPS } from './sign-up-parts';

/** Decline with an optional reason that only the firm sees; the client gets a polite email. */
export function DeclineDialog({
  signUp,
  onClose,
  onDone,
}: {
  signUp: ClientSignUp | null;
  onClose: () => void;
  onDone: (signUp: ClientSignUp) => void;
}) {
  const decline = useApiMutation(
    ({ id, body }: { id: string; body: DeclineSignUpRequest }) =>
      api.clientSignUps.decline(id, body),
    { invalidate: SIGN_UPS },
  );
  const close = () => {
    decline.reset();
    form.reset();
    onClose();
  };
  const form = useForm<DeclineSignUpRequest>({
    resolver: zodResolver(DeclineSignUpRequest),
    defaultValues: { reason: '' },
  });
  const submit = form.handleSubmit(({ reason }) => {
    if (!signUp) return;
    const body = reason?.trim() ? { reason: reason.trim() } : {};
    decline.mutate(
      { id: signUp.clientAccountId, body },
      {
        onSuccess: () => {
          form.reset();
          decline.reset();
          onDone(signUp);
        },
      },
    );
  });

  return (
    <Modal open={signUp !== null} title={`Decline ${signUp?.name ?? ''}?`} onClose={close}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          They can&apos;t use your client portal, and we let them know by email. The reason stays
          with your firm and is never sent to them.
        </p>
        <TextArea
          label="Reason (optional)"
          rows={3}
          maxLength={500}
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
        {decline.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(decline.error, SIGN_UP_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={decline.isPending}>
            Decline
          </Button>
        </div>
      </form>
    </Modal>
  );
}
