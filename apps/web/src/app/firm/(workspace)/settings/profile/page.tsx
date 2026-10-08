import type { Metadata } from 'next';
import { ProfileSettings } from './_components/profile-settings';

export const metadata: Metadata = { title: 'Firm profile' };

export default function FirmProfilePage() {
  return <ProfileSettings />;
}
