import type { Metadata } from 'next';
import { ProfileFrame } from '../_components/profile-frame';
import { TasksTab } from '../_components/tab-tasks';

export const metadata: Metadata = { title: 'Lead: Tasks' };

export default function LeadsIdTasksPage() {
  return (
    <ProfileFrame tab="tasks">
      <TasksTab />
    </ProfileFrame>
  );
}
