import type { Metadata } from 'next';
import { OpportunityDetail } from './_components/opportunity-detail';

export const metadata: Metadata = { title: 'Opportunity' };

export default async function AdminSalesOpportunitiesOpportunityIdPage({
  params,
}: {
  params: Promise<{ opportunityId: string }>;
}) {
  const { opportunityId } = await params;
  return <OpportunityDetail opportunityId={opportunityId} />;
}
