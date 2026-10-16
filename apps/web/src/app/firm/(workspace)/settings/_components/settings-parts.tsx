import { Skeleton, type TileTone, tileTones } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import { ArrowUp, CaretRight } from '@phosphor-icons/react/ssr';
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
    <header className="relative isolate flex flex-col gap-2">
      <Stripes />
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

/**
 * The designs' light diagonal bands behind the page header, fading out to the left (decoration
 * only). No kit component draws them yet.
 */
export function Stripes() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -top-4 right-0 -bottom-2 -z-10 w-3/4 bg-[repeating-linear-gradient(120deg,transparent_0,transparent_56px,var(--color-info-soft)_56px,var(--color-info-soft)_112px)] mask-[linear-gradient(to_left,black,transparent)]"
    />
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

/** A card with the designs' tinted title band (settings.jpg, users-and-role.jpg). */
export function BandCard({
  title,
  badge,
  action,
  id,
  testId,
  className = '',
  children,
}: {
  title: string;
  /** Shown after the title, such as "3 Pending". */
  badge?: ReactNode;
  /** On the right of the band, such as View All. */
  action?: ReactNode;
  id?: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      data-testid={testId}
      className={`flex min-w-0 flex-col rounded-xl border border-divider bg-surface shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between gap-3 rounded-t-xl bg-subtle px-4 py-3">
        <h2 className="flex items-center gap-3 text-lg font-bold text-heading">
          {title}
          {badge}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One KPI of the Settings designs: the round tinted icon, the label, the number with an optional
 * green "↑ n", and the line under it.
 */
export function SettingsKpi({
  label,
  icon,
  tone,
  value,
  change,
  note,
  noteTone = 'text-link',
  testId,
}: {
  label: string;
  icon: Icon;
  tone: TileTone;
  value: ReactNode;
  change?: number;
  note: ReactNode;
  /** The line's colour: blue, or green as in "93% active". */
  noteTone?: 'text-link' | 'text-success';
  testId?: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className="flex items-center gap-3 rounded-xl border border-divider bg-surface px-4 py-4 shadow-sm"
    >
      <span
        aria-hidden
        className={`flex size-14 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
      >
        {createElement(icon, { weight: 'fill', className: 'size-7' })}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-heading">{label}</h2>
        <div className="flex items-baseline gap-3 text-3xl font-bold text-heading">
          {value}
          {change ? (
            <span className="flex items-center gap-0.5 text-base font-semibold text-success">
              <ArrowUp aria-hidden weight="bold" className="size-4" />
              {change}
            </span>
          ) : null}
        </div>
        <p className={`text-sm ${noteTone}`}>{note}</p>
      </div>
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
