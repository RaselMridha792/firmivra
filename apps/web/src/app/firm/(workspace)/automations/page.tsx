import { AutomationModule } from '@firmivra/types';
import type { Metadata } from 'next';
import { openedFromWorkflow } from '../settings/workflow/_components/back-to-workflow';
import { AutomationsScreen } from './_components/automations-screen';

export const metadata: Metadata = { title: 'Automations' };

type Props = {
  searchParams: Promise<{ from?: string | string[]; category?: string | string[] }>;
};

/**
 * `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to.
 * `?category=TASKS&from=tasks`: the Tasks page's Automations button, with the Tasks category
 * picked and a way back to Tasks. Any other category value is ignored.
 */
export default async function AutomationsPage({ searchParams }: Props) {
  const { from, category } = await searchParams;
  const picked = AutomationModule.safeParse(category);
  return (
    <AutomationsScreen
      fromWorkflow={openedFromWorkflow(from)}
      fromTasks={from === 'tasks'}
      {...(picked.success ? { category: picked.data } : {})}
    />
  );
}
