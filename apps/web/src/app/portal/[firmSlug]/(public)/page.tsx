import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Client portal' };

export default function ClientPortalPage() {
  return (
    <PagePlaceholder
      title="Client portal"
      ticket="N01"
      owner="Nahid"
      mockup="client-portal/Client portal landing page.png"
    />
  );
}
