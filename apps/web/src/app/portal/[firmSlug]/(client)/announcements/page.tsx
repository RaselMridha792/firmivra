import type { Metadata } from 'next';
import { AnnouncementsScreen } from './_components/announcements-screen';

export const metadata: Metadata = { title: 'Announcements' };

export default function AnnouncementsPage() {
  return <AnnouncementsScreen />;
}
