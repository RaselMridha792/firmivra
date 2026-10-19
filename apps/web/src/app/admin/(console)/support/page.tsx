import type { Metadata } from 'next';
import { SupportDashboard } from './_components/support-dashboard';

export const metadata: Metadata = { title: 'Support' };

export default function AdminSupportPage() {
  return <SupportDashboard />;
}
