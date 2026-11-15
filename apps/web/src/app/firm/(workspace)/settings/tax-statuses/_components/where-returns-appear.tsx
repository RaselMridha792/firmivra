'use client';

import {
  TAX_RETURN_IN_PROGRESS_STATUSES,
  TAX_RETURN_KPI_STATUSES,
  type TaxReturnWorkflowStatus,
  type TaxStatus,
} from '@firmivra/types';
import { STATUS_LABEL, TABS } from '../../../tax-returns/_components/tr-shared';

/** What each Tax Returns tab holds (its type); every tab lists returns in every status. */
const TAB_HOLDS: Record<string, string> = {
  all: 'every return',
  personal: 'individual returns, not quarterly or amended',
  business: 'business returns, not quarterly or amended',
  quarterly: 'quarterly estimates',
  amended: 'amended returns',
  prior_year: 'tax years before last year',
};

/** The presets: the In Progress filter and dashboard card, and the KPI cards. */
const PRESETS: { name: string; statuses: readonly TaxReturnWorkflowStatus[] }[] = [
  { name: 'In Progress (filter and dashboard card)', statuses: TAX_RETURN_IN_PROGRESS_STATUSES },
  { name: 'In Preparation card', statuses: TAX_RETURN_KPI_STATUSES.inPreparation },
  { name: 'Waiting on Client card', statuses: TAX_RETURN_KPI_STATUSES.waitingOnClient },
  { name: 'Ready for Review/File card', statuses: TAX_RETURN_KPI_STATUSES.readyForReviewOrFile },
  { name: 'Transmitted card', statuses: TAX_RETURN_KPI_STATUSES.transmitted },
  { name: 'Accepted card', statuses: TAX_RETURN_KPI_STATUSES.accepted },
  { name: 'Rejected card', statuses: TAX_RETURN_KPI_STATUSES.rejected },
];

const names = (statuses: readonly TaxReturnWorkflowStatus[]) =>
  statuses.map((s) => STATUS_LABEL[s]).join(', ');

/**
 * Review 2 (TX-F36): read-only, how the Tax Returns tabs and presets use the workflow statuses
 * and which of the firm's labels map to them. Nothing here is configured.
 */
export function WhereReturnsAppear({ rows }: { rows: TaxStatus[] }) {
  const labelsFor = (statuses: readonly TaxReturnWorkflowStatus[]) => {
    const mapped = rows.filter((r) => r.workflowStatus && statuses.includes(r.workflowStatus));
    return mapped.length ? mapped.map((r) => r.name).join(', ') : 'None';
  };
  return (
    <section
      aria-labelledby="where-returns-title"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 text-sm"
      data-testid="where-returns-appear"
    >
      <div>
        <h2 id="where-returns-title" className="text-base font-semibold text-text">
          Where returns appear
        </h2>
        <p className="text-muted">
          How Tax Returns&apos; tabs and presets use the workflow statuses, and your labels mapped
          to them. This explains the fixed behaviour; nothing here is set.
        </p>
      </div>
      <div>
        <h3 className="font-semibold text-text">Service tabs</h3>
        <ul className="flex flex-col gap-1" aria-label="Service tabs">
          {TABS.map((t) => (
            <li key={t.id} data-testid="tab-explained">
              <span className="font-medium text-text">{t.label}</span>{' '}
              <span className="text-muted">
                ({TAB_HOLDS[t.id]}). Lists returns in: every workflow status. Archived returns are
                under Show: Archived.
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-semibold text-text">Presets</h3>
        <ul className="flex flex-col gap-1" aria-label="Presets">
          {PRESETS.map((p) => (
            <li key={p.name} data-testid="preset-explained">
              <span className="font-medium text-text">{p.name}</span>{' '}
              <span className="text-muted">
                Lists returns in: {names(p.statuses)}. Your labels: {labelsFor(p.statuses)}.
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
