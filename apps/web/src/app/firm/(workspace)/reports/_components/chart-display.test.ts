import { describe, expect, it } from 'vitest';
import { chartProblem, choiceOf, drawingOf, partsOf } from './chart-display';

// RP-F18: Table Only, KPI Only, and the displays that do not fit a report.
describe('chart display', () => {
  const full = { periods: 12, kpis: 2 };

  it('Table Only and KPI Only show one part', () => {
    expect(partsOf('TABLE')).toEqual({ kpis: false, chart: false, table: true });
    expect(partsOf('KPI')).toEqual({ kpis: true, chart: false, table: false });
    expect(partsOf('AUTO')).toEqual({ kpis: true, chart: true, table: true });
  });

  it('gives the reason a display does not fit', () => {
    expect(chartProblem('LINE', { periods: 1, kpis: 2 })).toBe('needs two or more periods');
    expect(chartProblem('AREA', { periods: 0, kpis: 2 })).toBe('needs two or more periods');
    expect(chartProblem('KPI', { periods: 12, kpis: 0 })).toBe('this report has no totals');
    expect(chartProblem('LINE', full)).toBeNull();
    expect(chartProblem('TABLE', { periods: 0, kpis: 0 })).toBeNull();
  });

  it('draws a line or area only where it fits, else columns', () => {
    expect(drawingOf('LINE', full)).toBe('LINE');
    expect(drawingOf('AREA', full)).toBe('AREA');
    expect(drawingOf('LINE', { periods: 1, kpis: 1 })).toBe('BAR');
    expect(drawingOf('AUTO', full)).toBe('BAR');
  });

  it('reads a saved value it does not offer as Automatic', () => {
    expect(choiceOf('DONUT')).toBe('AUTO');
    expect(choiceOf(undefined)).toBe('AUTO');
    expect(choiceOf('KPI')).toBe('KPI');
  });
});
