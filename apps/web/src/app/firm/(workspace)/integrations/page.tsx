import type { Metadata } from 'next';
import { readListQuery } from '../../../../lib/list-query';
import { IntegrationsScreen, OVERVIEW_VIEW } from './_components/integrations-screen';

export const metadata: Metadata = { title: 'Integrations' };

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <IntegrationsScreen initial={readListQuery(await searchParams, OVERVIEW_VIEW)} />;
}
