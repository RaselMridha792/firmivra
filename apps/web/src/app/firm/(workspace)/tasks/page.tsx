import type { Metadata } from 'next';
import { openedFromWorkflow } from '../settings/workflow/_components/back-to-workflow';
import { TASK_VIEWS } from './_components/task-views';
import { TasksScreen } from './_components/tasks-screen';

export const metadata: Metadata = { title: 'Tasks' };

type Props = {
  searchParams: Promise<{
    from?: string | string[];
    view?: string | string[];
    saved?: string | string[];
  }>;
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to.
 * `?view=templates` (any view id) opens that view; `&saved={id}` names the template just saved
 * (the template editor returns here). Other values are ignored.
 */
export default async function TasksPage({ searchParams }: Props) {
  const { from, view, saved } = await searchParams;
  const tab = TASK_VIEWS.find((v) => v === view);
  return (
    <TasksScreen
      fromWorkflow={openedFromWorkflow(from)}
      {...(tab ? { view: tab } : {})}
      {...(typeof saved === 'string' && ID.test(saved) ? { savedTemplate: saved } : {})}
    />
  );
}
