import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'In-person signing' };

export default function InPersonSigningPage() {
  return <PagePlaceholder title="In-person signing" ticket="R13" owner="R13-web" />;
}
