'use client';

import { MY_TAX_PLAN_STATE_LABELS, type MyTaxPlanState } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { PortalPageHeader } from '../../_components/portal-page-header';

export const STATE_TONE: Record<MyTaxPlanState, 'warning' | 'info' | 'success' | 'neutral'> = {
  AWAITING_REVIEW: 'warning',
  REQUEST_WITH_FIRM: 'info',
  APPROVED: 'success',
  IN_PREPARATION: 'neutral',
  CLOSED: 'neutral',
};

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const dayText = (iso: string) => DAY.format(new Date(iso));

/**
 * P4-8 (Tax Planning Review 2): the tax plans the firm sent this client, newest year first. Each
 * opens read-only at the version sent, to approve it or ask about it.
 */
export function TaxPlansScreen() {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const plans = useApiQuery(['my-tax-plans', firmSlug], () => api.myTaxPlans(firmSlug).list());
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PortalPageHeader
        title="Tax Plans"
        subtitle="The tax plans your firm sent you. Open one to review it, approve it or ask about it."
      />
      <PageState
        query={plans}
        empty="No tax plans yet. When your firm sends you a plan, it shows here."
      >
        {(items) => (
          <Card>
            <ul className="flex flex-col" aria-label="Tax plans" data-testid="tax-plans">
              {items.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-divider py-3 first:border-t-0"
                  data-testid="tax-plan-row"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/${firmSlug}/tax-plans/${p.id}`}
                      className="font-semibold text-link hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="text-sm text-muted">
                      {p.planYear} · Version {p.version} · Sent {dayText(p.sentAt)}
                    </p>
                  </div>
                  <Badge tone={STATE_TONE[p.state]}>{MY_TAX_PLAN_STATE_LABELS[p.state]}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </PageState>
    </div>
  );
}
