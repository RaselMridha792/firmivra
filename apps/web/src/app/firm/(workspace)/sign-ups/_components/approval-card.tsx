'use client';

import type { ClientSignUpSettings } from '@firmivra/types';
import { Button, Radio } from '@firmivra/ui';
import { Lock } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';

/**
 * Client self-sign-up approval (the design's header card): the firm's mode as it is now. Both
 * modes are explained; the radios only show the mode. Changing it goes through Manage settings.
 */
export function ApprovalCard({ settings }: { settings: UseQueryResult<ClientSignUpSettings> }) {
  const mode = settings.data?.mode;
  return (
    <section
      aria-labelledby="su-approval"
      data-testid="approval-card"
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-divider bg-surface p-5 md:flex-row md:items-start md:justify-between"
    >
      <div className="min-w-0">
        <h2 id="su-approval" className="font-display text-xl font-bold text-heading">
          Client self-sign-up approval
        </h2>
        <fieldset disabled className="mt-1">
          <legend className="sr-only">Approval mode</legend>
          <div className="flex flex-wrap gap-x-10">
            <Radio
              name="su-mode"
              label="Manual Review"
              checked={mode === 'MANUAL'}
              readOnly
              className="text-base! text-text"
            />
            <Radio
              name="su-mode"
              label="Automatic Approval"
              checked={mode === 'AUTOMATIC'}
              readOnly
              className="text-base! text-text"
            />
          </div>
        </fieldset>
        {settings.isError ? (
          <p role="alert" className="text-sm text-danger">
            The approval mode can&apos;t be shown right now.
          </p>
        ) : null}
        <p className="mt-1 text-sm text-text">
          <span className="font-semibold">Manual Review:</span> staff approve new applicants.
        </p>
        <p className="text-sm text-text">
          <span className="font-semibold">Automatic Approval:</span> potential account matches stay
          pending for staff review.
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 md:items-center">
        <Button variant="outline" disabled aria-describedby="su-settings-note">
          <Lock aria-hidden weight="fill" className="size-5" />
          Manage settings
        </Button>
        <p id="su-settings-note" className="text-sm text-muted">
          Authorized admins only
        </p>
      </div>
    </section>
  );
}
