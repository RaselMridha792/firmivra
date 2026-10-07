import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Appointments' };

export default function AppointmentsPage() {
  return <PagePlaceholder title="Appointments" ticket="N08" owner="Tumit" />;
}
