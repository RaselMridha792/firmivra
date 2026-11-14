import type { Metadata } from 'next';
import { LeadRoutingScreen } from './_components/lead-routing-screen';

export const metadata: Metadata = { title: 'Lead assignment' };

/** Leads R2 17: Settings > Lead assignment (Owner and Admin; the API answers 403 to the rest). */
export default function LeadRoutingPage() {
  return <LeadRoutingScreen />;
}
