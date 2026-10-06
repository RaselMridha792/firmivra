import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Business Startup Guide' };

export default function BusinessStartupGuidePage() {
  return (
    <PagePlaceholder
      title="Business Startup Guide"
      ticket="N10"
      owner="Nahid"
      mockup="client-portal/Business Startup Guide Dashboard.png"
    />
  );
}
