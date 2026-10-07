import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Messages' };

export default function MessagesPage() {
  return <PagePlaceholder title="Messages" ticket="F10" owner="Fahad" />;
}
