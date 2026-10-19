'use client';

import type { UsageDay } from '../../../../../../mocks/admin-integrations';
import { formatNumber } from '../../_components/integration-format';

/**
 * Usage over time: one column per UTC day, successes in blue and failures in red on top (docx
 * §10: requests and success/failure). The kit has no time-series chart, so this draws one from the
 * kit's chart tokens: an SVG sized by its attributes (no inline styles), the axis labels in HTML so
 * they stay readable at any width. With no requests it keeps its frame: the grid and a zero axis.
 */

/** The y-axis top: a round number at or above the peak, so the four gridlines read cleanly. */
function axisMax(peak: number): number {
  if (peak <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const step = [1, 2, 4, 6, 8, 10].find((value) => value * magnitude >= peak) ?? 10;
  return step * magnitude;
}
const compact = (value: number) =>
  value.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Where each y-axis label sits: the top, the quarters and the zero line. */
const TICKS = [
  { share: 1, position: 'top-0' },
  { share: 0.75, position: 'top-1/4' },
  { share: 0.5, position: 'top-1/2' },
  { share: 0.25, position: 'top-3/4' },
  { share: 0, position: 'top-full' },
] as const;
const COLUMN = 10;

export function UsageChart({
  series,
  noun,
}: {
  series: UsageDay[];
  /** "requests", "API calls", "firm requests". */
  noun: string;
}) {
  const count = series.length;
  const peakDay = series.reduce<UsageDay | null>(
    (best, day) => (!best || day.requests > best.requests ? day : best),
    null,
  );
  const total = series.reduce((sum, day) => sum + day.requests, 0);
  const failures = series.reduce((sum, day) => sum + day.failures, 0);
  const max = axisMax(peakDay?.requests ?? 0);
  const first = series[0];
  const last = series[count - 1];
  // Up to five dates under the axis: the first, the last and evenly between.
  const marks = [
    ...new Set(
      Array.from({ length: Math.min(5, count) }, (_, i) =>
        Math.round((i * (count - 1)) / Math.max(1, Math.min(5, count) - 1)),
      ),
    ),
  ]
    .map((index) => series[index])
    .filter((day): day is UsageDay => !!day);
  const summary =
    first && last
      ? `${noun} per day from ${dayLabel(first.day)} to ${dayLabel(last.day)}: ${formatNumber(total)} in total, ${formatNumber(failures)} failed${peakDay && peakDay.requests ? `; the busiest day was ${dayLabel(peakDay.day)} with ${formatNumber(peakDay.requests)}` : ''}.`
      : `No ${noun} in this range.`;

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div aria-hidden className="relative h-56 w-12 shrink-0 text-right text-xs text-muted">
          {TICKS.map((tick) => (
            <span
              key={tick.position}
              className={`absolute right-0 ${tick.position} -translate-y-1/2`}
            >
              {compact(max * tick.share)}
            </span>
          ))}
        </div>
        <div className="relative h-56 min-w-0 flex-1">
          <svg
            role="img"
            aria-label={summary}
            viewBox={`0 0 ${Math.max(1, count) * COLUMN} 100`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            {TICKS.map((tick) => (
              <line
                key={tick.position}
                x1={0}
                x2={Math.max(1, count) * COLUMN}
                y1={100 - tick.share * 100}
                y2={100 - tick.share * 100}
                vectorEffect="non-scaling-stroke"
                className={tick.share ? 'stroke-divider' : 'stroke-border'}
              />
            ))}
            {series.map((day, index) => {
              const ok = (day.successes / max) * 100;
              const failed = (day.failures / max) * 100;
              return (
                <g key={day.day}>
                  <title>
                    {`${dayLabel(day.day)}: ${formatNumber(day.requests)} ${noun} (${formatNumber(day.successes)} succeeded, ${formatNumber(day.failures)} failed)`}
                  </title>
                  {/* A transparent column for the tooltip on a quiet day. */}
                  <rect
                    x={index * COLUMN}
                    width={COLUMN}
                    y={0}
                    height={100}
                    className="fill-transparent"
                  />
                  {ok > 0 ? (
                    <rect
                      x={index * COLUMN + 1.5}
                      width={COLUMN - 3}
                      y={100 - ok}
                      height={ok}
                      className="fill-chart-blue"
                    />
                  ) : null}
                  {failed > 0 ? (
                    <rect
                      x={index * COLUMN + 1.5}
                      width={COLUMN - 3}
                      y={100 - ok - failed}
                      height={failed}
                      className="fill-chart-red"
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div aria-hidden className="ml-14 flex justify-between gap-2 text-xs text-muted">
        {marks.map((day) => (
          <span key={day.day} className="whitespace-nowrap">
            {dayLabel(day.day)}
          </span>
        ))}
      </div>
      <figcaption className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-text">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-pill bg-chart-blue" />
          Succeeded
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-pill bg-chart-red" />
          Failed
        </span>
      </figcaption>
    </figure>
  );
}
