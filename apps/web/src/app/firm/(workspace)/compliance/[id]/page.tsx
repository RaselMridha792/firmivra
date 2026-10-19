import type { Metadata } from 'next';
import { DeadlineDetailScreen } from '../_components/deadline-detail-screen';

export const metadata: Metadata = { title: 'Deadline' };

type Props = { params: Promise<{ id: string }> };

export default async function DeadlinePage({ params }: Props) {
  const { id } = await params;
  return <DeadlineDetailScreen id={id} />;
}
