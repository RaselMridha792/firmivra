import type { Metadata } from 'next';
import { InvoiceDetail } from '../_components/invoice-detail';

export const metadata: Metadata = { title: 'Invoice' };

export default async function InvoicePage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return (
    <InvoiceDetail
      invoiceId={invoiceId}
      // Q24 (I-N03): Copy Payment Link; the portal's address comes from config, read on the server.
      portalBase={process.env['PORTAL_BASE_URL'] ?? ''}
    />
  );
}
