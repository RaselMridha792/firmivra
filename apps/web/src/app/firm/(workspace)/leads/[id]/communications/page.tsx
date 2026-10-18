import type { Metadata } from 'next';
import { ProfileFrame } from '../_components/profile-frame';
import { CommunicationsTab } from '../_components/tab-communications';

export const metadata: Metadata = { title: 'Lead: Communications' };

export default function LeadsIdCommunicationsPage() {
  return (
    <ProfileFrame tab="communications">
      <CommunicationsTab />
    </ProfileFrame>
  );
}
