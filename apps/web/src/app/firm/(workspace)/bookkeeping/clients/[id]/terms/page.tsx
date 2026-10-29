import type { Metadata } from 'next';
import { TermsScreen } from '../../../_components/terms-screen';
import { termsTabOf } from '../../../_components/terms-parts';

export const metadata: Metadata = { title: 'Bookkeeping Terms' };

/** /bookkeeping/clients/[id]/terms (BK-E01): the client's bookkeeping terms, `?tab=` one of six. */
export default async function BookkeepingTermsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <TermsScreen id={id} initialTab={termsTabOf(tab)} />;
}
