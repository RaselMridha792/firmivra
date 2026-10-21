import { ArrowLeft, UsersThree } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The top of Teams & Departments (teams-and-departments.jpg): Back to Staff Management, the
 * tile, the title with its blue line, and the firm's motto on the right. Shared by the
 * Departments, Teams and Org Chart tabs. (PageHeader's subtitle is grey; the design's is blue.)
 * `back` is a second way back beside it (Back to Workflow & Automations, opened from Settings).
 */
export function GroupsHeader({ back }: { back?: ReactNode } = {}) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link
          href="/team"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Staff Management
        </Link>
        {back}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <UsersThree aria-hidden weight="fill" className="size-9" />
          </span>
          <div>
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              Teams &amp; Departments
            </h1>
            <p className="text-base text-link">
              Organize your staff, create teams, and manage department settings.
            </p>
          </div>
        </div>
        <div
          aria-hidden
          className="hidden items-center gap-5 text-xs tracking-brand text-heading uppercase xl:flex"
        >
          <p className="flex flex-col gap-1 text-sm font-semibold">
            <span>People</span>
            <span>Plans</span>
            <span>Prosperity</span>
          </p>
          <span className="h-14 w-px bg-gold" />
          <p className="flex flex-col gap-1.5">
            <span>Structured teams.</span>
            <span>Greater efficiency.</span>
            <span>Bigger results.</span>
          </p>
        </div>
      </div>
    </header>
  );
}
