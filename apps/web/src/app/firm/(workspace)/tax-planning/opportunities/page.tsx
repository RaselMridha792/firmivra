import type { Metadata } from 'next';
import { OpportunityQueue } from '../_components/tp-lists';

export const metadata: Metadata = { title: 'Planning Opportunities' };

export default function Page() {
  return <OpportunityQueue />;
}
