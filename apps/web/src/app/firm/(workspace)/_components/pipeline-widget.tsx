'use client';

import type { DashboardSummary } from '@firmivra/types';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { FROM_DASHBOARD } from '../../../../lib/from-dashboard';
import { Widget } from './widget';

type Days = { from: string; to: string };
/**
 * Where each stage opens (Octavia's C5): the list filtered to exactly what the stage counts, with
 * Back to Dashboard. Leads and Accepted carry the widget's days; Consultation holds no records.
 */
const HREF: Record<(typeof STAGES)[number]['key'], ((d: Days) => string) | null> = {
  leads: (d) => `/leads?stage=SUBMITTED&from=${d.from}&to=${d.to}&${FROM_DASHBOARD}`,
  consultation: null,
  intake: () => `/intake-forms?tab=open&${FROM_DASHBOARD}`,
  inProgress: () => `/tax-returns?status=IN_PROGRESS&${FROM_DASHBOARD}`,
  completed: (d) =>
    `/tax-returns?status=ACCEPTED&acceptedFrom=${d.from}&acceptedTo=${d.to}&${FROM_DASHBOARD}`,
};

/** The design's five stages and bar colours. */
const STAGES = [
  // Each bar fades lighter toward its top, as the design draws them (R1, Oct 20).
  { key: 'leads', label: 'Leads', bar: 'bg-linear-to-t from-info to-info/60' },
  { key: 'consultation', label: 'Consultation', bar: 'bg-linear-to-t from-sky to-sky/60' },
  { key: 'intake', label: 'Intake', bar: 'bg-linear-to-t from-gold to-gold/60' },
  { key: 'inProgress', label: 'In Progress', bar: 'bg-linear-to-t from-orange to-orange/60' },
  // Accepted returns (K5): the design's last stage, named for what it counts.
  { key: 'completed', label: 'Accepted', bar: 'bg-linear-to-t from-success to-success/60' },
] as const;

/**
 * Where the firm's work is; a stage no record holds yet shows a dash and an empty track. The
 * widget's own period (C1, `action`) picks the days Completed counts; the other stages are open now.
 */
export function PipelineWidget({
  summary,
  action,
}: {
  summary: UseQueryResult<DashboardSummary>;
  action?: ReactNode;
}) {
  return (
    <Widget title="Client Pipeline" query={summary} isEmpty={() => false} empty="" action={action}>
      {({ pipeline }) => {
        const max = Math.max(1, ...STAGES.map((s) => pipeline[s.key] ?? 0));
        const total = STAGES.reduce((sum, s) => sum + (pipeline[s.key] ?? 0), 0);
        return (
          <>
            <ul className="grid grid-cols-5 gap-2">
              {STAGES.map((s) => {
                const count = pipeline[s.key];
                const href = count !== null ? HREF[s.key] : null;
                const cell = 'flex flex-col items-center gap-1 text-center';
                return (
                  <li key={s.key} data-testid="pipeline-stage">
                    {href ? (
                      <Link
                        href={href({ from: pipeline.from, to: pipeline.to })}
                        aria-label={`${s.label}: ${count}. Open the list`}
                        className={`${cell} rounded-control hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus`}
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
                      </Link>
                    ) : (
                      <div className={cell}>
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
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {total === 0 ? (
              <p className="text-sm text-muted">No clients in the pipeline yet</p>
            ) : null}
            <p className="text-xs text-muted">
              Leads and Accepted follow this period; Intake and In Progress are open now.
            </p>
          </>
        );
      }}
    </Widget>
  );
}
