import { FirmId } from '@firmivra/types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { safeOrigin } from '../../../../../../lib/origin';
import { DownloadAccess } from './download-access';

export const metadata: Metadata = { title: 'Manage download access' };

export default async function DownloadAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { id } = await params;
  if (!FirmId.safeParse(id).success) notFound();
  const detail = '/firms/' + id;
  const from = safeOrigin((await searchParams).from);
  const backTo = from?.split('?')[0] === detail ? from : detail;
  return <DownloadAccess firmId={id} backTo={backTo} />;
}
