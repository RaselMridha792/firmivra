import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Sign-ups' };

export default function SignUpsPage() {
  return <PagePlaceholder title="Sign-ups" ticket="F06" owner="Fahad" />;
}
