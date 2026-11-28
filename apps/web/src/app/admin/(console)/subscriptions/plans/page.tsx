import type { Metadata } from 'next';
import { PlansManagement } from './_components/plans-management';

export const metadata: Metadata = { title: 'Plan Tiers' };

export default function PlanTiersPage() {
  return <PlansManagement />;
}
