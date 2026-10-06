import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Firms' };

export default function Firms() {
  return <PagePlaceholder title="Firms" ticket="N04" owner="Tumit" />;
}
