import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DeadlineDetailScreen } from '../_components/deadline-detail-screen';

export const metadata: Metadata = { title: 'Deadline' };

type Props = { params: Promise<{ id: string }> };

export default async function DeadlinePage({ params }: Props) {
  const { id } = await params;
  // The screen reads where it was opened from (its Back).
  return (
    <Suspense fallback={null}>
      <DeadlineDetailScreen id={id} />
    </Suspense>
  );
}
