import type { Metadata } from 'next';
import { FirmivraRequestsScreen } from './_components/requests-screen';

export const metadata: Metadata = { title: 'Requests from Firmivra' };

export default function FirmivraRequestsPage() {
  return <FirmivraRequestsScreen />;
}
