'use client';

import type { CommunicationRow } from '@firmivra/types';
import { Warning, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useFirm } from '../../../../../components/firm-context';
import { withOrigin } from '../../../../../lib/origin';

const NOUNS = { EMAIL: 'Email', SMS: 'Text messaging', ANNOUNCEMENT: 'Announcements' };

/**
 * CM-F04: a channel that is not connected yet. Owners and Admins get the way to Integrations (its
 * Back returns here); Staff are told who can connect it, never a dead end.
 */
export function ChannelNotice({
  channel,
  from,
  onDismiss,
}: {
  channel: CommunicationRow['channel'];
  /** The page Integrations' Back returns to. */
  from: string;
  onDismiss?: () => void;
}) {
  const { role } = useFirm();
  const noun = NOUNS[channel];
  const canConnect = role === 'OWNER' || role === 'ADMIN';
  return (
    <div
      role="alert"
      data-testid="channel-notice"
      className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-soft p-3 text-sm text-text"
    >
      <Warning aria-hidden weight="fill" className="size-5 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        {noun} is not connected, so nothing can be sent this way yet.
        {canConnect ? null : ` Ask an Owner or Admin to connect ${noun}.`}
      </span>
      {canConnect ? (
        <Link
          href={withOrigin('/integrations', from)}
          className="font-semibold whitespace-nowrap text-link underline"
        >
          Connect {noun} in Integrations
        </Link>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-surface"
        >
          <X aria-hidden weight="bold" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
