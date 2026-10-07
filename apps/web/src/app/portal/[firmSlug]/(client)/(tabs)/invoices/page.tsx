import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Receipts & Invoices' };

export default function ReceiptsInvoicesPage() {
  return (
    <PagePlaceholder
      title="Receipts & Invoices"
      ticket="N09"
      owner="Nahid"
      mockup="client-portal/invoices tab.png"
    />
  );
}
