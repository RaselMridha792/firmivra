import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Calendar' };

export default function CalendarPage() {
  return <PagePlaceholder title="Calendar" ticket="F09" owner="Tumit" />;
}
