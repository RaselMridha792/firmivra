import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Firm profile' };

export default function FirmProfilePage() {
  return <PagePlaceholder title="Firm profile" ticket="F05" owner="Tumit" />;
}
