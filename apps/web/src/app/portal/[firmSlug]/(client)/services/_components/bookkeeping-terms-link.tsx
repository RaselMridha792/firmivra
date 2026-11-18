'use client';

import { ChevronRight, FilePen } from 'lucide-react';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';

/**
 * Client Portal BK-CP3: on a Bookkeeping service's card, the way to its engagement terms. A
 * version waiting for the client's answer opens directly; otherwise the list of versions. Nothing
 * shows before the firm sends terms.
 */
export function BookkeepingTermsLink({ slug, serviceId }: { slug: string; serviceId: string }) {
  const terms = useApiQuery(['my-bookkeeping-terms', slug, 'list'], () =>
    api.myBookkeepingTerms(slug).list(),
  );
  const mine = (terms.data ?? []).filter((t) => t.serviceId === serviceId);
  if (!mine.length) return null;
  const waiting = mine.find((t) => t.state === 'AWAITING_ANSWER');
  return (
    <Link
      href={`/${slug}/services/bookkeeping-terms${waiting ? `/${waiting.id}` : ''}`}
      data-testid="service-terms-link"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <FilePen aria-hidden className="size-4" />
      {waiting ? 'New terms are waiting for your answer' : 'Your engagement terms'}
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}
