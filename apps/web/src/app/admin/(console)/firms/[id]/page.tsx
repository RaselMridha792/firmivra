import type { Metadata } from 'next';
import { ORIGIN_PARAM, safeOrigin } from '../../../../../lib/origin';
import { FirmDetail } from '../_components/firm-detail';

export const metadata: Metadata = { title: 'Firm' };

export default async function Firm({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // SA-FRM-Y05: Back returns to the firms list exactly as it was left (a path on this site only).
  const from = safeOrigin((await searchParams)[ORIGIN_PARAM]);
  return <FirmDetail id={id} backTo={from} />;
}
