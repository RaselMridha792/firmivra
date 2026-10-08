import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Signature request' };

export default function SignatureRequestPage() {
  return <PagePlaceholder title="Signature request" ticket="R13" owner="R13-web" />;
}
