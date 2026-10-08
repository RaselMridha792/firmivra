import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Leads' };

export default function LeadsPage() {
  return <PagePlaceholder title="Leads" ticket="F08" owner="Arfan" />;
}
