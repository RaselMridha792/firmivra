'use client';

import { UsersThree } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';

const subscribeToNothing = () => () => {};
/** "Tue, Sep 29, 2026" in the browser's own day; the server draws no date (no mismatch). */
const localDate = () =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
const serverDate = () => '';

/**
 * The top of Staff Management (staff-mangement.jpg): the blue tile, the title with its blue line,
 * the diagonal light streak, the motto and today's date card. (PageHeader's title is serif and its
 * subtitle grey; the design's are sans and blue.)
 */
export function StaffHeader() {
  const today = useSyncExternalStore(subscribeToNothing, localDate, serverDate);
  return (
    <header className="flex flex-wrap items-center gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
          <UsersThree aria-hidden weight="fill" className="size-9" />
        </span>
        <div className="min-w-0">
          <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
            Staff Management
          </h1>
          <p className="text-lg text-link">
            Manage your team, permissions, and access all in one place.
          </p>
        </div>
      </div>
      {/* The design's light streak between the title and the motto: decoration only. */}
      <div aria-hidden className="relative hidden h-20 min-w-24 flex-1 overflow-hidden xl:block">
        <span className="absolute inset-y-0 right-24 w-20 -skew-x-45 bg-info-soft" />
        <span className="absolute inset-y-0 right-20 w-0.5 -skew-x-45 bg-gold" />
        <span className="absolute inset-y-0 right-8 w-10 -skew-x-45 bg-sky/30" />
      </div>
      <div className="ml-auto flex items-center gap-5">
        <p className="hidden flex-col text-xs font-bold text-heading uppercase lg:flex">
          <span>A strong team builds</span>
          <span>a stronger tomorrow.</span>
        </p>
        <span aria-hidden className="hidden h-12 w-px bg-divider lg:block" />
        <p
          data-testid="staff-today"
          className="hidden min-w-36 flex-col gap-0.5 rounded-lg bg-subtle px-4 py-2 sm:flex"
        >
          <span className="text-sm font-bold text-heading">{today}</span>
          <span className="text-xs text-muted">Let’s keep building.</span>
        </p>
      </div>
    </header>
  );
}
