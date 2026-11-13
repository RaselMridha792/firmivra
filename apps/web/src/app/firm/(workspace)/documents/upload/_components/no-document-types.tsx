'use client';

import Link from 'next/link';
import { useFirm } from '../../../../../../components/firm-context';

/**
 * Advisory B12 (Octavia, Oct 25): every document needs a type and the firm has none yet. Types
 * are the firm's document categories (Documents > Settings), not Services & Pricing offerings.
 * Owner and Admin get the way there; Staff are told who adds them.
 */
export function NoDocumentTypes() {
  const { role } = useFirm();
  return (
    <p
      role="alert"
      data-testid="no-document-types"
      className="rounded-control bg-warning-soft px-4 py-3 text-sm text-heading"
    >
      The firm has no document types yet, and every document needs one. Types are set up in
      Documents &gt; Settings (they are not Services &amp; Pricing).{' '}
      {role === 'OWNER' || role === 'ADMIN' ? (
        <Link href="/documents/settings?tab=general" className="font-medium text-action underline">
          Add document types
        </Link>
      ) : (
        'Ask an Owner or Admin to add them.'
      )}
    </p>
  );
}
