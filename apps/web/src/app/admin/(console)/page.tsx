import type { Metadata } from 'next';
import { DashboardOverview } from './_components/dashboard-overview';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

function currentDateLabel() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Dhaka',
  }).format(new Date());
}

export default function Dashboard() {
  return <DashboardOverview today={currentDateLabel()} />;
}
