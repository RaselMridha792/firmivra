import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'New signature request' };

export default function NewSignatureRequestPage() {
  return <PagePlaceholder title="New signature request" ticket="R13" owner="R13-web" />;
}
