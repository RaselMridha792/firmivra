import type { Metadata } from 'next';
import { LeadSequencesScreen } from './_components/lead-sequences-screen';

export const metadata: Metadata = { title: 'Lead follow-up sequences' };

/** Leads R2 19: Templates > Lead follow-up sequences (editing: Owner and Admin). */
export default function LeadSequencesPage() {
  return <LeadSequencesScreen />;
}
