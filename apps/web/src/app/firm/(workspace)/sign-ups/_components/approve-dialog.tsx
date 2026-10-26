'use client';

import type { ApproveSignUpResponse, ClientSignUp } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { CLIENTS } from '../../clients/_components/client-parts';
import { SIGN_UP_ERRORS, SIGN_UPS } from './sign-up-parts';

/**
 * Approve's confirmation (Octavia's spec, section 3): the applicant, the firm and what happens,
 * before anything changes. Cancel and Escape change nothing.
 */
export function ApproveDialog({
  signUp,
  onClose,
  onDone,
}: {
  signUp: ClientSignUp | null;
  onClose: () => void;
  onDone: (done: ApproveSignUpResponse) => void;
}) {
  const { firm } = useFirm();
  const queryClient = useQueryClient();
  const approve = useApiMutation((id: string) => api.clientSignUps.approve(id, {}), {
    invalidate: SIGN_UPS,
  });
  const close = () => {
    approve.reset();
    onClose();
  };
  return (
    <Modal open={signUp !== null} title={`Approve ${signUp?.name ?? ''}?`} onClose={close}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          {firm.name} gets a new client record for {signUp?.name} ({signUp?.email}), and their
          client portal opens. We email them that it&apos;s ready. Approving enrolls them in no
          service and sends no invoice.
        </p>
        {approve.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(approve.error, SIGN_UP_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={approve.isPending || !signUp}
            onClick={() =>
              signUp &&
              approve.mutate(signUp.clientAccountId, {
                onSuccess: (done) => {
                  void queryClient.invalidateQueries({ queryKey: CLIENTS });
                  approve.reset();
                  onDone(done);
                },
                // Someone else decided, or a match appeared: reload what the server says now.
                onError: () => void queryClient.invalidateQueries({ queryKey: SIGN_UPS }),
              })
            }
          >
            {approve.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
