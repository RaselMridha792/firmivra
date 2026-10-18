import type { Metadata } from 'next';
import { NewMemberScreen } from './_components/new-member-screen';

export const metadata: Metadata = { title: 'Add team member' };

export default function AdminTeamNewPage() {
  return <NewMemberScreen />;
}
