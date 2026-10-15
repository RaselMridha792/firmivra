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
    <div className="flex flex-col gap-3 rounded-xl border border-divider bg-surface px-4 pb-3 shadow-sm lg:flex-row lg:items-center lg:justify-between lg:pb-0">
      <nav aria-label="Teams and departments" className="flex gap-2 overflow-x-auto">
        {TABS.map((tab) => {
          const on = tab.href === current;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={on ? 'page' : undefined}
              className={`min-h-11 border-b-3 px-6 py-4 text-base font-medium whitespace-nowrap ${on ? 'border-action text-action' : 'border-transparent text-heading hover:text-action'}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">{children}</div>
      ) : null}
    </div>
  );
}
