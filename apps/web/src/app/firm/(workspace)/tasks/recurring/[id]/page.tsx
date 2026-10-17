import type { Metadata } from 'next';
import { SeriesDetailScreen } from '../../_components/series-detail-screen';

export const metadata: Metadata = { title: 'Recurring task' };

type Props = { params: Promise<{ id: string }> };

export default async function RecurringTaskPage({ params }: Props) {
  const { id } = await params;
  return <SeriesDetailScreen id={id} />;
}
