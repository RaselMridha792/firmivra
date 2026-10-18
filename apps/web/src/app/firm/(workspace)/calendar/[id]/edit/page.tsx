import type { Metadata } from 'next';
import { EditScreen } from './_components/edit-screen';

export const metadata: Metadata = { title: 'Edit appointment' };

export default async function CalendarEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditScreen id={id} />;
}
