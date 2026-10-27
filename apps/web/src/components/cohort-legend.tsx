'use client';

import { X } from '@phosphor-icons/react';

const DOT: Record<string, string> = {
  green: 'bg-chart-green',
  blue: 'bg-chart-blue',
  yellow: 'bg-chart-yellow',
  grey: 'bg-chart-grey',
  red: 'bg-chart-red',
  purple: 'bg-purple',
  navy: 'bg-heading',
};

export interface CohortRow {
  key: string;
  label: string;
  /** A chart tone (green, blue, yellow, grey, red, purple, navy), as the ring draws it. */
  tone: string;
  count: number;
  percent?: number;
}

/**
 * A chart's legend whose rows filter the list on the same page (Octavia's SH8): the chosen row
 * shows as pressed, and Clear brings back the whole list. The page keeps its period.
 */
export function CohortLegend({
  rows,
  selected,
  onPick,
  onClear,
  label,
}: {
  rows: readonly CohortRow[];
  selected: string | undefined;
  onPick: (key: string) => void;
  onClear: () => void;
  /** "Filter the client list by status". */
  label: string;
}) {
  const chosen = rows.find((r) => r.key === selected);
  return (
    <div className="mt-3 flex flex-col gap-1">
      <ul className="flex flex-col gap-1 text-sm" aria-label={label}>
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              aria-pressed={r.key === selected}
              onClick={() => onPick(r.key)}
              className={`flex min-h-9 w-full items-center gap-2 rounded-control px-2 text-left hover:bg-canvas ${r.key === selected ? 'bg-accent-soft font-semibold' : ''}`}
            >
              <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-full ${DOT[r.tone] ?? DOT.grey}`}
              />
              <span className="min-w-0 flex-1 truncate text-heading">{r.label}</span>
              <span className="font-semibold text-heading">{r.count}</span>
              {r.percent === undefined ? null : (
                <span className="w-10 text-right text-xs text-muted">{r.percent}%</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {chosen ? (
        <p
          className="flex flex-wrap items-center gap-2 text-xs text-muted"
          data-testid="cohort-chosen"
        >
          The list shows {chosen.label}.
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 font-medium text-link hover:underline"
          >
            <X aria-hidden weight="bold" className="size-3" /> Clear
          </button>
        </p>
      ) : null}
    </div>
  );
}
