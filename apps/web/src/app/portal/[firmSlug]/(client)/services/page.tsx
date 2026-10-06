import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'My Services' };

export default function MyServicesPage() {
  return <PagePlaceholder title="My Services" ticket="N06" owner="Nahid" />;
}
