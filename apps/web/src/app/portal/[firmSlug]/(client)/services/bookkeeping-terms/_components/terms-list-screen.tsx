'use client';

import { MY_BOOKKEEPING_TERMS_STATE_LABELS } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { PortalPageHeader } from '../../../_components/portal-page-header';
import { STATE_TONE, dayText, money } from './terms-parts';

/**
 * Client Portal BK-CP3: the bookkeeping terms the firm sent this client, newest version first,
 * reached from the Bookkeeping service's card in My Services. Each opens its portal version.
 */
export function TermsListScreen() {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const terms = useApiQuery(['my-bookkeeping-terms', firmSlug, 'list'], () =>
    api.myBookkeepingTerms(firmSlug).list(),
  );
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link
        href={`/${firmSlug}/services`}
        className="text-sm font-medium text-link hover:underline"
      >
        ← My Services
      </Link>
      <PortalPageHeader
        title="Engagement Terms"
        subtitle="The bookkeeping terms your firm sent you. Open a version to read it or answer it."
      />
      <PageState
        query={terms}
        empty="No terms yet. When your firm sends you bookkeeping terms, they show here."
      >
        {(items) => (
          <Card>
            <ul className="flex flex-col" aria-label="Engagement terms" data-testid="terms-list">
              {items.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-divider py-3 first:border-t-0"
                  data-testid="terms-row"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/${firmSlug}/services/bookkeeping-terms/${t.id}`}
                      className="font-semibold text-link hover:underline"
                    >
                      {t.serviceTitle}: version {t.version}
                    </Link>
                    <p className="text-sm text-muted">
                      {t.packageName ? `${t.packageName} · ` : ''}
                      {money(t.monthlyFeeCents)} a month · From {dayText(t.effectiveFrom)}
                    </p>
                  </div>
                  <Badge tone={STATE_TONE[t.state]}>
                    {MY_BOOKKEEPING_TERMS_STATE_LABELS[t.state]}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </PageState>
    </div>
  );
}
