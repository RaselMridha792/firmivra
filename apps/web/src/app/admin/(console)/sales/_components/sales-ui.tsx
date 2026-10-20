'use client';

import { Badge, Card, Skeleton } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarBlank,
  CaretDown,
  CaretRight,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { useApiQuery } from '../../../../../lib/query';
import {
  adminSales,
  ATTENTION_FLAGS,
  type AttentionFlag,
  type SalesMeta,
  type SalesTrend,
  type StageTone,
} from './sales-api';

/** Every sales query key starts here, so one invalidation refreshes the whole module. */
export const SALES_KEY = ['admin-sales'] as const;

export function useSalesMeta() {
  return useApiQuery<SalesMeta>([...SALES_KEY, 'meta'], () => adminSales.meta());
}

type BadgeTone = NonNullable<ComponentProps<typeof Badge>['tone']>;

/* Formatting ---------------------------------------------------------------------------------- */

export const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
export const moneyExact = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const dateText = (value: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value),
  );
export const timeText = (value: string) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
export const dateTimeText = (value: string) => `${dateText(value)} ${timeText(value)}`;
/** "Oct 1, 2026" from a local `YYYY-MM-DD`. */
export const localDateText = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return dateText(new Date(year, month - 1, day).toISOString());
};
/** "2,400.00" typed in a money field, as cents; null when blank; NaN when not a number. */
export const parseMoney = (value: string) => {
  const clean = value.replace(/[$,\s]/g, '');
  if (!clean) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  return Math.round(Number(clean) * 100);
};

/* Colours ------------------------------------------------------------------------------------- */

/** Each stage colour on the board header, the add row, the analytics bar and its badge. */
export const STAGE_STYLE: Record<
  StageTone,
  { head: string; foot: string; bar: string; add: string; badge: BadgeTone }
> = {
  blue: {
    head: 'bg-info-soft text-heading',
    foot: 'bg-info-soft/40',
    bar: 'fill-action',
    add: 'text-action',
    badge: 'info',
  },
  grey: {
    head: 'bg-table-head text-heading',
    foot: 'bg-table-head/50',
    bar: 'fill-chart-blue',
    add: 'text-action',
    badge: 'neutral',
  },
  sky: {
    head: 'bg-info-soft text-info',
    foot: 'bg-info-soft/40',
    bar: 'fill-sky',
    add: 'text-action',
    badge: 'info',
  },
  purple: {
    head: 'bg-purple-soft text-purple',
    foot: 'bg-purple-soft/50',
    bar: 'fill-purple/60',
    add: 'text-purple',
    badge: 'purple',
  },
  amber: {
    head: 'bg-warning-soft text-warning',
    foot: 'bg-amber-surface',
    bar: 'fill-chart-yellow',
    add: 'text-purple',
    badge: 'warning',
  },
  lavender: {
    head: 'bg-purple-soft text-purple',
    foot: 'bg-purple-soft/50',
    bar: 'fill-purple/35',
    add: 'text-purple',
    badge: 'purple',
  },
  green: {
    head: 'bg-success-soft text-success',
    foot: 'bg-success-soft/40',
    bar: 'fill-chart-green',
    add: 'text-action',
    badge: 'success',
  },
  teal: {
    head: 'bg-accent-soft text-accent',
    foot: 'bg-accent-soft/50',
    bar: 'fill-accent/70',
    add: 'text-action',
    badge: 'info',
  },
  mint: {
    head: 'bg-success-soft text-success',
    foot: 'bg-success-soft/40',
    bar: 'fill-chart-green/80',
    add: 'text-action',
    badge: 'success',
  },
  red: {
    head: 'bg-danger-soft text-danger',
    foot: 'bg-danger-soft/40',
    bar: 'fill-chart-red/70',
    add: 'text-purple',
    badge: 'danger',
  },
};

export const ATTENTION_TONE: Record<AttentionFlag, BadgeTone> = {
  NO_CONTACT: 'danger',
  OVERDUE: 'danger',
  NO_RESPONSE: 'warning',
  UNASSIGNED: 'neutral',
  NO_ACTIVITY: 'warning',
  FOLLOW_UP_DUE: 'warning',
};
export const attentionLabel = (flag: AttentionFlag) =>
  ATTENTION_FLAGS.find((item) => item.id === flag)?.label ?? flag;

