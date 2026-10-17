import type { Metadata } from 'next';
import { TaskFormScreen } from '../../_components/task-form';

export const metadata: Metadata = { title: 'Edit task' };

type Props = { params: Promise<{ id: string }> };

export default async function EditTaskPage({ params }: Props) {
  const { id } = await params;
  return <TaskFormScreen id={id} />;
}
