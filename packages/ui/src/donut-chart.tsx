import type { ReactNode } from 'react';

/** Segment colours: the Intake Forms status chart's five, plus the kit's purple and navy. */
const strokes = {
  green: 'stroke-chart-green',
  blue: 'stroke-chart-blue',
  yellow: 'stroke-chart-yellow',
  grey: 'stroke-chart-grey',
  red: 'stroke-chart-red',
  purple: 'stroke-purple',
  navy: 'stroke-heading',
} as const;
const dots = {
  green: 'bg-chart-green',
  blue: 'bg-chart-blue',
  yellow: 'bg-chart-yellow',
  grey: 'bg-chart-grey',
  red: 'bg-chart-red',
  purple: 'bg-purple',
  navy: 'bg-heading',
} as const;
export type ChartTone = keyof typeof strokes;

export interface DonutSegment {
  label: string;
  value: number;
  tone: ChartTone;
}

export interface DonutArc {
  segment: DonutSegment;
  /** Length of the arc and where it starts along the circle, both as a fraction of 1. */
  fraction: number;
  offset: number;
}

/**
 * Where each segment's arc goes. Negative values count as 0. `total` makes a ring that is not
 * full (a progress ring: one segment of `total`); by default the segments fill the circle.
 */
export function donutArcs(segments: DonutSegment[], total?: number): DonutArc[] {
  const sum = segments.reduce((n, s) => n + Math.max(0, s.value), 0);
  const whole = Math.max(total ?? sum, sum);
  if (whole <= 0) return [];
  let offset = 0;
  return segments
    .filter((s) => s.value > 0)
    .map((segment) => {
      const fraction = segment.value / whole;
      const arc = { segment, fraction, offset };
      offset += fraction;
      return arc;
    });
}

/** "50%" of the segments' sum, rounded; "0%" when there is nothing. */
export const percentOf = (value: number, sum: number) =>
  `${sum > 0 ? Math.round((Math.max(0, value) / sum) * 100) : 0}%`;

export interface DonutChartProps {
  segments: DonutSegment[];
  /** Big text in the middle; the segments' sum when left out. */
  centerValue?: ReactNode;
  /** Small text under it: "Total Forms", "Completed". */
  centerLabel?: string;
  /** For a progress ring: the whole the segments are part of (e.g. 100). */
  total?: number;
  /** Legend on the right with value and (percent). */
  legend?: boolean;
  showPercent?: boolean;
  /** The ring's diameter in spacing steps' rem: `md` 9rem (status chart), `lg` 10rem. */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible summary; built from the segments when left out. */
  label?: string;
  /** Under the empty ring. */
  emptyText?: string;
}

const sizes = { sm: 'size-28', md: 'size-36', lg: 'size-40' };
const valueSizes = { sm: 'text-2xl', md: 'text-3xl', lg: 'text-4xl' };
/** The small ring is thinner, as Submission Summary's. */
const widths = { sm: 10, md: 14, lg: 14 };
const R = 40;
const C = 2 * Math.PI * R;
/** A hair of white between segments, as in the design. */
const GAP = 0.6;

/**
 * A ring chart with a total in the middle and an optional legend. With no data it draws the
 * empty grey ring and the empty text: never made-up numbers.
 */
export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  total,
  legend = true,
  showPercent = true,
  size = 'md',
  label,
  emptyText = 'No data yet.',
}: DonutChartProps) {
  const sum = segments.reduce((n, s) => n + Math.max(0, s.value), 0);
  const arcs = donutArcs(segments, total);
  const empty = arcs.length === 0;
  const summary =
    label ??
    (empty
      ? emptyText
      : segments.map((s) => `${s.label}: ${s.value} (${percentOf(s.value, sum)})`).join(', '));
  return (
    <figure className="flex flex-wrap items-center gap-6">
      <div className={`relative shrink-0 ${sizes[size]}`}>
        <svg viewBox="0 0 100 100" role="img" aria-label={summary} className="size-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            strokeWidth={widths[size]}
            className="stroke-divider"
          />
          {arcs.map(({ segment, fraction, offset }) => {
            const gap = arcs.length > 1 ? GAP : 0;
            const length = Math.max(0, fraction * C - gap);
            return (
              <circle
                key={segment.label}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                strokeWidth={widths[size]}
                strokeDasharray={`${length} ${C - length}`}
                strokeDashoffset={-offset * C}
                className={strokes[segment.tone]}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className={`font-bold text-heading ${valueSizes[size]}`}>{centerValue ?? sum}</span>
          {centerLabel ? (
            <span className={size === 'sm' ? 'text-xs text-muted' : 'text-sm text-muted'}>
              {centerLabel}
            </span>
          ) : null}
        </div>
      </div>
      {legend && !empty ? (
        <ul className="flex min-w-0 flex-1 flex-col gap-3">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-3 text-sm text-text">
              <span aria-hidden className={`size-3 shrink-0 rounded-full ${dots[s.tone]}`} />
              <span className="flex-1">{s.label}</span>
              <span className="tabular-nums">
                {s.value}
                {showPercent ? ` (${percentOf(s.value, sum)})` : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {empty ? <figcaption className="text-sm text-muted">{emptyText}</figcaption> : null}
    </figure>
  );
}
