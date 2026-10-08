import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Lead' };

export default function LeadPage() {
  return <PagePlaceholder title="Lead" ticket="F08" owner="Arfan" />;
}
