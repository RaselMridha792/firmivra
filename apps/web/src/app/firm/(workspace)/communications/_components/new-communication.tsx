'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { ORIGIN_PARAM, safeOrigin, withOrigin } from '../../../../../lib/origin';
import { ChannelNotice } from './channel-notice';
import { COMM_ERRORS, quiet } from './communications-shared';
import { NewComposer } from './composer';

/**
 * /communications/new?channel=: a new communication. Opening it saves and sends nothing (Octavia's
 * Q3): Dashboard Review 2 asked for the composer itself, not a Start page, so it opens at once and
 * its first save makes the draft (NewComposer). A template's Use (`templateId`) is already that
 * choice, so it makes the draft from the template at once.
 */
export function NewCommunication({
  channel,
  templateId,
}: {
  channel: 'EMAIL' | 'SMS' | 'ANNOUNCEMENT';
  /** Started from a template's Use: the API copies the template into the draft. */
  templateId?: string;
}) {
  const router = useRouter();
  // TP-F01: Use from a Templates list (`?from=`, SH1) keeps its Back to that list on the draft,
  // and on this page when the draft can't start.
  const from = safeOrigin(useSearchParams().get(ORIGIN_PARAM));
  const [error, setError] = useState<string>();
  const [blocked, setBlocked] = useState(false);
  const [starting, setStarting] = useState(false);
  const startedRef = useRef(false);
  const start = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarting(true);
    api.communications
      .create({ channel, ...(templateId ? { templateId } : {}) })
      .then((c) => {
        const edit = `/communications/${c.id}/edit`;
        router.replace(from ? withOrigin(edit, from) : edit);
      })
      .catch((e: unknown) => {
        startedRef.current = false;
        setStarting(false);
        if (errorCode(e) === 'CHANNEL_UNAVAILABLE') setBlocked(true);
        else setError(errorMessage(e, COMM_ERRORS));
      });
  };
  const startRef = useRef(start);
  useEffect(() => {
    if (templateId) startRef.current();
  }, [templateId]);
  if (blocked)
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <ChannelNotice channel={channel} from={`/communications/new?channel=${channel}`} />
        <Link href="/communications" className="text-sm font-medium text-link">
          ← Back to Communications
        </Link>
      </div>
    );
  if (error)
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className={quiet}>
          {error}
        </p>
        <Link href="/communications" className="text-sm font-medium text-link">
          ← Back to Communications
        </Link>
      </div>
    );
  if (templateId || starting) return <p className={quiet}>Starting your draft…</p>;
  return <NewComposer channel={channel} />;
}
