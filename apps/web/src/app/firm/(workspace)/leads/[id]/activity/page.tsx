import type { Metadata } from 'next';
import { ProfileFrame } from '../_components/profile-frame';
import { ActivityTab } from '../_components/tab-activity';

export const metadata: Metadata = { title: 'Lead: Activity' };

export default function LeadsIdActivityPage() {
  return (
    <ProfileFrame tab="activity">
      <ActivityTab />
    </ProfileFrame>
  );
}
