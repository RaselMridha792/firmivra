import type { Metadata } from 'next';
import { DashboardOverview } from './_components/dashboard-overview';

export const metadata: Metadata = { title: 'Dashboard' };

export default function Dashboard() {
  return <DashboardOverview />;
}
