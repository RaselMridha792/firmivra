import type { Metadata } from 'next';
import { ProfileFrame } from '../_components/profile-frame';
import { CampaignsTab } from '../_components/tab-campaigns';

export const metadata: Metadata = { title: 'Lead: Campaigns' };

export default function LeadsIdCampaignsPage() {
  return (
    <ProfileFrame tab="campaigns">
      <CampaignsTab />
    </ProfileFrame>
  );
}
