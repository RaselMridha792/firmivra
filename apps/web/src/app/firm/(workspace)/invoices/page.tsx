import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Invoices' };

export default function InvoicesPage() {
  return <PagePlaceholder title="Invoices" ticket="F10" owner="Fahad" />;
}
