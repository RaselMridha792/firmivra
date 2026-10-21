import type { Metadata } from 'next';
import { MyProfileScreen } from './_components/my-profile-screen';

export const metadata: Metadata = { title: 'My Profile' };

export default function MyProfilePage() {
  return <MyProfileScreen />;
}
