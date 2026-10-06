import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Client overview' };

export default function ClientOverviewPage() {
  return <PagePlaceholder title="Client overview" ticket="F06" owner="Fahad" />;
}
