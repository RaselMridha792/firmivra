import type { Metadata } from 'next';
import { TaskDetailScreen } from '../_components/task-detail-screen';

export const metadata: Metadata = { title: 'Task' };

type Props = { params: Promise<{ id: string }> };

export default async function TaskPage({ params }: Props) {
  const { id } = await params;
  return <TaskDetailScreen id={id} />;
}
