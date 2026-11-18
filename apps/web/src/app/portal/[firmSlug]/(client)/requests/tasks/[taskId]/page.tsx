import type { Metadata } from 'next';
import { TaskScreen } from './_components/task-screen';

export const metadata: Metadata = { title: 'Task' };

/** Client Portal Review One T16: one task the firm shows this client (from Your Next Steps). */
export default function ClientTaskPage() {
  return <TaskScreen />;
}
