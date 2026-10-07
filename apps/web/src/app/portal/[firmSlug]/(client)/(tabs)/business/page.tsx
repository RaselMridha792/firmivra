import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Business Documents & Resources' };

export default function BusinessDocumentsResourcesPage() {
  return (
    <PagePlaceholder
      title="Business Documents & Resources"
      ticket="N09"
      owner="Nahid"
      mockup="client-portal/Business Tab.png"
    />
  );
}
