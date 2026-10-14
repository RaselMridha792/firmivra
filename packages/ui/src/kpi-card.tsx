import { ArrowDown, ArrowUp, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Skeleton } from './states';

const tones = {
  blue: 'bg-info-soft text-info',
  amber: 'bg-warning-soft text-gold',
  green: 'bg-success-soft text-success',
  purple: 'bg-purple-soft text-purple',
  red: 'bg-danger-soft text-danger',
  grey: 'bg-disabled text-muted',
};
export type KpiTone = keyof typeof tones;

/** A round tinted tile behind a solid icon in a stronger shade of the same colour. */
export function IconTile({ icon: Glyph, tone = 'blue' }: { icon: Icon; tone?: KpiTone }) {
  return (
    <span
      className={`flex size-14 shrink-0 items-center justify-center rounded-full ${tones[tone]}`}
    >
      <Glyph aria-hidden weight="fill" className="size-7" />
    </span>
  );
}

export interface KpiTrend {
  /** "12%". */
  text: string;
  /** `up` and `down` carry an arrow; `flat` is "No change". */
  direction: 'up' | 'down' | 'flat';
  /** Whether this direction is good news: green when true, red when false. */
  good?: boolean;
}
export interface KpiCardProps {
  icon: Icon;
  tone?: KpiTone;
  value: ReactNode;
  label: string;
  trend?: KpiTrend;
  /** The line under the number or the trend: "vs last month". */
  note?: string;
  loading?: boolean;
}

/** One number of a page's top row: icon tile, value, label, and how it moved. */
export function KpiCard({ icon, tone, value, label, trend, note, loading }: KpiCardProps) {
  const Arrow = trend?.direction === 'up' ? ArrowUp : ArrowDown;
  const colour =
    trend?.good === false ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success';
  return (
    <div className="flex items-center gap-4 rounded-xl bg-surface p-4 shadow-md">
      <IconTile icon={icon} tone={tone} />
      <div className="flex min-w-0 flex-col gap-1">
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <span className="text-2xl leading-none font-bold text-heading">{value}</span>
        )}
        <span className="text-sm text-muted">{label}</span>
        {trend ? (
          <span
            className={`inline-flex w-fit items-center gap-1 rounded-md px-1.5 text-xs font-semibold ${trend.direction === 'flat' ? 'bg-disabled text-muted' : colour}`}
          >
            {trend.direction === 'flat' ? null : (
              <Arrow aria-hidden weight="bold" className="size-3" />
            )}
            {trend.text}
          </span>
        ) : null}
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </div>
    </div>
  );
}
