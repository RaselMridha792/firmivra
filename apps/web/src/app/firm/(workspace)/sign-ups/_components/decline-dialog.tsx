'use client';

import { type ClientSignUp, DeclineSignUpRequest } from '@firmivra/types';
import { Button, Checkbox, Modal } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { errorMessage } from '../../../../../lib/errors';
import { TextArea } from '../../../setup/_components/fields';
import { api } from '../../../../../lib/api';
import { useApiMutation } from '../../../../../lib/query';
import { SIGN_UP_ERRORS, SIGN_UPS } from './sign-up-parts';

/** What the person fills in; the version and the key come from the request and the dialog. */
const DeclineForm = DeclineSignUpRequest.pick({ reason: true, notify: true });
type DeclineForm = Pick<DeclineSignUpRequest, 'reason' | 'notify'>;

/**
 * Decline with an optional reason that only the firm sees. The applicant gets one polite email
 * unless staff untick it (Rasel's default of Oct 25).
 */
export function DeclineDialog({
  signUp,
  onClose,
  onDone,
}: {
  signUp: ClientSignUp | null;
  onClose: () => void;
  onDone: (signUp: ClientSignUp) => void;
}) {
  const queryClient = useQueryClient();
  // One key while the dialog is open: a retry after a lost answer returns the first outcome.
  const keyRef = useRef<string | null>(null);
  const decline = useApiMutation(
    async ({ id, body }: { id: string; body: Omit<DeclineSignUpRequest, 'idempotencyKey'> }) => {
      const done = await api.clientSignUps.decline(id, {
        ...body,
        idempotencyKey: (keyRef.current ??= crypto.randomUUID()),
      });
      // Answered: the next decline is a new attempt. A lost answer keeps the key for the retry.
      keyRef.current = null;
      return done;
    },
    { invalidate: SIGN_UPS },
  );
  const close = () => {
    decline.reset();
    form.reset();
    keyRef.current = null;
    onClose();
  };
  const form = useForm<DeclineForm>({
    resolver: zodResolver(DeclineForm),
    defaultValues: { reason: '', notify: true },
  });
  const submit = form.handleSubmit(({ reason, notify }) => {
    if (!signUp) return;
    const body = {
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
      notify: notify ?? true,
      version: signUp.version,
    };
    decline.mutate(
      { id: signUp.clientAccountId, body },
      {
        onSuccess: () => {
          form.reset();
          decline.reset();
          onDone(signUp);
        },
        // NOT_PENDING: someone else handled it; refetch so the row goes.
        onError: () => void queryClient.invalidateQueries({ queryKey: SIGN_UPS }),
      },
    );
  });

  return (
    <Modal open={signUp !== null} title={`Decline ${signUp?.name ?? ''}?`} onClose={close}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          They can&apos;t use your client portal. The reason stays with your firm and is never sent
          to them.
        </p>
        <TextArea
          label="Reason (optional)"
          rows={3}
          maxLength={500}
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
        <Checkbox
          label={`Email ${signUp?.name ?? 'them'} that the request was declined`}
          {...form.register('notify')}
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
