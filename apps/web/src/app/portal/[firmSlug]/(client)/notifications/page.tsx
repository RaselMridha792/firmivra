import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return <PagePlaceholder title="Notifications" ticket="N10" owner="Nahid" />;
}
