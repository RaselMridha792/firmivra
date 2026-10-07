import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Client documents' };

export default function ClientDocumentsPage() {
  return <PagePlaceholder title="Client documents" ticket="F07" owner="Fahad" />;
}
