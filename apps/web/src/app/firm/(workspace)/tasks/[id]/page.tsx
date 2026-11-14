import type { Metadata } from 'next';
import { TaskDetailScreen } from '../_components/task-detail-screen';

export const metadata: Metadata = { title: 'Task' };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ convert?: string | string[] }>;
};

/** `?convert=recurring` (Review 2, TX-F15): Convert to Recurring opens on arrival. */
export default async function TaskPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { convert } = await searchParams;
  return <TaskDetailScreen id={id} convertToRecurring={convert === 'recurring'} />;
}
