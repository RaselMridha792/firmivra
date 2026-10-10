import type { Metadata } from 'next';
import { LeadScreen } from './_components/lead-screen';

export const metadata: Metadata = { title: 'Lead' };

export default function LeadPage() {
  return <LeadScreen />;
}
