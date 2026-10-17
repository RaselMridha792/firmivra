import type { Metadata } from 'next';
import { EditStaffScreen } from './_components/edit-staff-screen';

export const metadata: Metadata = { title: 'Edit staff account' };

export default async function TeamIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditStaffScreen id={id} />;
}
