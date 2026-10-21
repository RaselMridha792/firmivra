import type { Metadata } from 'next';
import { openedFromWorkflow } from '../../settings/workflow/_components/back-to-workflow';
import { TypesScreen } from './_components/types-screen';

export const metadata: Metadata = { title: 'Appointment types' };

type Props = { searchParams: Promise<{ from?: string | string[] }> };

/** `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to. */
export default async function CalendarTypesPage({ searchParams }: Props) {
  const { from } = await searchParams;
  return <TypesScreen fromWorkflow={openedFromWorkflow(from)} />;
}