const TILES = {
  blue: 'bg-info-soft text-info',
  purple: 'bg-purple-soft text-purple',
  green: 'bg-success-soft text-success',
  red: 'bg-danger-soft text-danger',
  amber: 'bg-warning-soft text-gold',
  orange: 'bg-warning-soft text-orange',
} as const;
export type SalesTileTone = keyof typeof TILES;

/* Page parts ---------------------------------------------------------------------------------- */

/** Dashboard › Sales › …: the last item is the current page. */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-text">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2">
            {index ? <CaretRight aria-hidden weight="bold" className="size-3 text-muted" /> : null}
            {item.href ? (
              <Link href={item.href} className="text-text hover:text-action hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-heading">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A white card with its icon title and an action ("View All →") on the right. */
export function Panel({
  icon: Glyph,
  iconClassName = 'text-action',
  title,
  action,
  children,
  className = '',
  testId,
}: {
  icon: Icon;
  iconClassName?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card
      variant="elevated"
      data-testid={testId}
      aria-label={title}
      className={`flex min-w-0 flex-col !p-4 ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-heading">
          <Glyph aria-hidden weight="fill" className={`size-6 shrink-0 ${iconClassName}`} />
          <span className="min-w-0">{title}</span>
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** "View All →" in a panel's title row: a link, or a button that opens a drawer. */
export function ViewAll({
  href,
  onClick,
  label,
}: {
  href?: string;
  onClick?: () => void;
  label: string;
}) {
  const content = (
    <>
      View All
      <ArrowRight aria-hidden weight="bold" className="size-4" />
      <span className="sr-only"> {label}</span>
    </>
  );
  const className =
    'inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-action hover:underline';
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

const emptyList = (data: unknown) => Array.isArray(data) && data.length === 0;

/** Quiet lines that keep a widget's frame: loading bars, the error line, the empty line. */
export function FrameState<T>({
  query,
  empty,
  isEmpty = emptyList,
  lines = 4,
  children,
}: {
  query: UseQueryResult<T>;
  empty: string;
  isEmpty?: (data: T) => boolean;
  lines?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending)
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3 py-1">
        {Array.from({ length: lines }, (_, n) => `line-${n}`).map((key) => (
          <Skeleton key={key} className="h-5" />
        ))}
      </div>
    );
  if (query.isError && query.data === undefined)
    return <FrameError onRetry={() => void query.refetch()} />;
  const data = query.data as T;
  if (isEmpty(data)) return <p className="py-2 text-sm text-muted">{empty}</p>;
  return <>{children(data)}</>;
}

export function FrameError({ onRetry }: { onRetry?: () => void }) {
  return (
    <p data-testid="frame-error" className="py-2 text-sm text-muted">
      Could not load this right now.{' '}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-medium text-action hover:underline">
          Try again
        </button>
      ) : null}
    </p>
  );
}

/** One number of a KPI row, after the designs: a rounded tile, the value, its label and trend. */
export function SalesKpi({
  icon: Glyph,
  tone,
  label,
  value,
  state,
  trend,
  downIsGood = false,
  note,
  alert = false,
  onClick,
  pressed,
  testId,
}: {
  icon: Icon;
  tone: SalesTileTone;
  label: string;
  value: string;
  state: 'loading' | 'error' | 'ready';
  trend?: SalesTrend;
  /** Lost deals: fewer is good news. */
  downIsGood?: boolean;
  note?: string;
  /** The red "!" after the label (Needs Attention). */
  alert?: boolean;
  /** Clicking filters the page to these records. */
  onClick?: () => void;
  pressed?: boolean;
  testId?: string;
}) {
  const good = trend?.direction === (downIsGood ? 'down' : 'up');
  const Arrow = trend?.direction === 'down' ? ArrowDown : ArrowUp;
  const body = (
    <>
      <span
        className={`flex size-12 shrink-0 items-center justify-center rounded-xl min-[1440px]:size-11 ${TILES[tone]}`}
      >
        <Glyph aria-hidden weight="fill" className="size-7 min-[1440px]:size-6" />
      </span>
      <span className="flex min-w-0 flex-col">
        {state === 'loading' ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <span
            data-testid={testId ? `${testId}-value` : undefined}
            className="text-2xl leading-tight font-bold text-heading min-[1440px]:text-xl"
          >
            {state === 'error' ? (
              <>
                <span aria-hidden>—</span>
                <span className="sr-only">Not available</span>
              </>
            ) : (
              value
            )}
          </span>
        )}
        <span className="flex items-center gap-1 text-sm leading-snug text-text">
          {label}
          {alert ? (
            <span className="inline-flex text-danger" title="Needs attention">
              <WarningDot />
            </span>
          ) : null}
        </span>
        {trend && state === 'ready' ? (
          <span
            className={`inline-flex items-center gap-1 text-sm font-semibold ${trend.direction === 'flat' ? 'text-muted' : good ? 'text-success' : 'text-danger'}`}
          >
            {trend.direction === 'flat' ? null : (
              <Arrow aria-hidden weight="bold" className="size-3.5" />
            )}
            {trend.direction === 'flat' ? 'No change' : `${trend.percent}%`}
            <span className="sr-only">
              {trend.direction === 'flat' ? '' : trend.direction === 'up' ? ' up' : ' down'}
            </span>
          </span>
        ) : null}
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </span>
    </>
  );
  const frame =
    'flex min-w-0 items-center gap-4 rounded-xl bg-surface p-4 text-left shadow-md min-[1440px]:gap-3 min-[1440px]:p-3';
  return onClick ? (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
      className={`${frame} hover:outline-2 hover:outline-border focus-visible:outline-2 focus-visible:outline-focus ${pressed ? 'outline-2 outline-action' : ''}`}
    >
      {body}
    </button>
  ) : (
    <div data-testid={testId} className={frame}>
      {body}
    </div>
  );
}

/** The red disc with "!" next to Needs Attention. */
function WarningDot() {
  return (
    <span
      aria-hidden
      className="inline-flex size-4 items-center justify-center rounded-full bg-danger text-xs leading-none font-bold text-on-action"
    >
      !
    </span>
  );
}

/** A compact select with an optional leading icon (period pickers in panel headers). */
export function CompactSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  withIcon = false,
  className = '',
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  withIcon?: boolean;
  className?: string;
}) {
  return (
    <label className={`relative inline-flex min-w-0 ${className}`}>
      <span className="sr-only">{label}</span>
      {withIcon ? (
        <CalendarBlank
          aria-hidden
          weight="fill"
          className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-heading"
        />
      ) : null}
      <select
        value={value}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onChange(next.value);
        }}
        className={`w-full min-w-0 appearance-none rounded-lg border border-divider bg-surface text-sm text-text focus:outline-2 focus:outline-focus ${withIcon ? 'h-11 pr-10 pl-11' : 'h-9 pr-9 pl-3'}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <CaretDown
        aria-hidden
        weight="bold"
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted"
      />
    </label>
  );
}

/**
 * A bar on its track, its length a share of `max`. SVG attributes size it, so the length comes
 * from the data without an inline style. `fillClass` is a `fill-*` token class.
 */
export function Bar({
  value,
  max,
  fillClass,
  className = 'h-3',
}: {
  value: number;
  max: number;
  fillClass: string;
  className?: string;
}) {
  const share = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <svg aria-hidden className={`block w-full ${className}`}>
      <rect width="100%" height="100%" rx="4" className="fill-table-head" />
      {share ? <rect width={`${share}%`} height="100%" rx="4" className={fillClass} /> : null}
    </svg>
  );
}

/** A labelled bar row: the label, the bar and the number. */
export function BarRow({
  label,
  value,
  max,
  fillClass,
  display,
  onClick,
  labelClass = 'w-2/5',
}: {
  label: string;
  value: number;
  max: number;
  fillClass: string;
  display?: string;
  onClick?: () => void;
  labelClass?: string;
}) {
  const content = (
    <>
      <span className={`shrink-0 truncate text-left text-sm text-text ${labelClass}`}>{label}</span>
      <span className="min-w-0 flex-1">
        <Bar value={value} max={max} fillClass={fillClass} />
      </span>
      <span className="w-8 shrink-0 text-right text-sm font-medium text-heading tabular-nums">
        {display ?? value}
      </span>
    </>
  );
  const row = 'flex w-full items-center gap-3';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${display ?? value}. Show these records`}
      className={`${row} rounded-md py-0.5 hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus`}
    >
      {content}
    </button>
  ) : (
    <div className={row}>{content}</div>
  );
}
