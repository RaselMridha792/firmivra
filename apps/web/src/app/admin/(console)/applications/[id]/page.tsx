import type { Metadata } from 'next';
import { ORIGIN_PARAM, safeOrigin } from '../../../../../lib/origin';
import { ApplicationDetail } from '../_components/application-detail';

export const metadata: Metadata = { title: 'Firm application' };

export default async function Application({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // SA-APP-F11: Back returns to the list exactly as it was left (a path on this site only).
  const from = safeOrigin((await searchParams)[ORIGIN_PARAM]);
  return <ApplicationDetail id={id} backTo={from} />;
}
