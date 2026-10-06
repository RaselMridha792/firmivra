import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Dashboard' };

export default function Dashboard() {
  return (
    <PagePlaceholder
      title="Dashboard"
      ticket="F04a"
      owner="Tumit"
      mockup="super-admin/Dashboard Active .png"
    />
  );
}
