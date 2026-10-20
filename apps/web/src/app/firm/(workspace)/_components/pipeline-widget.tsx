'use client';

import type { DashboardSummary } from '@firmivra/types';
import type { UseQueryResult } from '@tanstack/react-query';
import { Widget } from './widget';

/** The design's five stages and bar colours. */
const STAGES = [
  // Each bar fades lighter toward its top, as the design draws them (R1, Oct 20).
  { key: 'leads', label: 'Leads', bar: 'bg-linear-to-t from-info to-info/60' },
  { key: 'consultation', label: 'Consultation', bar: 'bg-linear-to-t from-sky to-sky/60' },
  { key: 'intake', label: 'Intake', bar: 'bg-linear-to-t from-gold to-gold/60' },
  { key: 'inProgress', label: 'In Progress', bar: 'bg-linear-to-t from-orange to-orange/60' },
  { key: 'completed', label: 'Completed', bar: 'bg-linear-to-t from-success to-success/60' },
] as const;

/** Where the firm's work is; a stage no record holds yet shows a dash and an empty track. */
export function PipelineWidget({ summary }: { summary: UseQueryResult<DashboardSummary> }) {
  return (
    <Widget title="Client Pipeline" query={summary} isEmpty={() => false} empty="">
      {({ pipeline }) => {
        const max = Math.max(1, ...STAGES.map((s) => pipeline[s.key] ?? 0));
        const total = STAGES.reduce((sum, s) => sum + (pipeline[s.key] ?? 0), 0);
        return (
          <>
            <ul className="grid grid-cols-5 gap-2">
              {STAGES.map((s) => {
                const count = pipeline[s.key];
                return (
                  <li
                    key={s.key}
                    data-testid="pipeline-stage"
                    className="flex flex-col items-center gap-1 text-center"
                  >
                    <span className="flex min-h-10 items-end text-xs leading-tight text-muted hyphens-auto sm:text-sm">
                      {s.label}
                    </span>
                    <span className="text-2xl font-bold text-heading">
                      {count ?? <span aria-label="No data">—</span>}
                    </span>
                    <span className="flex h-24 w-full items-end justify-center rounded-control bg-canvas">
                      {count ? (
                        <span
                          aria-hidden
                          className={`w-full max-w-12 rounded-control ${s.bar}`}
                          style={{ height: `${Math.max(8, (count / max) * 100)}%` }}
                        />
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            {total === 0 ? (
              <p className="text-sm text-muted">No clients in the pipeline yet</p>
            ) : null}
          </>
        );
      }}
    </Widget>
  );
}
