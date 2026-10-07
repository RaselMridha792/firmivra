import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Team' };

export default function TeamPage() {
  return <PagePlaceholder title="Team" ticket="F05" owner="Tumit" />;
}
