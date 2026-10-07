import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Dashboard' };

export default function DashboardPage() {
  return <PagePlaceholder title="Dashboard" ticket="F03" owner="Fahad" />;
}
