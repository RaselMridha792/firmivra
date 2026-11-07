'use client';

import { useId } from 'react';
import { CHART_CHOICES, chartProblem, type ChartFacts } from './chart-display';

/**
 * RP-F18: the display choice, with a display that does not fit this report offered disabled and
 * its reason in its name ("Line Chart (needs two or more periods)"). The UI kit's Select takes no
 * disabled options, so this is its native element with the same tokens.
 */
export function ChartSelect({
  label,
  value,
  facts,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  facts: ChartFacts;
  onChange: (value: string) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-heading">
        {label}
      </label>
      <select
        id={id}
        value={value}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 w-full max-w-full rounded-control border border-border bg-surface py-2 pl-3 pr-3 text-base text-text shadow-sm hover:border-control-border focus:border-action focus:outline-none focus:ring-2 focus:ring-action/25"
      >
        {CHART_CHOICES.map((c) => {
          const problem = chartProblem(c.value, facts);
          return (
            <option key={c.value} value={c.value} disabled={!!problem && c.value !== value}>
              {problem ? `${c.label} (${problem})` : c.label}
            </option>
          );
        })}
      </select>
    </div>
  );
}
