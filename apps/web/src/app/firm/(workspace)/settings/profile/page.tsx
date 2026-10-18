import type { Metadata } from 'next';
import { ProfileScreen } from './_components/profile-screen';

export const metadata: Metadata = { title: 'Firm profile' };

export default function FirmProfilePage() {
  return <ProfileScreen />;
}
