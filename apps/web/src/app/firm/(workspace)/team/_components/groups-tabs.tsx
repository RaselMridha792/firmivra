import Link from 'next/link';
import type { ReactNode } from 'react';

const TABS = [
  { href: '/team/departments', label: 'Departments' },
  { href: '/team/teams', label: 'Teams' },
  { href: '/team/org-chart', label: 'Org Chart' },
] as const;

/**
 * Departments, Teams and Org Chart: each tab is its own page (PAGE-MAP), so the tabs are links,
 * drawn as the kit's underline tabs. The tab's search, filter and button sit on the right.
 */
export function GroupsTabs({
  current,
  children,
}: {
  current: (typeof TABS)[number]['href'];
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-divider bg-surface px-4 pb-3 shadow-sm lg:flex-row lg:justify-between lg:pb-0">
      <nav
        aria-label="Teams and departments"
        className="flex shrink-0 gap-1 overflow-x-auto sm:gap-2 lg:self-end"
      >
        {TABS.map((tab) => {
          const on = tab.href === current;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={on ? 'page' : undefined}
              className={`min-h-11 border-b-3 px-2.5 py-3 text-sm font-medium whitespace-nowrap sm:px-6 sm:py-4 sm:text-base ${on ? 'border-action text-action' : 'border-transparent text-heading hover:text-action'}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children ? (
        // A wrapping row (a column would squash the search field's height); on phones each
        // control takes its own line.
        <div className="flex flex-wrap items-center gap-3 max-sm:[&>*]:basis-full lg:justify-end lg:py-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}
