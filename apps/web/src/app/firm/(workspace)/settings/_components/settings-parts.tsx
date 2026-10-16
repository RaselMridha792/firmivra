import { Skeleton, type TileTone, tileTones } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import { CaretRight } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { type ReactNode, createElement } from 'react';

/** The line a card shows when its call failed (design-match rule 2). */
export const NOT_LOADED = 'Could not load this right now. It fills in once the data is available.';

/**
 * The top of a Settings page (settings.jpg, users-and-role.jpg): Settings > page, the blue tile,
 * the title with its blue line, and an optional button on the right.
 */
export function SettingsHeader({
  icon,
  title,
  subtitle,
  action,
  crumb = true,
}: {
  icon: Icon;
  title: string;
  subtitle: string;
  action?: ReactNode;
  /** Settings > page; the Overview itself has none. */
  crumb?: boolean;
}) {
  return (
    <header className="flex flex-col gap-2">
      {crumb ? (
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Link href="/settings/overview" className="text-link hover:underline">
            Settings
          </Link>
          <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
          <span aria-current="page" className="font-semibold text-heading">
            {title}
          </span>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            {createElement(icon, { 'aria-hidden': true, weight: 'fill', className: 'size-9' })}
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              {title}
            </h1>
            <p className="text-base text-link">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
    </header>
  );
}

/** One Settings card: the tinted tile, the title and line, and an optional link on the right. */
export function SettingsCard({
  title,
  subtitle,
  icon,
  tone = 'blue',
  action,
  testId,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  icon: Icon;
  tone?: TileTone;
  action?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span
          aria-hidden
          className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${tileTones[tone]}`}
        >
          {createElement(icon, { weight: 'fill', className: 'size-6' })}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-heading">{title}</h2>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A quiet line inside a card: nothing yet, or the call failed. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{children}</p>;
}

/** Label and value rows. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col divide-y divide-divider">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2">
          <dt className="text-sm text-heading">{label}</dt>
          <dd className="text-right text-sm font-semibold text-link">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A card's body: a skeleton while loading, the quiet line when the call failed, else its data. */
export function Loaded<T>({
  query,
  lines = 'h-24',
  children,
}: {
  query: { isPending: boolean; data: T | undefined };
  lines?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Skeleton className={lines} />;
  if (query.data === undefined) return <Quiet>{NOT_LOADED}</Quiet>;
  return <>{children(query.data)}</>;
}

/** A link styled as the cards' outlined button. */
export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 w-fit items-center rounded-lg border border-action px-4 text-sm font-semibold text-action hover:bg-folder-surface"
    >
      {children}
    </Link>
  );
}
