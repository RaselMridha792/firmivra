import type { Metadata } from 'next';
import { TaskFormScreen } from '../_components/task-form';

export const metadata: Metadata = { title: 'New task' };

type Props = { searchParams: Promise<{ template?: string }> };

export default async function NewTaskPage({ searchParams }: Props) {
  const { template } = await searchParams;
  return <TaskFormScreen templateId={template} />;
}
