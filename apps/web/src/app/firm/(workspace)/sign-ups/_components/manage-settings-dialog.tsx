'use client';

import { ApiRequestError, type ClientSignUpSettings, type ClientSignupMode } from '@firmivra/types';
import { Button, Modal, Radio } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import type { Notice } from './request-panel';
import { SIGN_UP_ERRORS, SIGN_UPS } from './sign-up-parts';

export const MODE_NAMES: Record<ClientSignupMode, string> = {
  MANUAL: 'Manual Review',
  AUTOMATIC: 'Automatic Approval',
};

/**
 * Manage settings (Octavia's spec, section 5): the confirmation names the firm, the current mode,
 * the requested mode and what it applies to. Cancel and Escape change nothing; Confirm changes it
 * once at the version read, and the change is audited. Owner and Admin only (the API decides).
 */
export function ManageSettingsDialog({
  settings,
  onClose,
  onNotice,
}: {
  settings: ClientSignUpSettings;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const { firm } = useFirm();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ClientSignupMode>(settings.mode);
  // One key while the dialog is open: a retry after a lost answer changes the mode once.
  const keyRef = useRef<string | null>(null);
  const save = useApiMutation(
    (requested: ClientSignupMode) =>
      api.clientSignUps.updateSettings({
        mode: requested,
        version: settings.version,
        idempotencyKey: (keyRef.current ??= crypto.randomUUID()),
      }),
    { invalidate: SIGN_UPS },
  );
  const changed = mode !== settings.mode;
  return (
    <Modal open title={`Change how ${firm.name} approves sign-ups?`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="text-sm font-semibold text-heading">Approval mode</legend>
          {(['MANUAL', 'AUTOMATIC'] as const).map((m) => (
            <Radio
              key={m}
              name="su-requested-mode"
              label={MODE_NAMES[m]}
              checked={mode === m}
              onChange={() => setMode(m)}
            />
          ))}
        </fieldset>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Firm</dt>
          <dd className="text-text">{firm.name}</dd>
          <dt className="text-muted">Current mode</dt>
          <dd className="text-text">{MODE_NAMES[settings.mode]}</dd>
          <dt className="text-muted">Requested mode</dt>
          <dd className="font-semibold text-text">{MODE_NAMES[mode]}</dd>
        </dl>
        <p className="text-sm text-text">
          It applies to sign-ups completed from now on. Requests already waiting stay waiting for
          your review.
        </p>
        {mode === 'AUTOMATIC' ? (
          <p className="text-sm text-text">
            A sign-up is approved at once only when its email and phone are verified and no client
            of your firm has its email or phone number. Any possible match waits for your review.
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, SIGN_UP_ERRORS)}
            {save.error instanceof ApiRequestError
              ? ''
              : ' If it went through, Confirm again shows the result and changes nothing twice.'}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!changed || save.isPending}
            onClick={() =>
              save.mutate(mode, {
                onSuccess: (done) => {
                  onNotice({
                    ok: true,
                    text: `New sign-ups now use ${MODE_NAMES[done.mode]}. Requests already waiting stay waiting.`,
                  });
                  onClose();
                },
                // Someone else changed it: show the mode as it is now.
                onError: () => void queryClient.invalidateQueries({ queryKey: SIGN_UPS }),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Confirm change'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
