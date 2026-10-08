import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = {
  title: 'Sign documents',
  robots: { index: false, follow: false },
};

export default function SignDocumentsPage() {
  return <PagePlaceholder title="Sign documents" ticket="R13" owner="R13-web" />;
}
