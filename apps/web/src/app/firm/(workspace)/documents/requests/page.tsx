import type { Metadata } from 'next';
import { RequestsScreen } from './_components/requests-screen';

export const metadata: Metadata = { title: 'Document Requests' };

export default function DocumentRequestsPage() {
  return <RequestsScreen />;
}
