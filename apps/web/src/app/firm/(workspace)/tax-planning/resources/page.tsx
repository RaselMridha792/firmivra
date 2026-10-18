import type { Metadata } from 'next';
import { PlanningResources } from '../_components/tp-lists';

export const metadata: Metadata = { title: 'Planning Resources' };

export default function Page() {
  return <PlanningResources />;
}
