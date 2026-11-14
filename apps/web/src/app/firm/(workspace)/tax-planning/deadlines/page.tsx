import type { Metadata } from 'next';
import { ProjectDeadlinesScreen } from './_components/deadlines-screen';

export const metadata: Metadata = { title: 'Project Deadlines' };

export default function Page() {
  return <ProjectDeadlinesScreen />;
}
