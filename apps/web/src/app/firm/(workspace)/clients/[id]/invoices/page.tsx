import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Client invoices' };

export default function ClientInvoicesPage() {
  return (
    <PagePlaceholder
      title="Client invoices"
      ticket="F10"
      owner="Fahad"
      mockup="client-portal/invoices tab.png (for style)"
    />
  );
}
