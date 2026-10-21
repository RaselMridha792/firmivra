import type { Metadata } from 'next';
import { openedFromWorkflow } from '../settings/workflow/_components/back-to-workflow';
import { AutomationsScreen } from './_components/automations-screen';

export const metadata: Metadata = { title: 'Automations' };

type Props = { searchParams: Promise<{ from?: string | string[] }> };

/** `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to. */
export default async function AutomationsPage({ searchParams }: Props) {
  const { from } = await searchParams;
  return <AutomationsScreen fromWorkflow={openedFromWorkflow(from)} />;
}
