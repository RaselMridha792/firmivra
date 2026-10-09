import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Firm Sign' };

export default function FirmSignPage() {
  return <PagePlaceholder title="Firm Sign" ticket="R13" owner="R13-web" />;
}
