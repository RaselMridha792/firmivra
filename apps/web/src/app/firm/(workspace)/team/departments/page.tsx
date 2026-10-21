import type { Metadata } from 'next';
import { openedFromWorkflow } from '../../settings/workflow/_components/back-to-workflow';
import { DepartmentsScreen } from './_components/departments-screen';

export const metadata: Metadata = { title: 'Teams & departments' };

type Props = { searchParams: Promise<{ from?: string | string[] }> };

/** `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to. */
export default async function TeamDepartmentsPage({ searchParams }: Props) {
  const { from } = await searchParams;
  return <DepartmentsScreen fromWorkflow={openedFromWorkflow(from)} />;
}
