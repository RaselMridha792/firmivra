import type { Metadata } from 'next';
import { WebsiteManagement } from './_components/website-management';

export const metadata: Metadata = { title: 'Website Management' };

export default function WebsiteManagementPage() {
  return <WebsiteManagement />;
}
