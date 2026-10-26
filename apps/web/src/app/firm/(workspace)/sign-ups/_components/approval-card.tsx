'use client';

import type { ClientSignUpSettings } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { Lock } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { ManageSettingsDialog } from './manage-settings-dialog';
import type { Notice } from './request-panel';

const MODES = [
  { mode: 'MANUAL', label: 'Manual Review' },
  { mode: 'AUTOMATIC', label: 'Automatic Approval' },
] as const;

/**
 * Client self-sign-up approval (the design's header card): the firm's mode as it is now, drawn as
 * the design's radios but only showing it. Both modes are explained. Changing it goes through
 * Manage settings.
 */
export function ApprovalCard({
  settings,
  onNotice,
}: {
  settings: UseQueryResult<ClientSignUpSettings>;
  onNotice: (notice: Notice) => void;
}) {
  const mode = settings.data?.mode;
  const [managing, setManaging] = useState(false);
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
        <ul aria-label="Approval mode" className="mt-1 flex flex-wrap gap-x-10">
          {MODES.map((m) => (
            <li key={m.mode} className="flex min-h-11 items-center gap-3 text-base text-text">
              <span
                aria-hidden
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${mode === m.mode ? 'border-action' : 'border-border'}`}
              >
                {mode === m.mode ? <span className="size-2.5 rounded-full bg-action" /> : null}
              </span>
              {m.label}
              {mode === m.mode ? (
                <span className="sr-only">(your firm&apos;s mode now)</span>
              ) : null}
            </li>
          ))}
        </ul>
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
        <Button
          variant="outline"
          disabled={!settings.data}
          aria-describedby="su-settings-note"
          onClick={() => setManaging(true)}
        >
          <Lock aria-hidden weight="fill" className="size-5" />
          Manage settings
        </Button>
        <p id="su-settings-note" className="text-sm text-muted">
          Authorized admins only
        </p>
      </div>
      {managing && settings.data ? (
        <ManageSettingsDialog
          settings={settings.data}
          onClose={() => setManaging(false)}
          onNotice={onNotice}
        />
      ) : null}
    </section>
  );
}
