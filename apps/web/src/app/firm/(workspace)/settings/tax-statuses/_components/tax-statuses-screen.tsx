'use client';

import { PageState } from '../../../../../../components/page-state';
import { RequireRole } from '../../../../../../components/require-role';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { BackToWorkflow } from '../../workflow/_components/back-to-workflow';
import { AddStatusForm } from './add-status-form';
import { AmountRounding } from './amount-rounding';
import { WhereReturnsAppear } from './where-returns-appear';
import { TAX_STATUSES } from './shared';
import { StatusList } from './status-list';

/**
 * Settings > Tax statuses: list, add, rename, reorder, archive. Everyone on staff can read the
 * list; only Owner and Admin see the controls, and the API checks the role again. Opened from
 * Workflow & Automations (`fromWorkflow`), it starts with the way back there.
 */
export function TaxStatusesScreen({ fromWorkflow = false }: { fromWorkflow?: boolean }) {
  // 1. Read with the hook, never with fetch. PageState shows loading, empty and error states.
  const statuses = useApiQuery(TAX_STATUSES, () => api.taxStatuses.list());

  return (
    <div className="flex flex-col gap-4">
      {fromWorkflow ? <BackToWorkflow /> : null}
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Tax statuses
        </h1>
        <p className="text-sm text-muted">
          The steps your firm uses for a client&apos;s tax year. Clients see them in their portal.
        </p>
        {/* Review 2 (TX-F36): what "Maps to" means. */}
        <p className="text-sm text-muted" data-testid="maps-to-help">
          <span className="font-semibold text-text">Maps to</span> is the Tax Returns workflow
          status a label stands for, so a label and the return&apos;s own status mean the same step.
          A label your firm uses only for itself maps to None.
        </p>
      </div>

      {/* 2. Controls only for the roles that may use them (hides UI; the API decides). */}
      <RequireRole
        roles={['OWNER', 'ADMIN']}
        fallback={<p className="text-sm text-muted">Only owners and admins can change these.</p>}
      >
        <AddStatusForm />
      </RequireRole>

      <PageState query={statuses} empty="No tax statuses yet">
        {(rows) => (
          <>
            <StatusList rows={rows} />
            {/* Review 2 (TX-F36): which statuses each tab and preset lists. */}
            <WhereReturnsAppear rows={rows} />
          </>
        )}
      </PageState>

      {/* Review 2: how the firm keeps a return's amounts (Owner and Admin). */}
      <RequireRole roles={['OWNER', 'ADMIN']}>
        <AmountRounding />
      </RequireRole>
    </div>
  );
}
