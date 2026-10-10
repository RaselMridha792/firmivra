'use client';

import { CALCULATOR_SLUGS, type Calculator } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { PortalPageHeader } from '../../_components/portal-page-header';

/** Only these have a screen yet; the firm's other calculators stay off the list until theirs ships. */
const AVAILABLE: Calculator['key'][] = ['tax_bracket'];

/** /{firm}/calculator: the calculators this firm offers its clients. */
export function CalculatorsHub() {
  const slug = String(useParams<{ firmSlug: string }>().firmSlug);
  const calculators = useApiQuery(['my-calculators', slug], () => api.myCalculators(slug).list());
  const offered = (list: Calculator[]) => list.filter((c) => AVAILABLE.includes(c.key));
  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        title="Calculators"
        subtitle="Quick estimates to help you plan. Nothing you enter is saved."
      />
      <PageState
        query={calculators}
        isEmpty={(list) => offered(list).length === 0}
        empty="No calculators yet."
      >
        {(list) => (
          <ul className="grid gap-4 md:grid-cols-2">
            {offered(list).map((c) => (
              <li key={c.key}>
                <Link
                  href={`/${slug}/calculator/${CALCULATOR_SLUGS[c.key]}`}
                  className="block focus:outline-2 focus:outline-accent-500"
                >
                  <Card title={c.title} className="h-full">
                    <p className="text-sm text-text">Estimate your {c.taxYear} federal tax.</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageState>
    </div>
  );
}
