import type { Metadata } from 'next';
import { FirmSignDashboard } from './_components/dashboard';

export const metadata: Metadata = { title: 'Firm Sign' };

export default function FirmSignPage() {
  return <FirmSignDashboard />;
}
