import type { Metadata } from 'next';
import { BusinessScreen } from './_components/business-screen';

export const metadata: Metadata = { title: 'Business Documents & Resources' };

export default function BusinessDocumentsResourcesPage() {
  return <BusinessScreen />;
}
