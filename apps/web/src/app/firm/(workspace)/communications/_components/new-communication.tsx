'use client';

import { Button } from '@firmivra/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { COMM_ERRORS, quiet } from './communications-shared';

const NAMES = { EMAIL: 'Bulk Email', SMS: 'Bulk Text Message', ANNOUNCEMENT: 'Announcement' };

/**
 * /communications/new?channel=: the start of a new communication. Opening it saves and sends
 * nothing (Octavia's Q3): Start makes the draft and opens the composer on it. A template's Use
 * (`templateId`) is already that choice, so it starts at once.
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
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const startedRef = useRef(false);
  const start = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarting(true);
    api.communications
      .create({ channel, ...(templateId ? { templateId } : {}) })
      .then((c) => router.replace(`/communications/${c.id}/edit`))
      .catch((e: unknown) => {
        startedRef.current = false;
        setStarting(false);
        setError(errorMessage(e, COMM_ERRORS));
      });
  };
  const startRef = useRef(start);
  useEffect(() => {
    if (templateId) startRef.current();
  }, [templateId]);
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
  return (
    <section
      aria-labelledby="new-communication"
      data-testid="new-communication"
      className="flex max-w-xl flex-col gap-3 rounded-xl border border-divider bg-surface p-5 shadow-sm"
    >
      <h1 id="new-communication" className="text-2xl font-bold text-heading">
        New {NAMES[channel]}
      </h1>
      <p className="text-sm text-text">
        Write it, choose who receives it, then review and send. Nothing is saved or sent until you
        start; a started draft stays in Communications until you send or delete it.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={start}>Start {NAMES[channel]}</Button>
        <Link
          href="/communications"
          className="inline-flex min-h-10 items-center text-sm font-medium text-link"
        >
          Back to Communications
        </Link>
      </div>
    </section>
  );
}
