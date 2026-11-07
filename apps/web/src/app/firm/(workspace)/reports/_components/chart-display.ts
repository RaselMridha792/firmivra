// RP-F18 (Octavia's Reports review, Oct 28): how a report shows, in the detail and the builder.
// Table Only and KPI Only show one part; Line and Area need two or more periods; KPI Only needs
// a total. A display that does not fit is offered, disabled, with its reason.

export const CHART_CHOICES = [
  { value: 'AUTO', label: 'Automatic' },
  { value: 'BAR', label: 'Column Chart' },
  { value: 'LINE', label: 'Line Chart' },
  { value: 'AREA', label: 'Area Chart' },
  { value: 'TABLE', label: 'Table Only' },
  { value: 'KPI', label: 'KPI Only' },
] as const;
export type ChartChoice = (typeof CHART_CHOICES)[number]['value'];

/** What the report has to show (a run's chart periods and totals). */
export interface ChartFacts {
  periods: number;
  kpis: number;
}

/** Why a display does not fit this report, or null when it does. */
export function chartProblem(value: string, facts: ChartFacts): string | null {
  if ((value === 'LINE' || value === 'AREA') && facts.periods < 2) {
    return 'needs two or more periods';
  }
  if (value === 'KPI' && facts.kpis === 0) return 'this report has no totals';
  return null;
}

/** The parts of the detail a display shows. */
export function partsOf(value: string): { kpis: boolean; chart: boolean; table: boolean } {
  if (value === 'TABLE') return { kpis: false, chart: false, table: true };
  if (value === 'KPI') return { kpis: true, chart: false, table: false };
  return { kpis: true, chart: true, table: true };
}

/** The chart's drawing: columns unless a line or area is chosen and fits. */
export function drawingOf(value: string, facts: ChartFacts): 'BAR' | 'LINE' | 'AREA' {
  return (value === 'LINE' || value === 'AREA') && !chartProblem(value, facts) ? value : 'BAR';
}

/** A known display, else Automatic (a saved value this screen does not offer, such as Donut). */
export function choiceOf(value: string | null | undefined): ChartChoice {
  return CHART_CHOICES.some((c) => c.value === value) ? (value as ChartChoice) : 'AUTO';
}
