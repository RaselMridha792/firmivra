import type { Metadata } from 'next';
import { TasksScreen } from './_components/tasks-screen';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage() {
  return <TasksScreen />;
}
