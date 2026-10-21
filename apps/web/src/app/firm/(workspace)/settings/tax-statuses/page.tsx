import type { Metadata } from 'next';
import { openedFromWorkflow } from '../workflow/_components/back-to-workflow';
import { TaxStatusesScreen } from './_components/tax-statuses-screen';

// The reference screen (docs/junior/GUIDE.md): copy this folder's structure for your page.
// page.tsx stays a small server file with the title; the screen is a client component in
// _components/ (Next.js ignores folders that start with "_").
export const metadata: Metadata = { title: 'Tax statuses' };

type Props = { searchParams: Promise<{ from?: string | string[] }> };

/** `?from=workflow`: opened from Settings > Workflow & Automations, which it offers a way back to. */
export default async function TaxStatusesPage({ searchParams }: Props) {
  const { from } = await searchParams;
  return <TaxStatusesScreen fromWorkflow={openedFromWorkflow(from)} />;
}
