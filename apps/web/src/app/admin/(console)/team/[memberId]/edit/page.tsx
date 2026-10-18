import type { Metadata } from 'next';
import { EditMemberScreen } from './_components/edit-member-screen';

export const metadata: Metadata = { title: 'Edit team member' };

export default async function AdminTeamMemberIdEditPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  return <EditMemberScreen memberId={memberId} />;
}
