import type { Metadata } from 'next';
import { OpportunityDetail } from '../../_components/opportunity-detail';

export const metadata: Metadata = { title: 'Planning Opportunity Details' };

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ opportunityId: string }>;
}) {
  const { opportunityId } = await params;
  return <OpportunityDetail id={opportunityId} />;
}
