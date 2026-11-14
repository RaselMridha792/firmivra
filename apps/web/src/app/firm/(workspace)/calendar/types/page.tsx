import type { Metadata } from 'next';
import { openedFromWorkflow } from '../../settings/workflow/_components/back-to-workflow';
import { TypesScreen } from './_components/types-screen';

export const metadata: Metadata = { title: 'Appointment types' };

type Props = { searchParams: Promise<{ from?: string | string[] }> };

/** `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to. */
export default async function CalendarTypesPage({ searchParams }: Props) {
  const { from } = await searchParams;
  // The portal's address comes from config (PORTAL_BASE_URL), read on the server.
  return (
    <TypesScreen
      fromWorkflow={openedFromWorkflow(from)}
      portalBase={process.env['PORTAL_BASE_URL'] ?? ''}
    />
  );
}
