'use client';

import { ArrowLeft } from '@phosphor-icons/react';
import Link from 'next/link';

/**
 * "Back to Dashboard" above the title of a page a dashboard card opened (Octavia's K2). The
 * dashboard opens at its top, where the cards are.
 */
export function BackToDashboard() {
  return (
    <Link
      href="/"
      data-testid="back-to-dashboard"
      className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
    >
      <ArrowLeft aria-hidden weight="bold" className="size-4" />
      Back to Dashboard
    </Link>
  );
}
