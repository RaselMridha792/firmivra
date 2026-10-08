import type { Metadata } from 'next';
import { BeginOnlineScreen } from './_components/begin-online-screen';

export const metadata: Metadata = { title: 'Begin Online' };

export default async function BeginOnlinePage({
  params,
}: {
  params: Promise<{ firmSlug: string }>;
}) {
  const { firmSlug } = await params;
  return <BeginOnlineScreen firmSlug={firmSlug} taxYear={new Date().getFullYear()} />;
}
