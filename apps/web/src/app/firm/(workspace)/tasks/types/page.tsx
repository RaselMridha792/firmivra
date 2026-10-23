import type { Metadata } from 'next';
import { openedFromWorkflow } from '../../settings/workflow/_components/back-to-workflow';
import { TaskTypesScreen } from '../_components/task-types-screen';

export const metadata: Metadata = { title: 'Task types' };

type Props = { searchParams: Promise<{ from?: string | string[] }> };

/** `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to. */
export default async function TaskTypesPage({ searchParams }: Props) {
  const { from } = await searchParams;
  return <TaskTypesScreen fromWorkflow={openedFromWorkflow(from)} />;
}
