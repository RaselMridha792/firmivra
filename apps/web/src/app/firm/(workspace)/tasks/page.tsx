import type { Metadata } from 'next';
import { openedFromWorkflow } from '../settings/workflow/_components/back-to-workflow';
import { TasksScreen } from './_components/tasks-screen';

export const metadata: Metadata = { title: 'Tasks' };

type Props = { searchParams: Promise<{ from?: string | string[] }> };

/** `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to. */
export default async function TasksPage({ searchParams }: Props) {
  const { from } = await searchParams;
  return <TasksScreen fromWorkflow={openedFromWorkflow(from)} />;
}
