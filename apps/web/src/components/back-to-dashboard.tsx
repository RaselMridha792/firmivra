'use client';

import { ArrowLeft } from '@phosphor-icons/react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { dashboardPlace } from '../lib/from-dashboard';
import { markReturn } from '../lib/origin';

const unchanging = () => () => {};

/**
 * "Back to Dashboard" above the title of a page a dashboard card opened (Octavia's K2). Review 2
 * (K2, V9): the dashboard comes back with the periods the member chose and where it was scrolled.
 */
export function BackToDashboard() {
  const href = useSyncExternalStore(unchanging, dashboardPlace, () => '/');
  return (
    <Link
      href={href}
      onClick={() => markReturn(href)}
      data-testid="back-to-dashboard"
      className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
    >
      <ArrowLeft aria-hidden weight="bold" className="size-4" />
      Back to Dashboard
    </Link>
  );
}
