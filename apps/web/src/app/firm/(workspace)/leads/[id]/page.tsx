import type { Metadata } from 'next';
import { ProfileFrame } from './_components/profile-frame';
import { OverviewTab } from './_components/tab-overview';

export const metadata: Metadata = { title: 'Lead' };

/** The Lead Workspace's Overview (`/leads/{id}`): the tab every lead link opens. */
export default function LeadPage() {
  return (
    <ProfileFrame tab="overview">
      <OverviewTab />
    </ProfileFrame>
  );
}
