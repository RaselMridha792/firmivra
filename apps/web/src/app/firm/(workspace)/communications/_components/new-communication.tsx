'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { COMM_ERRORS, quiet } from './communications-shared';

/** /communications/new?channel=: makes the draft, then opens the composer on it. */
export function NewCommunication({ channel }: { channel: 'EMAIL' | 'SMS' | 'ANNOUNCEMENT' }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    api.communications
      .create({ channel })
      .then((c) => router.replace(`/communications/${c.id}/edit`))
      .catch((e: unknown) => setError(errorMessage(e, COMM_ERRORS)));
  }, [channel, router]);
  return error ? (
    <div className="flex flex-col gap-3">
      <p role="alert" className={quiet}>
        {error}
      </p>
      <Link href="/communications" className="text-sm font-medium text-link">
        ← Back to Communications
      </Link>
    </div>
  ) : (
    <p className={quiet}>Starting your draft…</p>
  );
}
