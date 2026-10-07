'use client';

import { PageState } from '../../../../../../components/page-state';
import { RequireRole } from '../../../../../../components/require-role';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { AddStatusForm } from './add-status-form';
import { TAX_STATUSES } from './shared';
import { StatusList } from './status-list';

/**
 * Settings > Tax statuses: list, add, rename, reorder, archive. Everyone on staff can read the
 * list; only Owner and Admin see the controls, and the API checks the role again.
 */
export function TaxStatusesScreen() {
  // 1. Read with the hook, never with fetch. PageState shows loading, empty and error states.
  const statuses = useApiQuery(TAX_STATUSES, () => api.taxStatuses.list());

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Tax statuses
        </h1>
        <p className="text-sm text-muted">
          The steps your firm uses for a client&apos;s tax year. Clients see them in their portal.
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
        {(rows) => <StatusList rows={rows} />}
      </PageState>
    </div>
  );
}
