import type { Metadata } from 'next';
import { ProfileScreen } from './_components/profile-screen';

export const metadata: Metadata = { title: 'My Profile' };

export default function MyProfilePage() {
  return <ProfileScreen />;
}
