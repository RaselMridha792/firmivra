import type { Metadata } from 'next';
import { PlanningClients } from '../_components/tp-lists';

export const metadata: Metadata = { title: 'Planning Clients' };

export default function Page() {
  return <PlanningClients />;
}
